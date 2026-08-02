import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { sessionAuthEnv } from '../auth-env.js';
import { resolveLiveLocator } from '../live-smoke-helpers.js';

/**
 * Control-spike stages 8-9 — live pass. SDK 0.3.196 / CLI 2.1.196 (a4ca500).
 *
 * The offline suite (stage-8-9-process.test.ts) already settles that
 * `ANTHROPIC_BASE_URL` reaches the spawned CLI process's env intact — that is
 * an argv/env-capture fact, provable with a stub executable and no network.
 * What it CANNOT settle is the load-bearing fact for the arc's P5 (coa as an
 * Anthropic-shaped gateway): whether the real `claude` binary actually reads
 * that var back out of its own env and redirects its inference traffic there,
 * rather than, say, only consulting it at one specific code path that doesn't
 * cover the model call, or requiring some additional flag/config coa doesn't
 * know about yet. Settling that needs the compiled binary running for real —
 * hence live-gated, per the plan's `stub-cli.mjs` cannot speak for the real
 * CLI's constraint.
 *
 * A LOCAL STUB HTTP SERVER IS ENOUGH — this does not need a real model, only
 * proof that the CLI's own outbound request reaches a server coa controls
 * instead of api.anthropic.com. The stub deliberately answers with an error;
 * the assertion is "a request arrived here at all," not "the turn succeeded."
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/control/stage-8-9-process.live.test.ts
 *
 * Requires an active `claude` account (`coa auth current`), per
 * `resolveLiveLocator` in `live-smoke-helpers.ts`. Spends no tokens against
 * the real API — the whole point is that the request never reaches it — but
 * DOES require the CLI to spawn with a real subscription login shape, since a
 * stage that never even attempts an authenticated call would settle nothing.
 */
// A live model turn cannot finish inside vitest's 5s default, so every probe in this
// file would fail on the clock rather than on its claim. The repo's existing smokes pass
// a per-test timeout; setting it once per file is the same contract with less repetition.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(!process.env['COA_LIVE'])('stage 8 — live ANTHROPIC_BASE_URL redirect', () => {
  it("redirects the real CLI's inference traffic to a non-Anthropic endpoint it was pointed at", async () => {
    const locator = resolveLiveLocator();
    const requests: Array<{ url: string; headers: Record<string, string | string[] | undefined> }> =
      [];

    const server = createServer((req, res) => {
      requests.push({ url: req.url ?? '', headers: req.headers });
      // Deliberately not a real model response — a stub is enough per the
      // task brief. The CLI is expected to surface this as a turn error;
      // that failure is expected and discarded below.
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: 'coa control-spike stub — not a real model' },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const baseEnv = sessionAuthEnv(locator, process.env) ?? process.env;
      // The stub answers 500, and the CLI retries it with backoff — so draining to completion
      // never terminates and the probe times out on the clock rather than on its claim. The
      // decisive evidence is the FIRST inbound request, so the run is aborted the moment one
      // arrives instead of waiting for an ending that cannot come.
      const abortController = new AbortController();
      const q = query({
        prompt: 'Say hello in one word.',
        options: {
          settingSources: [],
          maxTurns: 1,
          abortController,
          env: { ...baseEnv, ANTHROPIC_BASE_URL: baseUrl },
        },
      });

      const drained = (async () => {
        try {
          for await (const _message of q) {
            // Drained only to keep the query running until the abort below.
          }
        } catch {
          // Expected: the stub is not a model, and the run is aborted deliberately.
        }
      })();

      const deadline = Date.now() + 45_000;
      while (requests.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      abortController.abort();
      await drained;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // The decisive assertion: the real CLI binary made an outbound request to
    // OUR server, not api.anthropic.com. Prints the path so a human can
    // eyeball which endpoint the CLI hit (likely /v1/messages) without this
    // file hardcoding a guess that might be version-specific.
    expect(
      requests.length,
      `inbound requests = ${JSON.stringify(requests.map((r) => r.url))}`,
    ).toBeGreaterThan(0);
  }, 90_000);
});
