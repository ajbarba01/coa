import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Locator } from '@coa/shared';
import type { RegisteredTool } from '@coa/spi';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveLiveLocator } from '../live-smoke-helpers.js';
import { sessionAuthEnv } from '../auth-env.js';
import { mcpToolName, toCoaMcpServer } from '../mcp-tools.js';

/**
 * Control-spike stages 1-2 — LIVE routing probes. SDK 0.3.196 / CLI 2.1.196
 * (a4ca500). Requires a real Claude account and spends real subscription
 * tokens — gated with `COA_LIVE`, and NOT run as part of this spike (per the
 * plan: subagents write live probes, a single serialised pass runs them
 * later).
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/control/stage-1-2-session-construction.live.test.ts
 *
 * What the offline suite (stage-1-2-session-construction.test.ts) could
 * settle: `toolAliases` reaches the CLI process, verbatim, over the stdio
 * `control_request` (subtype `initialize`) written to its stdin after spawn —
 * NOT via argv, contrary to the plan's original draft hypothesis. The SDK
 * wrapper itself performs zero validation of alias keys/values before
 * sending — a name that is not a real native tool travels through exactly
 * like `Bash` does.
 *
 * What it could NOT settle, because the offline stub never runs the real
 * binary and never answers the control protocol: whether the CLI actually
 * HONORS the alias at tool-dispatch time — i.e. whether a model-emitted
 * `Read` tool_use, when `toolAliases: { Read: 'mcp__coa__<name>' }` is set,
 * is genuinely executed by coa's MCP handler instead of the CLI's own
 * built-in Read. That is the one fact this file exists to pin down, and it
 * is the fact the arc's P1 most needs: if this holds, the native tool name
 * `Agent` is NOT unavailable to coa, contrary to the arc design's "One limit
 * worth writing down".
 */
// A live model turn cannot finish inside vitest's 5s default, so every probe in this
// file would fail on the clock rather than on its claim. The repo's existing smokes pass
// a per-test timeout; setting it once per file is the same contract with less repetition.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * An allow-everything permission callback that ECHOES the tool's input back.
 *
 * The shared `allowAllTools` returns a bare `{behavior:'allow'}`. That is type-valid —
 * `updatedInput` is optional on `PermissionResult` — but against the real CLI it produced
 * "permission errors" for every tool, including coa's own MCP tool, and no handler ran. The
 * input has to be handed back for the call to proceed. Kept local to this file: whether the
 * shared helper carries the same latent defect for the other smokes is a separate question,
 * and this spike does not change shipped behaviour.
 */
const allowEchoingInput = (
  _toolName: string,
  input: Record<string, unknown>,
): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> }> =>
  Promise.resolve({ behavior: 'allow', updatedInput: input });

describe.skipIf(!process.env['COA_LIVE'])('stage 1-2 — live routing', () => {
  let locator: Locator;

  beforeAll(() => {
    locator = resolveLiveLocator();
  });

  it('routes a native tool name (`Read`) to coa’s MCP handler when aliased, instead of the CLI’s own built-in Read', async () => {
    // A distinctive marker only coa's handler (not the real filesystem Read,
    // which would also find this file) can prove it saw — the assertion is on
    // WHICH implementation ran, not just that reading succeeded.
    const worktree = mkdtempSync(join(tmpdir(), 'coa-live-toolalias-'));
    const marker = `ALIAS-PROOF-${Math.random().toString(36).slice(2, 10)}`;
    writeFileSync(join(worktree, 'probe.txt'), `plain file content, no marker here`, 'utf8');

    let coaHandlerInvoked = false;
    let coaHandlerArgs: unknown;
    const peekTool: RegisteredTool = {
      name: 'peek',
      description: 'Read a file and report its contents, governed by coa.',
      partition: 'kernel',
      inputSchema: { file_path: z.string() },
      invoke: (args) => {
        coaHandlerInvoked = true;
        coaHandlerArgs = args;
        // The coa handler returns the MARKER, not the real file content — proof
        // that whatever text the model reports back came from THIS handler, not
        // the CLI's own built-in Read reading probe.txt off disk.
        return {
          result: { content: marker },
          handle: 'peek-1',
          pointer: 'peek-1',
        };
      },
    };

    const env = sessionAuthEnv(locator);
    const q = query({
      prompt:
        'Read the file named probe.txt in the current directory using whatever tool is available, then reply with exactly its contents and nothing else.',
      options: {
        cwd: worktree,
        settingSources: [],
        strictMcpConfig: true,
        allowedTools: ['Read'],
        toolAliases: { Read: mcpToolName('peek') },
        mcpServers: { coa: toCoaMcpServer([peekTool]) },
        canUseTool: allowEchoingInput,
        ...(env ? { env } : {}),
      },
    });

    let finalText = '';
    const emitted: string[] = [];
    let advertised: readonly string[] = [];
    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') advertised = message.tools;
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') emitted.push(block.name);
        }
      }
      if (message.type === 'result' && message.subtype === 'success') {
        finalText = message.result;
      }
    }

    // Without this, a failure cannot distinguish "the alias was ignored" from "the model
    // never called Read", and the spike's single most important question would be answered
    // by a bare `expected false to be true`.
    const diagnostic = `coa handler invoked = ${coaHandlerInvoked}; model emitted ${JSON.stringify(emitted)}; init advertised Read = ${advertised.includes('Read')}; final text = ${JSON.stringify(finalText.slice(0, 120))}`;

    expect(coaHandlerInvoked, diagnostic).toBe(true);
    expect(coaHandlerArgs, diagnostic).toBeDefined();
    expect(finalText, diagnostic).toContain(marker);
    // If this fails while coaHandlerInvoked is false, the alias was NOT
    // honored at dispatch time — the model's Read call ran the CLI's own
    // built-in instead, and P1's "Agent is unavailable" assumption survives
    // for real tool-execution purposes even though toolAliases reaches the
    // wire. Record that outcome plainly; do not round it up to "works."
  }, 120_000);

  it('a toolAliases entry for a name that is NOT a real native tool does not crash session initialization', async () => {
    // The offline suite proved the SDK wrapper passes an alias for a fake
    // native-tool name through unvalidated. This asks the other half: does
    // the CLI BINARY reject the whole `initialize` request over it (a hard
    // failure) or silently ignore the unknown key (soft pass-through)? Either
    // answer is useful; what matters is that this is observed, not assumed.
    const worktree = mkdtempSync(join(tmpdir(), 'coa-live-toolalias-fake-'));
    writeFileSync(join(worktree, 'probe.txt'), 'hello from disk', 'utf8');
    const env = sessionAuthEnv(locator);

    const q = query({
      prompt: 'Reply with exactly one word: OK.',
      options: {
        cwd: worktree,
        settingSources: [],
        allowedTools: ['Read'],
        toolAliases: { TotallyNotARealNativeTool: 'mcp__coa__nonexistent' },
        canUseTool: allowEchoingInput,
        ...(env ? { env } : {}),
      },
    });

    let finalText = '';
    let errored = false;
    try {
      for await (const message of q) {
        if (message.type === 'result' && message.subtype === 'success') {
          finalText = message.result;
        }
      }
    } catch {
      errored = true;
    }

    // Record which happened — both are legitimate findings. This assertion
    // will need editing once the real outcome is observed; as written it
    // states the (unverified) hypothesis that a bogus alias key is silently
    // ignored rather than treated as fatal.
    expect(errored).toBe(false);
    expect(finalText.toUpperCase()).toContain('OK');
  }, 60_000);

  it('decides whether an alias makes a native name VISIBLE, or only redirects an already-visible one', async () => {
    // The question the ledger left open, and the one that decides how far coa can take the
    // tool surface. The earlier alias probe left `Read` advertised (it is a default built-in),
    // so it proved redirection, not visibility. Here the built-in set is emptied — `tools: []`
    // — while the alias for `Read` stays. `system:init.tools` is the decisive observable:
    //
    //   `Read` present  ⇒ an alias PUBLISHES the name. coa can empty the built-in set and
    //                     re-present its own tools under native names: coa owns names,
    //                     schemas, descriptions and implementations.
    //   `Read` absent   ⇒ an alias only REDIRECTS a name the harness already advertises. To
    //                     keep a native name, coa must keep the native tool advertised, so
    //                     coa owns the implementation but inherits Anthropic's schema.
    const worktree = mkdtempSync(join(tmpdir(), 'coa-live-alias-visibility-'));
    writeFileSync(join(worktree, 'probe.txt'), 'plain file content, no marker here', 'utf8');
    const marker = `VISIBILITY-${Math.random().toString(36).slice(2, 10)}`;

    let coaHandlerInvoked = false;
    const peekTool: RegisteredTool = {
      name: 'peek',
      description: 'Read a file and report its contents, governed by coa.',
      partition: 'kernel',
      inputSchema: { file_path: z.string() },
      invoke: () => {
        coaHandlerInvoked = true;
        return { result: { content: marker }, handle: 'peek-1', pointer: 'peek-1' };
      },
    };

    const env = sessionAuthEnv(locator);
    const q = query({
      prompt:
        'Read the file named probe.txt in the current directory, then reply with exactly its contents and nothing else.',
      options: {
        cwd: worktree,
        settingSources: [],
        strictMcpConfig: true,
        tools: [],
        toolAliases: { Read: mcpToolName('peek') },
        mcpServers: { coa: toCoaMcpServer([peekTool]) },
        canUseTool: allowEchoingInput,
        ...(env ? { env } : {}),
      },
    });

    let advertised: readonly string[] = [];
    const emitted: string[] = [];
    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') advertised = message.tools;
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') emitted.push(block.name);
        }
      }
    }

    const diagnostic = `init advertised ${JSON.stringify(advertised)}; model emitted ${JSON.stringify(emitted)}; coa handler invoked = ${coaHandlerInvoked}`;

    // VERIFIED LIVE: `tools: []` genuinely empties the built-in set, and a coa MCP tool is
    // advertised alongside it. That is the precondition both worlds need.
    expect(advertised, diagnostic).not.toContain('Bash');
    expect(advertised, diagnostic).toContain(mcpToolName('peek'));

    // SETTLED LIVE, and the original expectation was WRONG. The hypothesis under test was
    // that an alias PUBLISHES its native name, letting coa empty the built-in set and
    // re-present its own tools as `Read`/`Edit`/`Agent`. It does not:
    //
    //     init advertised ["mcp__coa__peek"]; model emitted ["mcp__coa__peek"];
    //     coa handler invoked = true
    //
    // An alias only REDIRECTS a name the harness already advertises. Removing the built-in
    // removes the name, and the alias then has nothing to redirect. So the two capabilities
    // are mutually exclusive, and coa must choose per tool:
    //
    //   keep the built-in advertised + alias it  ⇒ coa owns the IMPLEMENTATION, and the model
    //     sees Anthropic's name, schema and description (the trained priors are preserved).
    //   omit it from `tools`                     ⇒ coa owns name, schema, description AND
    //     implementation, but under `mcp__coa__*`, with no trained prior on the name.
    //
    // There is no third option where coa authors the schema and keeps the native name.
    expect(advertised, diagnostic).not.toContain('Read');

    // The other half of the same run, and the reason omitting a built-in is a real option
    // rather than a dead end: coa's own tool was advertised, the model reached for it
    // unprompted, and coa's handler executed the call.
    expect(coaHandlerInvoked, diagnostic).toBe(true);
    expect(emitted, diagnostic).toContain(mcpToolName('peek'));
  }, 120_000);
});
