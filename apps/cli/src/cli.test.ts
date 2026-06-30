import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDaemonConsoleHandlers, createDaemonCore, listen, type RpcServer } from '@coa/core';
import { runCli, startDaemon } from './cli.js';

let n = 0;
function testPath(): string {
  const u = `coa-cli-${process.pid}-${Date.now()}-${n++}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${u}` : join(tmpdir(), `${u}.sock`);
}

describe('runCli — client read commands over a live daemon', () => {
  let dir: string;
  let server: RpcServer;
  let path: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'coa-cli-'));
    const handle = createDaemonCore({ walPath: join(dir, 'log.ndjson'), root: dir });
    handle.governance.decisionLog.append('pay.ts', 'use decimal');
    path = testPath();
    server = await listen(path, buildDaemonConsoleHandlers(handle));
  });
  afterEach(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(args, { path, out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  }

  it('cap prints the live cost state', async () => {
    const { code, out } = await run(['cap']);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ capHit: false });
  });

  it('why prints the decisions governing a target', async () => {
    const { out } = await run(['why', 'pay.ts']);
    expect(JSON.parse(out)).toMatchObject([{ target: 'pay.ts', entry: 'use decimal' }]);
  });

  it('flags prints the user feed', async () => {
    const { out } = await run(['flags']);
    expect(JSON.parse(out)).toEqual({ expanded: [], collapsed: [] });
  });

  it('decision prints null for an unknown id (exit 0)', async () => {
    const { code, out } = await run(['decision', '999']);
    expect(code).toBe(0);
    expect(out).toBe('null');
  });

  it('an unknown command exits non-zero with an error', async () => {
    const { code, err } = await run(['frobnicate']);
    expect(code).toBe(1);
    expect(err).toMatch(/unknown/i);
  });
});

describe('startDaemon — the serve path', () => {
  it('serves the inspector reads over the bound endpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-serve-'));
    const path = testPath();
    const server = await startDaemon({
      walPath: join(dir, 'log.ndjson'),
      path,
      out: () => {},
      err: () => {},
    });

    const out: string[] = [];
    const code = await runCli(['cap'], { path, out: (s) => out.push(s), err: () => {} });

    expect(code).toBe(0);
    expect(JSON.parse(out.join(''))).toMatchObject({ capHit: false });

    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
