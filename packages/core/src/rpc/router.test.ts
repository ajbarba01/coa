import { RPC_ERROR } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { dispatch, rpcMethod, type RpcHandlers } from './router.js';

const req = (method: string, params?: unknown, id: string | number = 1) => ({
  jsonrpc: '2.0' as const,
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

describe('dispatch — the transport-agnostic JSON-RPC router', () => {
  it('routes a request to its handler and returns a success response', async () => {
    const handlers: RpcHandlers = { ping: { handle: () => 'pong' } };

    const res = await dispatch(req('ping'), handlers);

    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: 'pong' });
  });

  it('awaits an async handler', async () => {
    const handlers: RpcHandlers = { slow: { handle: async () => 42 } };
    expect(await dispatch(req('slow'), handlers)).toEqual({ jsonrpc: '2.0', id: 1, result: 42 });
  });

  it('returns methodNotFound for an unregistered method', async () => {
    const res = await dispatch(req('ghost'), {});
    expect(res).toMatchObject({ id: 1, error: { code: RPC_ERROR.methodNotFound } });
  });

  it('returns a null-id invalidRequest error for a malformed envelope', async () => {
    const res = await dispatch({ jsonrpc: '1.0', id: 1, method: 'm' }, {});
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: RPC_ERROR.invalidRequest, message: expect.any(String) },
    });
  });

  it('validates params against a method schema and rejects bad params with invalidParams', async () => {
    const handlers: RpcHandlers = {
      open: rpcMethod(z.object({ role: z.string() }), ({ role }) => `opened ${role}`),
    };

    const ok = await dispatch(req('open', { role: 'dev' }), handlers);
    const bad = await dispatch(req('open', { role: 7 }), handlers);

    expect(ok).toEqual({ jsonrpc: '2.0', id: 1, result: 'opened dev' });
    expect(bad).toMatchObject({ id: 1, error: { code: RPC_ERROR.invalidParams } });
  });

  it('passes raw params through when the method declares no schema', async () => {
    const handlers: RpcHandlers = { echo: { handle: (p) => p } };
    const res = await dispatch(req('echo', { any: 'thing' }), handlers);
    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: { any: 'thing' } });
  });

  it('maps a throwing handler to an internalError carrying its message', async () => {
    const handlers: RpcHandlers = {
      boom: {
        handle: () => {
          throw new Error('kaboom');
        },
      },
    };
    const res = await dispatch(req('boom'), handlers);
    expect(res).toMatchObject({
      id: 1,
      error: { code: RPC_ERROR.internalError, message: 'kaboom' },
    });
  });

  it('runs a notification handler but returns no response', async () => {
    let ran = false;
    const handlers: RpcHandlers = {
      notify: {
        handle: () => {
          ran = true;
        },
      },
    };

    const res = await dispatch({ jsonrpc: '2.0', method: 'notify' }, handlers);

    expect(res).toBeUndefined();
    expect(ran).toBe(true);
  });

  it('swallows an unknown-method notification with no response', async () => {
    expect(await dispatch({ jsonrpc: '2.0', method: 'ghost' }, {})).toBeUndefined();
  });

  it('swallows a throwing notification handler with no response', async () => {
    const handlers: RpcHandlers = {
      notify: {
        handle: () => {
          throw new Error('ignored');
        },
      },
    };
    expect(await dispatch({ jsonrpc: '2.0', method: 'notify' }, handlers)).toBeUndefined();
  });

  it('skips a notification whose params fail validation, with no response', async () => {
    let ran = false;
    const handlers: RpcHandlers = {
      notify: rpcMethod(z.object({ n: z.number() }), () => {
        ran = true;
      }),
    };
    expect(
      await dispatch({ jsonrpc: '2.0', method: 'notify', params: { n: 'x' } }, handlers),
    ).toBeUndefined();
    expect(ran).toBe(false);
  });
});
