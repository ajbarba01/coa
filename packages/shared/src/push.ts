import { z } from 'zod';
import { flagRecordSchema } from './flag.js';

/**
 * The server-to-client push wire records (the CHAT and CON families). `tokens` is the
 * degrade-to-floor raw stream; the structured `turn` kind is the bounded
 * high-fidelity layer (D85). M0 owns the wire types; M8 owns the emission policy.
 */

/** The discriminated turn-event union (CHAT-5). */
export const turnFrameSchema = z.discriminatedUnion('t', [
  // `durationMs` (optional): wall-clock the model spent on this reasoning block, stamped by
  // M8 from the delta→settle timing so a reload renders "Thought for Ns" identically to the
  // live stream (a token estimate is derived from `text`, so it needs no field). Omitted by a
  // non-streamed backend or the floor.
  z.object({ t: z.literal('thinking'), text: z.string(), durationMs: z.number().optional() }),
  // Delivery-only streaming deltas (Piece B / G7): pushed over R-12 for live render,
  // NEVER store.append-ed — the durable log holds only settled frames (docs/adr/0010,
  // docs/adr/0013). The console appends a delta to the in-progress block; the settled
  // `text`/`thinking` frame that follows is the canonical record.
  z.object({ t: z.literal('text-delta'), text: z.string() }),
  z.object({ t: z.literal('thinking-delta'), text: z.string() }),
  // `role` marks a persisted user prompt in the R-7 store (assistant text omits it,
  // staying the live-stream default); the console renders a `user` text as a `you` turn.
  z.object({
    t: z.literal('text'),
    text: z.string(),
    role: z.enum(['user', 'assistant']).optional(),
  }),
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
  // A DELIBERATE stop, not a fault — one of the system's only two blocks (SC-1): M3's
  // close-gate and M7's cost cap. Distinct from `error` so a governed stop never renders
  // as a crash. `denyKind` matches the console's renderer enum exactly. A vendor bound
  // like `maxTurns` is NOT a coa block and rides `turn-boundary.terminal` instead.
  // See docs/adr/0028.
  z.object({
    t: z.literal('deny'),
    denyKind: z.enum(['close-gate', 'cost-cap']),
    reason: z.string(),
  }),
  z.object({ t: z.literal('permission'), requestId: z.string() }),
  // A user interrupt (bare stop) recorded into the append-only log: it settles the turn, makes
  // the model aware next turn (the fold surfaces it as a "[Request interrupted by user]" notice),
  // and renders as a quiet system line — persisted so live and reload read identically (SC-1: a
  // user stop, never a governance block / error).
  z.object({ t: z.literal('interrupted') }),
  z.object({
    t: z.literal('subagent'),
    childWorktree: z.string(),
    event: z.enum(['spawn-proposal', 'spawn', 'running', 'idle', 'done', 'rollup']),
  }),
  z.object({
    t: z.literal('turn-boundary'),
    role: z.enum(['user', 'assistant']),
    stop: z.string().optional(),
    // The backend's own terminal reason (the SDK's `TerminalReason`), reported verbatim.
    // Without it a close-gate block, a turn-cap cutoff and a clean finish are
    // indistinguishable. Reported, never reinterpreted as governance.
    terminal: z.string().optional(),
  }),
]);
export type TurnFrame = z.infer<typeof turnFrameSchema>;

/** A clickable choice on a system banner; its `id` is echoed back to the daemon
 *  when the user picks it (e.g. a drift banner's `recompile` / `keep`). */
export const bannerActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Styling hint — the recommended/default action. */
  primary: z.boolean().optional(),
});
export type BannerAction = z.infer<typeof bannerActionSchema>;

/**
 * A dismissable, SYSTEM-only chat banner (never part of the transcript sent to the
 * agent). `id` is a stable identity so re-emitting the same banner replaces rather
 * than stacks it and so a dismissal can target it; `kind` drives styling/behavior
 * (prompt-drift vs. cache-status); `actions` are the resolutions the user can pick
 * (absent ⇒ a passive notice). Shared by the drift banner and the cache banner.
 */
export const bannerSchema = z.object({
  id: z.string(),
  kind: z.enum(['drift', 'cache']),
  reason: z.string(),
  actions: z.array(bannerActionSchema).optional(),
});
export type Banner = z.infer<typeof bannerSchema>;

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
  z.object({ kind: z.literal('banner'), sessionId: z.string(), banner: bannerSchema }),
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
    state: z.enum([
      'running',
      'idle',
      'blocked-approval',
      'blocked-tool',
      'done',
      'error',
      // A user-initiated stop (M8's interruptSession), never a governance block — SC-1.
      'interrupted',
    ]),
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
