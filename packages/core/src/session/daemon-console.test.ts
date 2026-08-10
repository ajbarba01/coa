import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatch } from '../rpc/router.js';
import { buildDaemonConsoleHandlers, createDaemonCore, type DaemonCoreHandle } from './daemon.js';

describe('buildDaemonConsoleHandlers — inspector reads served over the live daemon core', () => {
  let dir: string;
  let handle: DaemonCoreHandle;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-daemon-console-'));
    handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the live cost-cap state', async () => {
    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'capState' },
      buildDaemonConsoleHandlers(handle),
    );
    expect(res).toMatchObject({ result: { capHit: false } });
  });

  it('serves the user flag feed (empty floor on a fresh daemon)', async () => {
    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'flagsForUser' },
      buildDaemonConsoleHandlers(handle),
    );
    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: { expanded: [], collapsed: [] } });
  });
});
