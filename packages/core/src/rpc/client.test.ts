import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connectClient, type RpcClient } from './client.js';
import { rpcMethod, type RpcHandlers } from './router.js';
import { listen, type RpcServer } from './transport.js';

let n = 0;
function testPath(): string {
  const unique = `coa-client-${process.pid}-${Date.now()}-${n++}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${unique}` : join(tmpdir(), `${unique}.sock`);
}

const handlers: RpcHandlers = {
  ping: { handle: () => 'pong' },
  add: rpcMethod(z.object({ a: z.number(), b: z.number() }), ({ a, b }) => a + b),
};

describe('connectClient — the daemon RPC client', () => {
  let server: RpcServer | undefined;
  let client: RpcClient | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
    server = undefined;
    client = undefined;
  });

  it('round-trips a request and auto-increments the id', async () => {
    const path = testPath();
    server = await listen(path, handlers);
    client = await connectClient(path);

    const first = await client.request('ping');
    const second = await client.request('add', { a: 2, b: 3 });

    expect(first).toEqual({ jsonrpc: '2.0', id: 1, result: 'pong' });
    expect(second).toEqual({ jsonrpc: '2.0', id: 2, result: 5 });
  });

  it('matches concurrent responses to their requests by id', async () => {
    const path = testPath();
    server = await listen(path, handlers);
    client = await connectClient(path);

    const [a, b] = await Promise.all([
      client.request('add', { a: 1, b: 1 }),
      client.request('add', { a: 10, b: 10 }),
    ]);

    expect(a.result).toBe(2);
    expect(b.result).toBe(20);
  });

  it('surfaces a server error response', async () => {
    const path = testPath();
    server = await listen(path, handlers);
    client = await connectClient(path);

    const res = await client.request('ghost');

    expect(res).toMatchObject({ error: { code: -32601 } });
  });

  it('sends a notification with no response and no error', async () => {
    const path = testPath();
    server = await listen(path, handlers);
    client = await connectClient(path);

    expect(() => client!.notify('ping')).not.toThrow();
  });

  it('delivers a server-pushed notification to onNotification', async () => {
    const path = testPath();
    const raw = createServer((socket) => {
      socket.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'push', params: { kind: 'cost' } })}\n`,
      );
    });
    await new Promise<void>((res) => raw.listen(path, res));

    const received: unknown[] = [];
    client = await connectClient(path, (note) => received.push(note));
    await new Promise((res) => setTimeout(res, 50));

    expect(received).toEqual([{ jsonrpc: '2.0', method: 'push', params: { kind: 'cost' } }]);
    await client.close();
    client = undefined;
    await new Promise<void>((res) => raw.close(() => res()));
  });
});
