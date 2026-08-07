import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  query,
  type Options,
  type SDKUserMessage,
  type SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk';
import { captureSpawn } from './probe-kit.js';

/**
 * Control-spike stages 5-6 — context over time (mid-session injection) and
 * state ownership (session persistence and resume).
 *
 * SDK `@anthropic-ai/claude-agent-sdk` 0.3.196 / CLI 2.1.196 (a4ca500). Every verdict below
 * is stamped against those; the first probe fails loudly when they move, which is the point —
 * a verdict that outlives the version it was taken against is the stale assumption this
 * spike exists to clear.
 *
 * Three probe techniques are used, in increasing order of intrusiveness:
 *   1. `captureSpawn` — what the SDK puts on argv/env for a set of `Options` (the shared harness).
 *   2. `readSdkTypings` — structural assertions over the shipped `sdk.d.ts`. Used only where the
 *      question is "does this channel exist at all", which types can answer and runtime cannot
 *      without the real binary. Never used as evidence about runtime BEHAVIOUR.
 *   3. `captureStdin` — a fake `SpawnedProcess` via `Options.spawnClaudeCodeProcess`, recording
 *      the stream-json frames the SDK writes to the CLI. This is the only way to observe the
 *      protocol-level surface (hook registration, streamed message roles) offline.
 *
 * None of them need credentials or network.
 */

const SDK_VERSION = '0.3.196';
const CLI_VERSION = '2.1.196';
const CLI_COMMIT = 'a4ca500badcac68511fb5f04303e32e4360f3dfb';

const require_ = createRequire(import.meta.url);
const SDK_DIR = dirname(require_.resolve('@anthropic-ai/claude-agent-sdk'));

let typingsCache: string | undefined;
/**
 * The shipped `sdk.d.ts`, as text. Structural evidence only — never behavioural.
 *
 * Line endings are normalised to `\n` because the published file uses CRLF: a pattern
 * written with `\n` silently fails to match on a CRLF checkout, so an assertion would
 * report "the SDK does not have X" when the truth is "this regex cannot see X". A probe
 * that fails for a reason unrelated to its claim is worse than no probe.
 */
function readSdkTypings(): string {
  typingsCache ??= readFileSync(join(SDK_DIR, 'sdk.d.ts'), 'utf8').replace(/\r\n/g, '\n');
  return typingsCache;
}

/** A `SpawnedProcess` that records everything the SDK writes to the CLI's stdin. */
function recordingProcess(frames: string[]): SpawnedProcess {
  const stdin = new PassThrough();
  stdin.on('data', (chunk: Buffer) => frames.push(chunk.toString('utf8')));
  const process_ = {
    stdin,
    stdout: new PassThrough(),
    killed: false,
    exitCode: null,
    kill: (): boolean => true,
    on: (): void => {},
    once: (): void => {},
    off: (): void => {},
  };
  return process_ as unknown as SpawnedProcess;
}

/**
 * Run one `query()` against a fake process and return the newline-delimited JSON frames the
 * SDK wrote to its stdin. The fake never answers, so the SDK gets no further than sending
 * `initialize` and draining the prompt iterable — which is exactly the window that carries
 * the protocol-level facts stages 5-6 need.
 */
async function captureStdin(
  options: Options,
  messages: readonly SDKUserMessage[],
): Promise<unknown[]> {
  const frames: string[] = [];
  const controller = new AbortController();
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    for (const message of messages) yield message;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const q = query({
    prompt: prompt(),
    options: {
      ...options,
      abortController: controller,
      spawnClaudeCodeProcess: () => recordingProcess(frames),
    },
  });
  const drained = (async () => {
    try {
      for await (const _message of q) break;
    } catch {
      // Expected: the fake process never speaks stream-json back.
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  controller.abort();
  try {
    await q.return();
  } catch {
    // Expected.
  }
  await Promise.race([drained, new Promise((resolve) => setTimeout(resolve, 1_000))]);
  return frames
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

describe('stages 5-6 — the version these verdicts were taken against', () => {
  it('pins the SDK and CLI the probes ran on', () => {
    const sdkPackage = JSON.parse(readFileSync(join(SDK_DIR, 'package.json'), 'utf8')) as {
      version: string;
    };
    const manifest = JSON.parse(readFileSync(join(SDK_DIR, 'manifest.json'), 'utf8')) as {
      version: string;
      commit: string;
    };
    expect(sdkPackage.version).toBe(SDK_VERSION);
    expect(manifest.version).toBe(CLI_VERSION);
    expect(manifest.commit).toBe(CLI_COMMIT);
  });
});

describe('stage 5 — is there a mid-session system channel? (re-verifying render-native.ts:44-45)', () => {
  it('transmits a role:system streamed message verbatim, without coercion or rejection', async () => {
    // render-native.ts:44-45 calls "there is no programmatic mid-session role:system channel"
    // a VERIFIED SDK FACT. On 0.3.196 the SDK half of that claim does not hold:
    //   - `SDKUserMessage.message` is `MessageParam` from @anthropic-ai/sdk, whose `role` union
    //     now includes 'system' (asserted separately below);
    //   - the SDK neither validates nor rewrites the role — the frame reaches the CLI intact.
    // What remains unverified is the CLI/API half: whether the harness accepts, coerces, or
    // errors on that frame. That is the live probe. The honest offline verdict is therefore
    // "the claim is no longer supported by the SDK surface", NOT "coa has a system channel".
    const frames = await captureStdin({ settingSources: [] }, [
      {
        type: 'user',
        message: { role: 'system', content: 'coa standing authority' },
        parent_tool_use_id: null,
      },
      { type: 'user', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null },
    ]);
    const userFrames = frames.filter((frame) => isRecord(frame) && frame['type'] === 'user');
    expect(userFrames).toHaveLength(2);
    const first = userFrames[0];
    const message = isRecord(first) ? first['message'] : undefined;
    expect(isRecord(message) ? message['role'] : undefined).toBe('system');
    expect(isRecord(message) ? message['content'] : undefined).toBe('coa standing authority');
  });

  it('types a streamed message with the Anthropic MessageParam, whose role union admits system', () => {
    const typings = readSdkTypings();
    expect(typings).toContain("import type { MessageParam } from '@anthropic-ai/sdk/resources';");
    expect(typings).toMatch(
      /export declare type SDKUserMessage = \{\s*type: 'user';\s*message: MessageParam;/,
    );
    const declarations = readFileSync(
      require_.resolve('@anthropic-ai/sdk/resources/messages/messages').replace(/\.m?js$/, '.d.ts'),
      'utf8',
    );
    expect(declarations).toMatch(
      /export interface MessageParam \{[\s\S]*?role: 'user' \| 'assistant' \| 'system';/,
    );
  });

  it('lets a streamed message land in the transcript without provoking a turn', () => {
    // A second, less obvious injection lever on the same channel: `shouldQuery: false` appends
    // to the transcript and merges into the next real turn. Relevant to M4 because it is a way
    // to place content in context out-of-band with the user's turns.
    const typings = readSdkTypings();
    expect(typings).toContain('shouldQuery?: boolean;');
    expect(typings).toMatch(/appended to the transcript without triggering an assistant turn/);
  });

  it('offers additionalContext on exactly these hook outputs, and none of them is PreCompact', () => {
    // `additionalContext` is the other candidate for a mid-session channel. It exists widely —
    // but every carrier is a USER-visible turn-scoped event, and the two compaction events are
    // absent from the list. So it is an injection channel, not a system channel, and it cannot
    // be used to steer a compaction.
    const typings = readSdkTypings();
    const carriers = [
      ...typings.matchAll(/hookEventName: '(\w+)';\s*(?:[^}]*?)additionalContext\?/g),
    ]
      .map((match) => match[1] ?? '')
      .sort();
    expect(carriers).toEqual([
      'Notification',
      'PostToolBatch',
      'PostToolUse',
      'PostToolUseFailure',
      'PreToolUse',
      'SessionStart',
      'Setup',
      'Stop',
      'SubagentStart',
      'SubagentStop',
      'UserPromptExpansion',
      'UserPromptSubmit',
    ]);
    expect(carriers).not.toContain('PreCompact');
    expect(carriers).not.toContain('PostCompact');
    expect(carriers).not.toContain('InstructionsLoaded');
  });

  it('gives InstructionsLoaded no output channel at all', () => {
    // Checked because the task named it as a candidate: it fires when a memory file is loaded
    // (including `load_reason: 'compact'`), but it is input-only — no specific output exists,
    // so it cannot rewrite what was loaded.
    const typings = readSdkTypings();
    expect(typings).toContain('InstructionsLoadedHookInput');
    expect(typings).not.toContain('InstructionsLoadedHookSpecificOutput');
    expect(typings).toContain(
      "load_reason: 'session_start' | 'nested_traversal' | 'path_glob_match' | 'include' | 'compact';",
    );
  });
});

describe('stage 6 — state ownership: where does the session actually live?', () => {
  it('maps the persistence options onto their argv flags', async () => {
    const off = await captureSpawn({ settingSources: [], persistSession: false });
    expect(off.argv).toContain('--no-session-persistence');

    const on = await captureSpawn({ settingSources: [], persistSession: true });
    expect(on.argv).not.toContain('--no-session-persistence');

    const resumed = await captureSpawn({
      settingSources: [],
      resume: '11111111-1111-4111-8111-111111111111',
      forkSession: true,
      resumeSessionAt: '44444444-4444-4444-8444-444444444444',
    });
    expect(resumed.flag('--resume')).toBe('11111111-1111-4111-8111-111111111111');
    expect(resumed.argv).toContain('--fork-session');
    expect(resumed.flag('--resume-session-at')).toBe('44444444-4444-4444-8444-444444444444');

    const identified = await captureSpawn({
      settingSources: [],
      sessionId: '22222222-2222-4222-8222-222222222222',
    });
    expect(identified.flag('--session-id')).toBe('22222222-2222-4222-8222-222222222222');

    const continued = await captureSpawn({ settingSources: [], continue: true });
    expect(continued.argv).toContain('--continue');
  });
});
