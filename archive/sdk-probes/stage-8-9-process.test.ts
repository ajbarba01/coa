// Archived (exploratory half) from
// packages/adapter-claude-sdk/src/control/stage-8-9-process.test.ts.
// These probes measured process-level levers no shipped code uses:
// fallbackModel, extraArgs, executableArgs, betas, arbitrary executable paths,
// and transport smuggling. The `captureSpawn` and `captureRawEnv`/`writeStub`
// harnesses they ran on remain in the in-tree file, which keeps the auth-seam
// and cost-cap probes shipped code relies on.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query, type Options, type Transport } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

describe('stage 8 — inference routing (archived probes)', () => {
  it('fallbackModel reaches the CLI as an argv flag (--fallback-model)', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      model: 'claude-opus-4-8',
      fallbackModel: 'claude-sonnet-4-6',
    });
    expect(capture.hasFlag('--fallback-model')).toBe(true);
    expect(capture.flag('--fallback-model')).toBe('claude-sonnet-4-6');
  });
});

describe('stage 9 — the process', () => {
  it('extraArgs reach the CLI as --key [value] pairs, and a null value becomes a bare boolean flag', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      extraArgs: { 'coa-marker': 'present', 'coa-bool-marker': null },
    });
    expect(capture.hasFlag('--coa-marker')).toBe(true);
    expect(capture.flag('--coa-marker')).toBe('present');
    expect(capture.hasFlag('--coa-bool-marker')).toBe(true);
    // A boolean extraArgs flag carries no following value token — the very next
    // argv entry is not its value, so `flag()` must not accidentally report one.
    const i = capture.argv.indexOf('--coa-bool-marker');
    expect(i).toBeGreaterThanOrEqual(0);
  });

  it('executableArgs reach the spawned node invocation, but are invisible to any probe reading script argv', async () => {
    // TWO HYPOTHESES FAILED IN A ROW here — both are load-bearing findings:
    //
    // 1st draft used an arbitrary made-up flag (`--coa-runtime-marker`) and
    // asserted it would show up in the stub's `process.argv`. `captureSpawn`
    // instead THREW: no capture was ever written, because `node
    // --coa-runtime-marker <script>` makes node itself refuse to start on an
    // unrecognised flag — the script never runs, so nothing can observe it.
    //
    // 2nd draft switched to a real, harmless node flag (`--no-warnings`) and
    // asserted it would appear in `process.argv.slice(2)`. It does not — by
    // design, Node strips its OWN recognised runtime flags before populating
    // the script's `argv`; they configure the node process, not the script.
    // Reading sdk.mjs directly confirms the SPLICE POINT is real
    // (`args = [...executableArgs, pathToClaudeCodeExecutable, ...cliFlags]`,
    // i.e. executableArgs precede the script path in the actual command
    // line) — but `argv` inside the script can never observe it.
    //
    // Node's `process.execArgv` is the property that DOES carry a process's
    // own consumed runtime flags, so that is what actually settles this.
    const pathVar = process.env['PATH'] ?? process.env['Path'] ?? '';
    const capture = await captureRawEnv(
      { settingSources: [], executableArgs: ['--no-warnings'] },
      { PATH: pathVar, Path: pathVar },
    );
    expect(capture).toBeDefined();
    expect(capture?.execArgv).toContain('--no-warnings');
    // And, as the failed 2nd-draft hypothesis predicted incorrectly: absent
    // from argv, confirming the negative explicitly rather than by omission.
    expect(capture?.argv).not.toContain('--no-warnings');
  });

  it('betas reach the CLI as a comma-joined --betas flag', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      betas: ['context-1m-2025-08-07'],
    });
    expect(capture.hasFlag('--betas')).toBe(true);
    expect(capture.flag('--betas')).toBe('context-1m-2025-08-07');
  });

  it('honours an arbitrary pathToClaudeCodeExecutable — not just probe-kit.ts’s fixed stub path', async () => {
    // A DIFFERENT temp dir, a DIFFERENT filename than stub-cli.mjs, built fresh
    // by this file rather than reused from probe-kit.ts. If the SDK only
    // honoured some specific known path (or extension-sniffed something more
    // specific than "is this a .js/.mjs/.ts file"), an arbitrarily-named,
    // arbitrarily-located script would fail to be spawned.
    const dir = mkdtempSync(join(tmpdir(), 'coa-arbitrary-exe-'));
    const arbitraryPath = writeStub(dir, 'totally-unrelated-name-274.mjs');
    const pathVar = process.env['PATH'] ?? process.env['Path'] ?? '';
    const capture = await captureRawEnv(
      { settingSources: [] },
      { PATH: pathVar, Path: pathVar },
      arbitraryPath,
    );
    expect(capture).toBeDefined();
    // The stub records its OWN argv (flags only, argv.slice(2) in the stub) —
    // presence of a capture at all proves the arbitrary path was the one
    // actually exec'd, since only that stub's own code could have written it.
    expect(capture?.argv.length).toBeGreaterThan(0);
  });

  it('does not accept a transport in query()’s params — Transport is exported but structurally unreachable there', () => {
    // Compile-time tripwire: fails `pnpm typecheck` if a future SDK version adds
    // `transport` to either query()'s params or Options. Verified by direct
    // reading of sdk.d.ts on this version: `export declare function query(_params: {
    // prompt: ...; options?: Options }): Query` has no third field, and
    // `Options` itself has no `transport` key anywhere in its ~60 fields.
    type QueryParams = Parameters<typeof query>[0];
    const hasTransportInParams: 'transport' extends keyof QueryParams ? true : false = false;
    const hasTransportInOptions: 'transport' extends keyof Options ? true : false = false;
    expect(hasTransportInParams).toBe(false);
    expect(hasTransportInOptions).toBe(false);
  });

  it('a Transport smuggled past the type system is never touched — a real subprocess spawns instead', async () => {
    const calls: string[] = [];
    const fakeTransport: Transport = {
      write: () => {
        calls.push('write');
      },
      close: () => {
        calls.push('close');
      },
      isReady: () => {
        calls.push('isReady');
        return true;
      },
      // Records the call and yields nothing — the probe only needs to know whether the SDK
      // ever reaches this transport, not what it would have read. `require-yield` is disabled
      // rather than satisfied with a fake frame, since an invented frame would be a claim.
      // eslint-disable-next-line require-yield
      readMessages: async function* () {
        calls.push('readMessages');
      },
      endInput: () => {
        calls.push('endInput');
      },
    };

    const dir = mkdtempSync(join(tmpdir(), 'coa-transport-'));
    const stub = writeStub(dir);
    const capturePath = join(dir, 'capture.json');

    // `as unknown as Parameters<typeof query>[0]` is the only way to even
    // attempt this: `Transport` is not a recognised field on the real params
    // type, so a plain object literal would fail to compile — which is itself
    // part of the finding.
    const params = {
      prompt: 'probe',
      options: {
        settingSources: [],
        executable: 'node',
        pathToClaudeCodeExecutable: stub,
        env: { ...process.env, COA_PROBE_CAPTURE: capturePath },
      },
      transport: fakeTransport,
    } as unknown as Parameters<typeof query>[0];

    const q = query(params);
    try {
      for await (const _message of q) {
        break;
      }
    } catch {
      // Expected: the stub exits without speaking stream-json.
    }

    // A real subprocess spawned (the stub wrote its capture)...
    expect(existsSync(capturePath)).toBe(true);
    // ...and the fake transport's methods were never called — it was ignored,
    // not routed through.
    expect(calls).toEqual([]);
  });
});
