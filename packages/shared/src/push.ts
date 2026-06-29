import { z } from 'zod';
import { flagRecordSchema } from './flag.js';

/**
 * The server-to-client push wire records (the CHAT and CON families). `tokens` is the
 * degrade-to-floor raw stream; the structured `turn` kind is the bounded
 * high-fidelity layer (D85). M0 owns the wire types; M8 owns the emission policy.
 */

/** The discriminated turn-event union (CHAT-5). */
export const turnFrameSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('thinking'), text: z.string() }),
  z.object({ t: z.literal('text'), text: z.string() }),
  z.object({
    t: z.literal('tool_use'),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
    /** → M8.getToolDetail for the byte-faithful diff/args (CHAT-4); raw stays in the daemon (D57). */
    handle: z.string(),
  }),
  z.object({
    t: z.literal('tool_result'),
    handle: z.string(),
    ok: z.boolean(),
    pointer: z.string(),
  }),
  z.object({ t: z.literal('reconcile'), changeSeq: z.number(), pointer: z.string() }),
  z.object({
    t: z.literal('error'),
    message: z.string(),
    origin: z.enum(['tool', 'loop', 'daemon']),
  }),
  z.object({ t: z.literal('permission'), requestId: z.string() }),
  z.object({
    t: z.literal('subagent'),
    childWorktree: z.string(),
    event: z.enum(['spawn-proposal', 'spawn', 'running', 'idle', 'done', 'rollup']),
  }),
  z.object({
    t: z.literal('turn-boundary'),
    role: z.enum(['user', 'assistant']),
    stop: z.string().optional(),
  }),
]);
export type TurnFrame = z.infer<typeof turnFrameSchema>;

export const pushSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flag'), flag: flagRecordSchema }),
  z.object({ kind: z.literal('drift'), flag: flagRecordSchema }),
  z.object({
    kind: z.literal('cost'),
    sessionId: z.string(),
    spent: z.number(),
    remaining: z.number(),
    capHit: z.boolean(),
  }),
  z.object({
    kind: z.literal('approval'),
    requestId: z.string(),
    sessionId: z.string(),
    summary: z.string(),
    tool: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    diffHandle: z.string().optional(),
  }),
  z.object({ kind: z.literal('tokens'), sessionId: z.string(), delta: z.string() }),
  z.object({
    kind: z.literal('turn'),
    sessionId: z.string(),
    worktree: z.string(),
    seq: z.number(),
    parentTurn: z.object({ sessionId: z.string(), seq: z.number() }).optional(),
    frame: turnFrameSchema,
  }),
  z.object({
    kind: z.literal('status'),
    sessionId: z.string(),
    worktree: z.string(),
    state: z.enum(['running', 'idle', 'blocked-approval', 'blocked-tool', 'done', 'error']),
  }),
  z.object({
    kind: z.literal('compaction'),
    sessionId: z.string(),
    worktree: z.string(),
    atSeq: z.number(),
    preTokens: z.number(),
    summaryHandle: z.string(),
    kept: z.array(z.string()),
    dropped: z.array(z.string()),
  }),
  z.object({ kind: z.literal('graph'), scope: z.string().optional(), deltaHandle: z.string() }),
  z.object({ kind: z.literal('health'), scope: z.string().optional(), deltaHandle: z.string() }),
]);
export type Push = z.infer<typeof pushSchema>;
