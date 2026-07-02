import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TurnFrame } from '@coa/shared';
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
  createDaemonCore,
  listen,
  type RpcServer,
  type SessionAdapterInit,
} from '@coa/core';
import { runSession } from './cli.js';

/**
 * End-to-end proof of the `coa run` path over a real OS pipe with a FAKE backend:
 * client → daemon → session lifecycle → R-12 push → terminal render. The live-SDK
 * smoke test (a real `query()`) is the v0-spike gate and runs behind auth, not here.
 */

/** A backend that echoes the input as an assistant text frame, then settles. */
function echoAdapter(init: SessionAdapterInit): RuntimeAdapter {
  const frames: TurnFrame[] = [
    { t: 'text', text: `echo: ${typeof init.input === 'string' ? init.input : '<stream>'}` },
    { t: 'turn-boundary', role: 'assistant', stop: 'end_turn' },
  ];
  return {
    renderNative: (): BackendConfig => ({ systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {}, files: [] }),
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

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'coa-run-'));
    const handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    const deps = composeSessionDeps(handle.core, {
      createAdapter: echoAdapter,
      bindWorktree: () => dir,
    });
    path = testPath();
    server = await listen(path, (connection) => buildSessionHandlers(deps, connection));
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
});
