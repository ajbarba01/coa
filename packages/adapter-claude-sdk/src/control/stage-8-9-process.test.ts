import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { resolveAuthEnv, sessionAuthEnv } from '../auth-env.js';
import { captureSpawn } from './probe-kit.js';
// These probes spawn real child processes; under a fully loaded suite run the
// default 5s can lapse before a child even boots. One file-wide ceiling, same
// contract as the live suites' setConfig convention.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

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
 * Everything else here (`maxBudgetUsd`) is a plain CLI argv flag and needs no
 * such workaround — `captureSpawn` is used for it directly.
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
  /** Node runtime flags Node itself consumed before populating `argv`. */
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
