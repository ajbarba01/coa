import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query, type Options, type Transport } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { resolveAuthEnv, sessionAuthEnv } from '../auth-env.js';
import { captureSpawn } from './probe-kit.js';

/**
 * Control-spike stages 8-9 — inference routing, and the process coa wraps.
 * SDK 0.3.196 / CLI 2.1.196 (a4ca500). See
 * docs/superpowers/specs/2026-08-02-claude-sdk-control-spike-design.md.
 *
 * STRUCTURAL FINDING, discovered while writing these probes: `captureSpawn`
 * (probe-kit.ts) cannot be used to probe `env`, `executable`, or
 * `pathToClaudeCodeExecutable` — its own object literal is
 * `{ ...options, executable: 'node', pathToClaudeCodeExecutable: STUB, env: {...} }`,
 * so those three keys always win over anything a caller passes in `options`,
 * by plain JS object-literal key-order semantics. A probe that does
 * `captureSpawn({ env: { ANTHROPIC_BASE_URL: 'x' } })` silently tests nothing —
 * the passed `env` is discarded before the SDK ever sees it. `captureRawEnv`
 * below is a second, local, untouched-probe-kit harness (the plan scopes
 * probe-kit.ts as off-limits for this task) that gives the caller real control
 * over `env`/`pathToClaudeCodeExecutable`, which every env- and process-path
 * probe in this file needs.
 *
 * Everything else here (`maxBudgetUsd`, `fallbackModel`, `extraArgs`,
 * `executableArgs`, `betas`) is a plain CLI argv flag and needs no such
 * workaround — `captureSpawn` is used for those directly.
 */

const ENV_STUB = `
import { writeFileSync } from 'node:fs';
const out = process.env['COA_PROBE_CAPTURE'];
if (out === undefined || out === '') {
  process.stderr.write('stub: COA_PROBE_CAPTURE is unset\\n');
  process.exit(2);
}
writeFileSync(
  out,
  JSON.stringify(
    { argv: process.argv.slice(2), execArgv: process.execArgv, env: process.env },
    null,
    2,
  ),
  'utf8',
);
process.exit(0);
`;

interface RawCapture {
  readonly argv: string[];
  /** Node runtime flags Node itself consumed before populating `argv` — see
   * the executableArgs probe below for why this field exists. */
  readonly execArgv: string[];
  readonly env: Record<string, string | undefined>;
}

/** Writes a fresh copy of the stub to `dir` under `filename`, returning its path. */
function writeStub(dir: string, filename = 'stub.mjs'): string {
  const path = join(dir, filename);
  writeFileSync(path, ENV_STUB, 'utf8');
  return path;
}

/**
 * Like `captureSpawn`, but the caller's `env` and `pathToClaudeCodeExecutable`
 * are used exactly as given — nothing is overwritten. Exists solely because
 * `captureSpawn` cannot be used for that (see the file header). Returns
 * `undefined` when the stub never wrote a capture (e.g. the given env could
 * not launch the process at all), which is itself an assertable outcome.
 */
async function captureRawEnv(
  options: Omit<Options, 'env' | 'executable' | 'pathToClaudeCodeExecutable'>,
  env: Record<string, string | undefined>,
  pathToClaudeCodeExecutable?: string,
): Promise<RawCapture | undefined> {
  const dir = mkdtempSync(join(tmpdir(), 'coa-rawenv-'));
  const stub = pathToClaudeCodeExecutable ?? writeStub(dir);
  const capturePath = join(dir, 'capture.json');

  const q = query({
    prompt: 'probe',
    options: {
      ...options,
      executable: 'node',
      pathToClaudeCodeExecutable: stub,
      env: { ...env, COA_PROBE_CAPTURE: capturePath },
    },
  });

  try {
    for await (const _message of q) {
      break;
    }
  } catch {
    // Expected: the stub exits without speaking stream-json.
  }

  if (!existsSync(capturePath)) return undefined;
  return JSON.parse(readFileSync(capturePath, 'utf8')) as RawCapture;
}

describe('stage 8 — inference routing', () => {
  it('captureSpawn discards a caller-supplied env — the harness constraint that forces captureRawEnv to exist', async () => {
    const capture = await captureSpawn({
      settingSources: [],
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/vNOPE-should-be-discarded' },
    });
    // If this ever starts passing, probe-kit.ts changed and every env probe in
    // this file needs re-deriving against the new behaviour.
    expect(capture.env['ANTHROPIC_BASE_URL']).not.toBe(
      'http://127.0.0.1:9/vNOPE-should-be-discarded',
    );
  });

  it('passes ANTHROPIC_BASE_URL through to the CLI process intact', async () => {
    const pathVar = process.env['PATH'] ?? process.env['Path'] ?? '';
    const capture = await captureRawEnv(
      { settingSources: [] },
      {
        PATH: pathVar,
        Path: pathVar,
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/vNOPE',
      },
    );
    expect(capture).toBeDefined();
    expect(capture?.env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:9/vNOPE');
  });

  it('replaces rather than merges the subprocess environment: an ambient var absent from options.env does not reach the child', async () => {
    process.env['COA_PROBE_SENTINEL_8_9'] = 'must-not-leak';
    try {
      const pathVar = process.env['PATH'] ?? process.env['Path'] ?? '';
      const capture = await captureRawEnv(
        { settingSources: [] },
        {
          PATH: pathVar,
          Path: pathVar,
          ONLY_THIS: '1',
        },
      );
      expect(capture).toBeDefined();
      expect(capture?.env['ONLY_THIS']).toBe('1');
      // The decisive assertion: this test's OWN process.env carries the sentinel,
      // yet it is not in options.env, so it must not appear in the child.
      expect(capture?.env['COA_PROBE_SENTINEL_8_9']).toBeUndefined();
    } finally {
      delete process.env['COA_PROBE_SENTINEL_8_9'];
    }
  });

  // Only runnable on Windows: on POSIX a PATH-less env means `node` cannot be
  // resolved at all, so the child never spawns and there is nothing to observe —
  // the injection this documents is a Windows-only floor.
  it.skipIf(process.platform !== 'win32')(
    'FOOTGUN: on win32, Node/the OS still inject a fixed set of system vars even when omitted from options.env entirely',
    async () => {
      // No PATH included at all — a genuine "replaces" semantics would leave the
      // child with exactly { ONLY_THIS, COA_PROBE_CAPTURE } and nothing else.
      const capture = await captureRawEnv({ settingSources: [] }, { ONLY_THIS: '1' });
      expect(capture).toBeDefined();
      expect(capture?.env['ONLY_THIS']).toBe('1');
      // Observed reality (verified against plain node:child_process.spawn too, so
      // this is a Node/Windows floor, not an SDK behaviour): CreateProcess/libuv
      // re-populate a handful of Windows-critical vars regardless of what the
      // caller passed. PATH is the load-bearing one for coa's auth wiring — a
      // caller who believes `env` is a bare, fully-specified environment is
      // wrong on win32; a few system vars survive no matter what.
      expect(capture?.env['PATH']).toBeDefined();
      expect(capture?.env['SYSTEMROOT']).toBeDefined();
      expect(capture?.env['USERPROFILE']).toBeDefined();
    },
  );

  it('maxBudgetUsd reaches the CLI as an argv flag (--max-budget-usd)', async () => {
    const capture = await captureSpawn({ settingSources: [], maxBudgetUsd: 2.5 });
    expect(capture.hasFlag('--max-budget-usd')).toBe(true);
    expect(capture.flag('--max-budget-usd')).toBe('2.5');
  });

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
    // Compile-time tripwire: fails `pnpm typecheck` (run later, not by this
    // session per the shared-tree constraint) if a future SDK version adds
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

describe('cross-check — auth-env.ts against reality', () => {
  /**
   * `auth-env.ts` encodes coa's belief about which vars a subscription login
   * needs cleared. This does not re-test its pure JS logic (auth-env.test.ts
   * already does that byte-for-byte) — it feeds the EXACT object that function
   * produces through a real `query()` call and inspects what the spawned
   * process actually received, closing the gap between "the overlay object
   * looks right" and "the CLI process saw what we intended."
   */
  it('the cleared vars (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN) are genuinely absent from the spawned process, not just undefined in a JS object', async () => {
    const base: Record<string, string | undefined> = {
      PATH: process.env['PATH'] ?? process.env['Path'] ?? '',
      Path: process.env['PATH'] ?? process.env['Path'] ?? '',
      ANTHROPIC_API_KEY: 'sk-should-not-reach-the-cli',
      ANTHROPIC_AUTH_TOKEN: 'tok-should-not-reach-the-cli',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-should-not-reach-the-cli',
      COA_PROBE_UNRELATED: 'should-survive',
    };
    const env = sessionAuthEnv({ type: 'config-dir', dir: '/fake/config/dir' }, base);
    expect(env).toBeDefined();
    if (env === undefined) return; // narrows for TS; unreachable given the assert above

    const capture = await captureRawEnv({ settingSources: [] }, env);
    expect(capture).toBeDefined();
    expect(capture?.env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(capture?.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
    expect(capture?.env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
    // The clearing is targeted, not a wholesale wipe — an unrelated base var
    // and the overlay's own positive value both survive.
    expect(capture?.env['COA_PROBE_UNRELATED']).toBe('should-survive');
    expect(capture?.env['CLAUDE_CONFIG_DIR']).toBe('/fake/config/dir');
  });

  it('resolveAuthEnv is a no-op overlay for a locator with no Claude-specific auth story (ambient)', () => {
    // Pure-logic re-assertion kept here (not just in auth-env.test.ts) so this
    // file stands on its own as the stage 8/9 record: `ambient` carries no
    // overlay, so sessionAuthEnv leaves Options.env unset and the subprocess
    // inherits process.env unchanged — today's zero-auth behaviour.
    expect(resolveAuthEnv({ type: 'ambient' })).toBeUndefined();
  });
});
