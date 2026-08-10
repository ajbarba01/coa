import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { captureSpawn } from './probe-kit.js';
// These probes spawn real child processes; under a fully loaded suite run the
// default 5s can lapse before a child even boots. One file-wide ceiling, same
// contract as the live suites' setConfig convention.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * Control-spike stages 1-2 — what the model is, what tools exist.
 * SDK 0.3.196 / CLI 2.1.196 (a4ca500). See
 * docs/superpowers/specs/2026-08-02-claude-sdk-control-spike-design.md.
 *
 * IMPORTANT STRUCTURAL FINDING, discovered while writing these probes and load-
 * bearing for almost everything below: `systemPrompt`, `toolAliases`, `agents`,
 * `skills` (as raw names), `hooks`, and several other `Options` fields never
 * reach argv at all. Reading the installed `@anthropic-ai/claude-agent-sdk`
 * wrapper (`sdk.mjs` — the wrapper is source-available; only the compiled CLI
 * binary carries the harder "all rights reserved" opacity) shows the SDK
 * spawns the CLI with a small, fixed argv built from a handful of fields
 * (`allowedTools`, `disallowedTools`, `tools`, `mcp-config`, `setting-sources`,
 * `strict-mcp-config`, `permission-mode`, `model`, `agent` (singular),
 * `managed-settings`, `plugin-dir`, …), then — AFTER the process is already
 * running — writes ONE more line to its stdin: a `control_request` envelope
 * (`{request_id, type:'control_request', request:{subtype:'initialize', hooks,
 * systemPrompt, toolAliases, agents, skills, ...}}`) and awaits a
 * `control_response`. `captureSpawn` (probe-kit.ts) intentionally only records
 * argv/env — it says as much in its own doc comment — so it is structurally
 * blind to this second channel: a probe asserting `capture.argv` contains
 * `systemPrompt`/`toolAliases` content will always read "not found," whether or
 * not the SDK actually sent it, because that content never travels via argv on
 * this version.
 *
 * `captureInitialize` below is a second, local harness (not a change to
 * probe-kit.ts, which the plan scopes as untouched) that captures that one
 * stdin line the same way probe-kit's stub captures argv: write a stub that
 * reads it, then exits before ever answering the control protocol. This lets
 * the probes below assert the REAL wire shape of `systemPrompt`/`skills`, not
 * just their absence from argv.
 */

// ---------------------------------------------------------------------------
// Local harness: captures the one `control_request` line the SDK writes to
// the child's stdin as part of `Query.initialize()`, immediately after spawn.
// Mirrors probe-kit's own trick (capture before the protocol handshake
// completes) one layer deeper — the CLI never gets to answer, so the SDK's
// `initialize()` call hangs, but by then the line has already been written
// and captured, and the stub has already exited, which unblocks the read loop
// with a transport-closed error the same way probe-kit's does.
// ---------------------------------------------------------------------------

interface InitializeCapture {
  /** argv, exactly as SpawnCapture reports it, for cross-checking against captureSpawn. */
  readonly argv: string[];
  /** The `request` payload of the captured `control_request`, or undefined if none arrived. */
  readonly request: Record<string, unknown> | undefined;
}

function writeStdinCaptureStub(dir: string): string {
  const stubPath = join(dir, 'stdin-capture-stub.mjs');
  // Deliberately minimal: write argv first (so a partial capture is still
  // useful), then read one line of stdin (NDJSON control protocol — one JSON
  // object per line) and write it out, then exit. Never speaks the protocol
  // back, same as probe-kit's stub-cli.mjs.
  const source = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';


const out = process.env['COA_PROBE_CAPTURE'];
const stdinOut = process.env['COA_PROBE_STDIN_CAPTURE'];
if (!out) {
  process.stderr.write('stdin-capture-stub: COA_PROBE_CAPTURE is unset\\n');
  process.exit(2);
}
writeFileSync(out, JSON.stringify({ argv: process.argv.slice(2) }), 'utf8');
if (!stdinOut) {
  process.exit(0);
}

let done = false;
function finish(line) {
  if (done) return;
  done = true;
  writeFileSync(stdinOut, JSON.stringify({ line: line ?? null }), 'utf8');
  process.exit(0);
}
const rl = createInterface({ input: process.stdin });
rl.once('line', (line) => finish(line));
rl.once('close', () => finish(undefined));
const guard = setTimeout(() => finish(undefined), 2000);
guard.unref();
`;
  writeFileSync(stubPath, source, 'utf8');
  return stubPath;
}

/**
 * Run one `query()` against the stdin-capturing stub and return both argv and
 * the `initialize` control-request payload the SDK wrote to its stdin, if any.
 */
async function captureInitialize(options: Options, prompt = 'probe'): Promise<InitializeCapture> {
  const dir = mkdtempSync(join(tmpdir(), 'coa-probe-init-'));
  const capturePath = join(dir, 'capture.json');
  const stdinPath = join(dir, 'stdin.json');
  const stub = writeStdinCaptureStub(dir);

  const q = query({
    prompt,
    options: {
      ...options,
      executable: 'node',
      pathToClaudeCodeExecutable: stub,
      env: { ...process.env, COA_PROBE_CAPTURE: capturePath, COA_PROBE_STDIN_CAPTURE: stdinPath },
    },
  });

  try {
    for await (const _message of q) {
      break;
    }
  } catch {
    // Expected: the stub exits without completing the control-protocol handshake.
  }

  // The child's write of argv/stdin-capture is a filesystem op racing our read
  // loop's throw; give it a short grace window.
  const deadline = Date.now() + 3000;
  while (!existsSync(stdinPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const argv = existsSync(capturePath)
    ? (JSON.parse(readFileSync(capturePath, 'utf8')) as { argv: string[] }).argv
    : [];

  if (!existsSync(stdinPath)) {
    return { argv, request: undefined };
  }
  const raw = JSON.parse(readFileSync(stdinPath, 'utf8')) as { line: string | null };
  if (raw.line === null || raw.line === '') {
    return { argv, request: undefined };
  }
  const envelope = JSON.parse(raw.line) as { type?: string; request?: Record<string, unknown> };
  return { argv, request: envelope.request };
}

// ===========================================================================
// Stage 1 — what the model is
// ===========================================================================

describe('stage 1 — what the model is', () => {
  it('FINDING: a raw-string systemPrompt does NOT appear in argv at all', async () => {
    // Original hypothesis (plan draft): argv would contain the raw string.
    // Observed: systemPrompt never reaches argv on this SDK version — it is
    // stdio-protocol-only (see file-level comment). This is the negative half
    // of that finding, backed by captureSpawn (argv-only) directly.
    const capture = await captureSpawn({
      systemPrompt: 'coa is the only authority here.',
      settingSources: [],
    });
    expect(capture.argv.join(' ')).not.toContain('coa is the only authority here.');
    // And no flag resembling a system-prompt CLI flag exists in argv either.
    expect(capture.argv.some((a) => /system-prompt/i.test(a))).toBe(false);
  });

  it('sends a raw-string systemPrompt over the stdio initialize request, wrapped in an array', async () => {
    const capture = await captureInitialize({
      systemPrompt: 'coa is the only authority here.',
      settingSources: [],
    });
    expect(capture.request).toBeDefined();
    // Observed wire shape: the wrapper does `typeof systemPrompt === 'string'
    // ? [systemPrompt] : systemPrompt` before sending — a raw string is NOT
    // sent as a raw string on the wire; it becomes a one-element array. Any
    // consumer inspecting the CLI's own stdin traffic must know this.
    expect(capture.request?.['systemPrompt']).toEqual(['coa is the only authority here.']);
  });

  it('FINDING: preset + append is NOT sent as the object shape — it splits into a separate appendSystemPrompt field, and the preset name never appears on the wire', async () => {
    // Original hypothesis (mine, first draft of this probe): the preset object
    // travels intact, `{ type: 'preset', preset: 'claude_code', append: '...' }`.
    // Observed (confirmed by a standalone debug capture of the raw stdin line,
    // reproducible across three separate runs): the wire payload has NO
    // `systemPrompt` key at all in this case. Instead it carries a sibling key,
    // `appendSystemPrompt`, holding just the append text. `type`/`preset` are
    // never wire-visible in any form — there is exactly one preset, so "use the
    // preset" is the wire's implicit default, and coa's append is Shaped
    // (layered on) rather than a full systemPrompt replacement, exactly as
    // sdk-options.ts's own comment claims — but the WIRE MECHANISM for that
    // layering is a distinct field, not a variant of the same one.
    const capture = await captureInitialize({
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'coa layer' },
      settingSources: [],
    });
    expect(capture.request?.['systemPrompt']).toBeUndefined();
    expect(capture.request?.['appendSystemPrompt']).toBe('coa layer');
    // And, symmetrically with the raw-string case, none of it reaches argv.
    expect(capture.argv.join(' ')).not.toContain('coa layer');
  });

  it('a bare preset with no append sends no systemPrompt-related key at all', async () => {
    const capture = await captureInitialize({
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: [],
    });
    // Observed: the request has ONLY `{ subtype: 'initialize' }` — the preset
    // selection itself is wire-invisible, matching there being exactly one
    // preset value in the type. coa's own `sdk-options.ts` comment ("append is
    // omitted entirely when there is nothing to add") produces exactly this
    // shape when `backend.systemPrompt === ''`.
    expect(capture.request).toEqual({ subtype: 'initialize' });
  });

  it('excludeDynamicSections reaches the wire as its own sibling key, same pattern as append', async () => {
    const capture = await captureInitialize({
      systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
      settingSources: [],
    });
    expect(capture.request?.['systemPrompt']).toBeUndefined();
    expect(capture.request?.['excludeDynamicSections']).toBe(true);
  });

  it('FINDING: omitting Options.systemPrompt entirely is NOT wire-identical to the bare-preset object form', async () => {
    // A genuine SDK-wrapper quirk, verified by direct stdin capture: leaving
    // `systemPrompt` off `Options` altogether does not produce the same
    // "no systemPrompt key" request as `{ type: 'preset', preset: 'claude_code' }`
    // does (the probe above). Instead the wrapper appears to default the
    // OPTION to an empty string somewhere ahead of the initialize-payload
    // construction, so the wire carries `systemPrompt: ['']` — a concrete,
    // non-preset value. Whether the CLI then treats `['']` the same as "use
    // the default preset" is a CLI-internal behavior this offline harness
    // cannot observe (the stub never runs the real binary); flagged as an
    // open question for the live pass / binary track, not asserted either way.
    const capture = await captureInitialize({ settingSources: [] });
    expect(capture.request?.['systemPrompt']).toEqual(['']);
  });

  it('the SYSTEM_PROMPT_DYNAMIC_BOUNDARY string[] form is sent through unmodified (no wrap, no split performed client-side)', async () => {
    const { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } = await import('@anthropic-ai/claude-agent-sdk');
    const capture = await captureInitialize({
      systemPrompt: ['static prefix', SYSTEM_PROMPT_DYNAMIC_BOUNDARY, 'dynamic suffix'],
      settingSources: [],
    });
    expect(capture.request?.['systemPrompt']).toEqual([
      'static prefix',
      SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
      'dynamic suffix',
    ]);
  });

  it('settingSources: [] produces an inline-empty flag, distinguishable from omission', async () => {
    const empty = await captureSpawn({ settingSources: [] });
    const omitted = await captureSpawn({});
    expect(empty.hasFlag('--setting-sources')).toBe(true);
    expect(empty.flag('--setting-sources')).toBe('');
    expect(omitted.hasFlag('--setting-sources')).toBe(false);
    expect(omitted.flag('--setting-sources')).toBeUndefined();
  });

  it('settingSources with entries puts them on the inline flag, comma-joined', async () => {
    const capture = await captureSpawn({ settingSources: ['project', 'user'] });
    expect(capture.flag('--setting-sources')).toBe('project,user');
  });

  it('model reaches argv via --model', async () => {
    const capture = await captureSpawn({ model: 'claude-opus-4-6', settingSources: [] });
    expect(capture.flag('--model')).toBe('claude-opus-4-6');
  });
});

// ===========================================================================
// Stage 2 — what tools exist
// ===========================================================================

describe('stage 2 — what tools exist', () => {
  it('distinguishes an empty tool set from an omitted one, and both from the omitted-managed-tools default', async () => {
    const empty = await captureSpawn({ tools: [], settingSources: [] });
    const omitted = await captureSpawn({ settingSources: [] });
    expect(empty.argv).not.toEqual(omitted.argv);
    // Observed shape: `tools: []` pushes an inline-empty `--tools` flag ("disable
    // all built-ins"); omission pushes no `--tools` flag at all (SDK/CLI default).
    expect(empty.hasFlag('--tools')).toBe(true);
    expect(empty.flag('--tools')).toBe('');
    expect(omitted.hasFlag('--tools')).toBe(false);
  });

  it('tools as an explicit array is comma-joined onto --tools', async () => {
    const capture = await captureSpawn({ tools: ['Bash', 'Read'], settingSources: [] });
    expect(capture.flag('--tools')).toBe('Bash,Read');
  });

  it('the object-form preset differs from both omission and the empty array — and does not encode WHICH preset', async () => {
    const capture = await captureSpawn({
      tools: { type: 'preset', preset: 'claude_code' },
      settingSources: [],
    });
    // FINDING: read literally, the argv builder does `Array.isArray(tools) ?
    // ... : Z.push('--tools','default')` — the object form collapses to the
    // literal string "default" regardless of which preset name was given. The
    // preset name itself never reaches argv; only "there IS a preset" does.
    expect(capture.flag('--tools')).toBe('default');
  });

  it('a named skills array reaches argv indirectly, folded into --allowedTools as Skill(name) entries', async () => {
    // FINDING: skills is NOT purely stdio-protocol-only, unlike systemPrompt/
    // toolAliases/agents. Reading sdk.mjs: when `skills` is an array, the
    // wrapper synthesizes `Skill(<name>)` entries and merges them into the
    // allowedTools list BEFORE building argv, so a named skills array is
    // (indirectly) argv-observable.
    const capture = await captureSpawn({ skills: ['pdf', 'docx'], settingSources: [] });
    expect(capture.flag('--allowedTools')).toContain('Skill(pdf)');
    expect(capture.flag('--allowedTools')).toContain('Skill(docx)');
  });

  it("skills: 'all' folds a single generic Skill entry into --allowedTools, not per-name entries", async () => {
    const capture = await captureSpawn({ skills: 'all', settingSources: [] });
    expect(capture.flag('--allowedTools')).toContain('Skill');
    expect(capture.flag('--allowedTools')).not.toContain('Skill(');
  });

  it('the named skills array is ALSO forwarded on the stdio initialize request (redundant with argv)', async () => {
    const capture = await captureInitialize({ skills: ['pdf'], settingSources: [] });
    expect(capture.request?.['skills']).toEqual(['pdf']);
  });

  it("skills: 'all' is NOT forwarded on the stdio initialize request (only the array form is)", async () => {
    const capture = await captureInitialize({ skills: 'all', settingSources: [] });
    // Observed: `Array.isArray(skills) ? skills : void 0` — the 'all' sentinel
    // does not survive onto the initialize payload's `skills` field at all.
    expect(capture.request?.['skills']).toBeUndefined();
  });

  it('strictMcpConfig reaches argv as a bare boolean flag', async () => {
    const on = await captureSpawn({ strictMcpConfig: true, settingSources: [] });
    const off = await captureSpawn({ strictMcpConfig: false, settingSources: [] });
    expect(on.hasFlag('--strict-mcp-config')).toBe(true);
    expect(off.hasFlag('--strict-mcp-config')).toBe(false);
  });
});
