import {
  RPC_ERROR,
  rpcClientMessageSchema,
  type RpcErrorResponse,
  type RpcId,
  type RpcNotification,
  type RpcRequest,
  type RpcResponse,
} from '@coa/shared';
import type { ZodType } from 'zod';

/**
 * The transport-agnostic JSON-RPC dispatch router. It validates an incoming
 * message against the shared wire envelope (Zod-validate-before-touch), routes it to
 * a registered handler, and shapes the reply per JSON-RPC 2.0: a **request** (has
 * `id`) always yields exactly one response (success or a coded error); a
 * **notification** (no `id`) runs best-effort and is NEVER answered, even on a
 * miss or a throw (JSON-RPC §4.1). This is the substrate every CON-CAT verb plugs into; it
 * holds no transport (sockets, framing, peer-cred are the transport layer) and
 * imports only the shared wire schemas, so it stays a pure, fully testable unit.
 */

/** A registered method: an optional params schema (failure ⇒ invalidParams) + the handler. */
export interface RpcMethod {
  params?: ZodType;
  handle: (params: unknown) => unknown | Promise<unknown>;
}

export type RpcHandlers = Record<string, RpcMethod>;

/**
 * Bind a typed handler to its params schema. The router validates `params` before
 * calling, so the cast to the schema's output type is sound at the call site.
 */
export function rpcMethod<P>(
  params: ZodType<P>,
  handle: (params: P) => unknown | Promise<unknown>,
): RpcMethod {
  return { params, handle: (raw) => handle(raw as P) };
}

/** Validate + route one message. Returns the response for a request, `undefined` for a notification. */
export async function dispatch(
  raw: unknown,
  handlers: RpcHandlers,
): Promise<RpcResponse | undefined> {
  const parsed = rpcClientMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(null, RPC_ERROR.invalidRequest, 'invalid JSON-RPC request');
  }

  const message = parsed.data;
  if ('id' in message) return handleRequest(message, handlers);

  await runNotification(message, handlers);
  return undefined;
}

async function handleRequest(req: RpcRequest, handlers: RpcHandlers): Promise<RpcResponse> {
  const method = handlers[req.method];
  if (method === undefined) {
    return errorResponse(req.id, RPC_ERROR.methodNotFound, `method not found: ${req.method}`);
  }

  const params = resolveParams(method, req.params);
  if (!params.ok) return errorResponse(req.id, RPC_ERROR.invalidParams, 'invalid params');

  try {
    const result = await method.handle(params.value);
    return { jsonrpc: '2.0', id: req.id, result };
  } catch (err) {
    return errorResponse(req.id, RPC_ERROR.internalError, errMessage(err));
  }
}

async function runNotification(note: RpcNotification, handlers: RpcHandlers): Promise<void> {
  const method = handlers[note.method];
  if (method === undefined) return;

  const params = resolveParams(method, note.params);
  if (!params.ok) return;

  try {
    await method.handle(params.value);
  } catch {
    // A notification is never answered — drop the error rather than reply (JSON-RPC §4.1).
  }
}

type Resolved = { ok: true; value: unknown } | { ok: false };

function resolveParams(method: RpcMethod, raw: unknown): Resolved {
  if (method.params === undefined) return { ok: true, value: raw };
  const checked = method.params.safeParse(raw);
  return checked.success ? { ok: true, value: checked.data } : { ok: false };
}

function errorResponse(id: RpcId | null, code: number, message: string): RpcErrorResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'internal error';
}
