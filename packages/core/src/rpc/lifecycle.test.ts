import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bindDaemon, probeDaemon } from './lifecycle.js';
import { listen, type RpcServer } from './transport.js';

let n = 0;
function testPath(): string {
  const u = `coa-life-${process.pid}-${Date.now()}-${n++}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${u}` : join(tmpdir(), `${u}.sock`);
}

describe('probeDaemon', () => {
  let server: RpcServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('is false when nothing is listening on the path', async () => {
    expect(await probeDaemon(testPath())).toBe(false);
  });

  it('is true when a daemon is listening', async () => {
    const path = testPath();
    server = await listen(path, { ping: { handle: () => 'pong' } });
    expect(await probeDaemon(path)).toBe(true);
  });
});

describe('bindDaemon — probe-before-bind lifecycle', () => {
  let server: RpcServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('binds a fresh path', async () => {
    const path = testPath();
    server = await bindDaemon(path, {});
    expect(server.path).toBe(path);
  });

  it('refuses to bind when a live daemon already serves the path', async () => {
    const path = testPath();
    server = await bindDaemon(path, {});
    await expect(bindDaemon(path, {})).rejects.toThrow(/already/i);
  });
});
