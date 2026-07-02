import { RPC_ERROR } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import { rpcMethod, type RpcHandlers } from './router.js';
import { serveOverStream, type DuplexLike } from './stream.js';
import { z } from 'zod';

class FakeStream implements DuplexLike {
  private listeners: ((chunk: string) => void)[] = [];
  readonly writes: string[] = [];

  on(event: 'data', listener: (chunk: string) => void): void {
    if (event === 'data') this.listeners.push(listener);
  }
  write(data: string): void {
    this.writes.push(data);
  }
  emit(chunk: string): void {
    for (const l of this.listeners) l(chunk);
  }
}

const handlers: RpcHandlers = {
  ping: { handle: () => 'pong' },
  noted: rpcMethod(z.object({ n: z.number() }), () => undefined),
};

const line = (method: string, id?: number, params?: unknown) =>
  `${JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), method, ...(params !== undefined ? { params } : {}) })}\n`;

describe('serveOverStream — JSON-RPC over a byte stream', () => {
  it('writes a response line for a request', async () => {
    const stream = new FakeStream();
    const server = serveOverStream(stream, handlers);

    stream.emit(line('ping', 1));
    await server.idle();

    expect(stream.writes).toEqual([
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'pong' })}\n`,
    ]);
  });

  it('writes nothing for a notification', async () => {
    const stream = new FakeStream();
    const server = serveOverStream(stream, handlers);

    stream.emit(line('noted', undefined, { n: 1 }));
    await server.idle();

    expect(stream.writes).toEqual([]);
  });

  it('answers malformed JSON with a null-id parse error', async () => {
    const stream = new FakeStream();
    const server = serveOverStream(stream, handlers);

    stream.emit('{ not json\n');
    await server.idle();

    expect(JSON.parse(stream.writes[0]!)).toMatchObject({
      id: null,
      error: { code: RPC_ERROR.parseError },
    });
  });

  it('handles two requests in one chunk, in arrival order', async () => {
    const stream = new FakeStream();
    const server = serveOverStream(stream, handlers);

    stream.emit(line('ping', 1) + line('ping', 2));
    await server.idle();

    expect(stream.writes.map((w) => JSON.parse(w).id)).toEqual([1, 2]);
  });

  it('responds only once a request split across chunks is complete', async () => {
    const stream = new FakeStream();
    const server = serveOverStream(stream, handlers);

    stream.emit('{"jsonrpc":"2.0","id":7,"meth');
    await server.idle();
    expect(stream.writes).toEqual([]);

    stream.emit('od":"ping"}\n');
    await server.idle();
    expect(JSON.parse(stream.writes[0]!)).toMatchObject({ id: 7, result: 'pong' });
  });

  it('pushes a server→client notification as an id-less framed line', () => {
    const stream = new FakeStream();
    const server = serveOverStream(stream, handlers);

    server.push({ jsonrpc: '2.0', method: 'turn', params: { seq: 1 } });

    expect(stream.writes).toEqual([
      `${JSON.stringify({ jsonrpc: '2.0', method: 'turn', params: { seq: 1 } })}\n`,
    ]);
  });

  it('builds handlers from a per-connection factory, handing it the push channel', async () => {
    const stream = new FakeStream();
    const server = serveOverStream(stream, (conn) => ({
      emit: {
        handle: () => {
          conn.push({ jsonrpc: '2.0', method: 'pushed' });
          return 'ok';
        },
      },
    }));

    stream.emit(line('emit', 1));
    await server.idle();

    expect(stream.writes.map((w) => JSON.parse(w))).toEqual([
      { jsonrpc: '2.0', method: 'pushed' },
      { jsonrpc: '2.0', id: 1, result: 'ok' },
    ]);
  });
});
