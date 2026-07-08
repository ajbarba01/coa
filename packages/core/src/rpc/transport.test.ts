import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RpcHandlers } from './router.js';
import { listen, type RpcServer } from './transport.js';

let n = 0;
function testPath(): string {
  const unique = `coa-test-${process.pid}-${Date.now()}-${n++}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${unique}` : join(tmpdir(), `${unique}.sock`);
}

/** A raw one-shot client: connect, send one request line, resolve the first response line. */
function roundTrip(path: string, request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = connect(path);
    sock.setEncoding('utf8');
    let buffer = '';
    sock.on('connect', () => sock.write(`${JSON.stringify(request)}\n`));
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl !== -1) {
        sock.end();
        resolve(JSON.parse(buffer.slice(0, nl)));
      }
    });
    sock.on('error', reject);
  });
}

const handlers: RpcHandlers = { ping: { handle: () => 'pong' } };

describe('listen — JSON-RPC over a real OS pipe/socket', () => {
  let server: RpcServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('round-trips a request over the bound endpoint', async () => {
    const path = testPath();
    server = await listen(path, handlers);

    const res = await roundTrip(path, { jsonrpc: '2.0', id: 1, method: 'ping' });

    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: 'pong' });
  });

  it('serves multiple sequential connections', async () => {
    const path = testPath();
    server = await listen(path, handlers);

    const a = await roundTrip(path, { jsonrpc: '2.0', id: 1, method: 'ping' });
    const b = await roundTrip(path, { jsonrpc: '2.0', id: 2, method: 'ping' });

    expect([a, b]).toEqual([
      { jsonrpc: '2.0', id: 1, result: 'pong' },
      { jsonrpc: '2.0', id: 2, result: 'pong' },
    ]);
  });

  it('rejects a second bind on the same path (in-use surfaces, never silently squats)', async () => {
    const path = testPath();
    server = await listen(path, handlers);

    await expect(listen(path, handlers)).rejects.toThrow();
  });

  it('keeps serving after a client abruptly destroys its connection (FIX #2a socket crash-safety)', async () => {
    const path = testPath();
    server = await listen(path, handlers);

    const sock = connect(path);
    sock.on('error', () => {}); // this test destroys the CLIENT end with an error on purpose
    await new Promise<void>((resolve) => sock.on('connect', () => resolve()));
    // An abrupt, non-graceful teardown — the kind of drop that can surface as a
    // server-side socket 'error' (e.g. on a subsequent write). Without the
    // `socket.on('error', …)` no-op registered in `transport.ts`, an unhandled
    // 'error' event on the server-side socket would crash the whole process.
    sock.destroy(new Error('client dropped'));
    await new Promise((r) => setTimeout(r, 50));

    // The daemon is still alive and accepting connections — proof the drop
    // didn't take the process down.
    const res = await roundTrip(path, { jsonrpc: '2.0', id: 99, method: 'ping' });
    expect(res).toEqual({ jsonrpc: '2.0', id: 99, result: 'pong' });
  });
});
