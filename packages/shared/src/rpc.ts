import { z } from 'zod';

/**
 * The JSON-RPC 2.0 envelope schemas for the daemon protocol (D124). M0 owns the
 * generic request/response/notification envelopes; **M8 owns the transport +
 * lifecycle** (OS socket, peer-cred, framing) and defines each method's `params`/
 * `result` shape inline in its CON-CAT catalogue — those are NOT duplicated here.
 * Server→client push rides a {@link rpcNotificationSchema} whose `params` is a
 * {@link Push} (defined in `push.ts`).
 *
 * Per the spec, `params` is structured-only (array or object, never a bare scalar)
 * and `id` is a string or number on a request. Batches are not part of v1.
 */

/** A JSON-RPC id: a string or number on a request/response (null only on an error with no parseable id). */
export const rpcIdSchema = z.union([z.string(), z.number()]);
export type RpcId = z.infer<typeof rpcIdSchema>;

/** Structured params only (JSON-RPC 2.0 §4.2): by-position (array) or by-name (object). */
export const rpcParamsSchema = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);
export type RpcParams = z.infer<typeof rpcParamsSchema>;

/** The five standard JSON-RPC 2.0 error codes; method-specific codes live in M8's −32000..−32099 range. */
export const RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

/** A client→server method call expecting a response. */
export const rpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: rpcIdSchema,
  method: z.string(),
  params: rpcParamsSchema.optional(),
});
export type RpcRequest = z.infer<typeof rpcRequestSchema>;

/** A fire-and-forget message with no `id` and no response (the server→client push carrier). */
export const rpcNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: rpcParamsSchema.optional(),
});
export type RpcNotification = z.infer<typeof rpcNotificationSchema>;

/** An incoming message on the server side: a request (has `id`) or a notification (no `id`). */
export const rpcClientMessageSchema = z.union([rpcRequestSchema, rpcNotificationSchema]);
export type RpcClientMessage = z.infer<typeof rpcClientMessageSchema>;

export const rpcErrorObjectSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type RpcErrorObject = z.infer<typeof rpcErrorObjectSchema>;

export const rpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: rpcIdSchema,
  result: z.unknown(),
});
export type RpcSuccessResponse = z.infer<typeof rpcSuccessResponseSchema>;

export const rpcErrorResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  /** Null when the request could not be parsed far enough to recover an id (JSON-RPC 2.0 §5). */
  id: rpcIdSchema.nullable(),
  error: rpcErrorObjectSchema,
});
export type RpcErrorResponse = z.infer<typeof rpcErrorResponseSchema>;

/** A response is either a success or an error — error first so an `error`-bearing message never matches success. */
export const rpcResponseSchema = z.union([rpcErrorResponseSchema, rpcSuccessResponseSchema]);
export type RpcResponse = z.infer<typeof rpcResponseSchema>;
