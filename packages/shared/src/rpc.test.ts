import { describe, expect, it } from 'vitest';
import {
  RPC_ERROR,
  rpcClientMessageSchema,
  rpcErrorResponseSchema,
  rpcNotificationSchema,
  rpcRequestSchema,
  rpcResponseSchema,
  rpcSuccessResponseSchema,
} from './rpc.js';

describe('JSON-RPC 2.0 envelope schemas', () => {
  it('accepts a well-formed request', () => {
    const req = { jsonrpc: '2.0', id: 1, method: 'openSession', params: { role: 'dev' } };
    expect(rpcRequestSchema.parse(req)).toEqual(req);
  });

  it('accepts a request with a string id and no params', () => {
    expect(() =>
      rpcRequestSchema.parse({ jsonrpc: '2.0', id: 'abc', method: 'ping' }),
    ).not.toThrow();
  });

  it('rejects a request with the wrong protocol version', () => {
    expect(() => rpcRequestSchema.parse({ jsonrpc: '1.0', id: 1, method: 'm' })).toThrow();
  });

  it('rejects a request missing the method', () => {
    expect(() => rpcRequestSchema.parse({ jsonrpc: '2.0', id: 1 })).toThrow();
  });

  it('rejects a request whose params are neither array nor object (JSON-RPC structured-only)', () => {
    expect(() =>
      rpcRequestSchema.parse({ jsonrpc: '2.0', id: 1, method: 'm', params: 5 }),
    ).toThrow();
  });

  it('accepts positional (array) params', () => {
    expect(() =>
      rpcRequestSchema.parse({ jsonrpc: '2.0', id: 1, method: 'm', params: [1, 'two'] }),
    ).not.toThrow();
  });

  it('accepts a notification (no id)', () => {
    const note = { jsonrpc: '2.0', method: 'push', params: { kind: 'status' } };
    expect(rpcNotificationSchema.parse(note)).toEqual(note);
  });

  it('accepts a well-formed success response', () => {
    const res = { jsonrpc: '2.0', id: 1, result: { sessionId: 's1' } };
    expect(rpcSuccessResponseSchema.parse(res)).toEqual(res);
  });

  it('accepts a well-formed error response with a null id (unparseable request)', () => {
    const res = {
      jsonrpc: '2.0',
      id: null,
      error: { code: RPC_ERROR.parseError, message: 'parse error' },
    };
    expect(rpcErrorResponseSchema.parse(res)).toEqual(res);
  });

  it('rejects an error response whose error object lacks a numeric code', () => {
    expect(() =>
      rpcErrorResponseSchema.parse({ jsonrpc: '2.0', id: 1, error: { message: 'oops' } }),
    ).toThrow();
  });

  it('exposes the five standard JSON-RPC error codes', () => {
    expect(RPC_ERROR).toEqual({
      parseError: -32700,
      invalidRequest: -32600,
      methodNotFound: -32601,
      invalidParams: -32602,
      internalError: -32603,
    });
  });

  it('discriminates an incoming client message into request vs notification by the id', () => {
    const req = rpcClientMessageSchema.parse({ jsonrpc: '2.0', id: 9, method: 'm' });
    const note = rpcClientMessageSchema.parse({ jsonrpc: '2.0', method: 'm' });
    expect('id' in req).toBe(true);
    expect('id' in note).toBe(false);
  });

  it('parses both response shapes through the response union', () => {
    expect(() => rpcResponseSchema.parse({ jsonrpc: '2.0', id: 1, result: null })).not.toThrow();
    expect(() =>
      rpcResponseSchema.parse({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'x' } }),
    ).not.toThrow();
  });
});
