import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDaemonCore, dispatch, type DaemonCoreHandle } from '@coa/core';
import { buildDaemonConsoleHandlers } from './console-handlers.js';

describe('buildDaemonConsoleHandlers — inspector reads served over the live daemon core', () => {
  let dir: string;
  let handle: DaemonCoreHandle;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-daemon-console-'));
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
  });
  afterEach(() => {
    handle.kernel.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the live cost-cap state', async () => {
    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'capState' },
      buildDaemonConsoleHandlers(handle, { home: dir }),
    );
    expect(res).toMatchObject({ result: { capHit: false } });
  });

  it('serves the user flag feed (empty floor on a fresh daemon)', async () => {
    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'flagsForUser' },
      buildDaemonConsoleHandlers(handle, { home: dir }),
    );
    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: { expanded: [], collapsed: [] } });
  });

  it('degrades the login verbs to idle when no login driver is injected', async () => {
    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'loginState' },
      buildDaemonConsoleHandlers(handle, { home: dir }),
    );
    expect(res).toMatchObject({ result: { phase: 'idle' } });
  });

  it('constructs the login manager over an injected driver (startLogin launches)', async () => {
    const loginDriver = {
      home: dir,
      dirFor: (email: string) => join(dir, email),
      probe: async () => undefined,
      start: () => ({
        onUrl: () => {},
        onExit: () => {},
        writeCode: () => {},
        kill: () => {},
        ptyCaptured: false,
      }),
    };
    const handlers = buildDaemonConsoleHandlers(handle, { loginDriver, home: dir });
    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'startLogin', params: { email: 'a@b.c' } },
      handlers,
    );
    expect(res).toMatchObject({ result: { phase: 'launching', email: 'a@b.c' } });
    await dispatch({ jsonrpc: '2.0', id: 2, method: 'cancelLogin' }, handlers);
  });
});
