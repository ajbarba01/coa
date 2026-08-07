import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushSchema, type Push, type RpcNotification, type TurnFrame } from '@coa/shared';
import {
  barebonesProfile,
  type BackendConfig,
  type CanUseTool,
  type RuntimeAdapter,
  type RuntimeUsage,
  type StopPredicate,
} from '@coa/spi';
import {
  buildSessionHandlers,
  composeSessionDeps,
  connectClient,
  createDaemonCore,
  listen,
  LiveSessionRegistry,
  type RpcServer,
  type SessionAdapterInit,
} from '@coa/core';
import { runSession } from './cli.js';

/**
 * End-to-end proof of the `coa run` path over a real OS pipe with a FAKE backend:
 * client → daemon → session lifecycle → live push → terminal render. The live-SDK
 * smoke test (a real `query()`) is the v0-spike gate and runs behind auth, not here.
 */

/** A backend that echoes the input as an assistant text frame, then settles. */
function echoAdapter(init: SessionAdapterInit): RuntimeAdapter {
  const frames: TurnFrame[] = [
    { t: 'text', text: `echo: ${typeof init.input === 'string' ? init.input : '<stream>'}` },
    { t: 'turn-boundary', role: 'assistant', stop: 'end_turn' },
  ];
  return {
    renderNative: (): BackendConfig => ({
      systemPrompt: '',
      allowedTools: [],
      disallowedTools: [],
      perAgent: {},
    }),
    registerTools: () => {},
    denyBuiltins: () => {},
    interceptTool: (_c: CanUseTool) => {},
    interceptStop: (_s: StopPredicate) => {},
    runLoop: async () => {
      for (const frame of frames) init.onTurn?.(frame);
      init.onSettle(init.sessionId, { tokensIn: 3, tokensOut: 4, costUsd: 0.02 });
    },
    deliverReminder: () => {},
    render_context: () => {},
    inject_runtime: () => {},
    cache_control: () => {},
    usageTelemetry: (): RuntimeUsage => ({ tokensIn: 0, tokensOut: 0, costUsd: 0 }),
    capabilityProfile: () => barebonesProfile,
    refs: () => null,
    runEval: () => Promise.reject(new Error('no eval')),
  };
}

let n = 0;
function testPath(): string {
  const u = `coa-run-${process.pid}-${Date.now()}-${n++}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${u}` : join(tmpdir(), `${u}.sock`);
}

describe('coa run — over a live daemon with a fake backend', () => {
  let dir: string;
  let server: RpcServer;
  let path: string;
  let registry: LiveSessionRegistry;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'coa-run-'));
    const handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    const deps = composeSessionDeps(handle.core, {
      createAdapter: echoAdapter,
      bindWorktree: () => dir,
    });
    path = testPath();
    // One shared, daemon-wide registry (mirrors cli.ts) — constructed once, OUTSIDE
    // the per-connection factory, so two connections sharing a conversation id share
    // the one live session. No `idleMs`: an unset idle timer avoids real timers here.
    registry = new LiveSessionRegistry();
    server = await listen(path, (connection) =>
      buildSessionHandlers(deps, connection, undefined, registry),
    );
  });
  afterEach(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<{ code: number; out: string }> {
    const out: string[] = [];
    const code = await runSession(args, { path, out: (s) => out.push(s), err: (s) => out.push(s) });
    return { code, out: out.join('\n') };
  }

  it('streams the agent turn to the terminal and exits 0', async () => {
    const { code, out } = await run(['hello', 'there']);
    expect(code).toBe(0);
    expect(out).toContain('echo: hello there');
  });

  it('errors (exit 1) when no prompt is given, without opening a session', async () => {
    const { code, out } = await run(['--role', 'dev']);
    expect(code).toBe(1);
    expect(out).toMatch(/prompt/i);
  });

  it('shares one live session across two different connections with the same conversationId', async () => {
    const conversationId = 'shared-1';

    function collectPushes(): { pushes: Push[]; onNotification: (note: RpcNotification) => void } {
      const pushes: Push[] = [];
      return {
        pushes,
        onNotification: (note) => {
          if (note.method !== 'push') return;
          const push = pushSchema.safeParse(note.params);
          if (push.success) pushes.push(push.data);
        },
      };
    }

    const a = collectPushes();
    const clientA = await connectClient(path, a.onNotification);
    const first = await clientA.request('createSession', { input: 'first', conversationId });
    if ('error' in first) throw new Error(first.error.message);
    const firstResult = first.result as { sessionId: string; worktree: string };
    expect(firstResult.sessionId).toBe(conversationId);

    // Wait for the first turn to settle back to idle before the second connection joins.
    await vi.waitFor(() => {
      expect(a.pushes.some((p) => p.kind === 'status' && p.state === 'idle')).toBe(true);
    });

    const b = collectPushes();
    const clientB = await connectClient(path, b.onNotification);

    // A second, independent connection reattaches to the SAME live session by
    // conversation id — only possible when both connections share ONE daemon-wide
    // registry (a fresh per-connection registry would know nothing about it).
    const subscribed = await clientB.request('subscribeSession', { id: conversationId });
    if ('error' in subscribed) throw new Error(subscribed.error.message);
    expect(subscribed.result).toEqual({ subscribed: true });
    expect(b.pushes.some((p) => p.kind === 'status' && p.state === 'idle')).toBe(true);

    const second = await clientB.request('createSession', { input: 'second', conversationId });
    if ('error' in second) throw new Error(second.error.message);
    const secondResult = second.result as { sessionId: string; worktree: string };
    // Same session id + worktree returned both times — one live session, not two.
    expect(secondResult).toEqual(firstResult);

    await vi.waitFor(() => {
      expect(
        b.pushes.some(
          (p) => p.kind === 'turn' && p.frame.t === 'text' && p.frame.text === 'echo: second',
        ),
      ).toBe(true);
    });

    await clientA.close();
    await clientB.close();
  });
});
