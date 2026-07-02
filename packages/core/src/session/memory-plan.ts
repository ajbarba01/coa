import type { BackendMessage } from '@coa/shared';

/**
 * M8 — the per-turn memory strategy (SPEC R-7). The canonical neutral transcript
 * (conversation-store `messages.json`) is the single source of truth for a
 * conversation's memory; this decides HOW to hand it to the turn's backend so the
 * agent's memory always matches what the user sees, across restarts and provider
 * switches, while keeping the provider's cache as warm as possible:
 *
 *  - **Same-provider Claude continuation** → the native `resume` fast path (by the
 *    stored backend session id). This is the strongest cache guarantee: the server
 *    replays its own transcript (incl. the exact compiled system prompt), so nothing
 *    can drift. Eligible only while the live `(provider, model)` still matches the
 *    stamp the token was captured under.
 *  - **Pure-API backend (DeepSeek)** → replay the neutral transcript as `history`
 *    messages; a chat API has no server session, and it doesn't care which model
 *    authored prior turns, so this is lossless regardless of origin.
 *  - **Cross-provider switch INTO Claude** (no resumable server session for this
 *    transcript) → deliver the neutral transcript as a first-turn context PREAMBLE.
 *    The Agent SDK can't ingest a foreign transcript into its own store (that format
 *    is CLI-internal), so a preamble is the supported, robust way to carry memory
 *    across the switch. After that turn Claude owns a resumable session again.
 *
 * The transcript is ALWAYS carried to the adapter (for bookkeeping — the adapter
 * appends this turn and reports the full transcript back), independent of whether
 * the model is fed `resume`, `history`, or a preamble.
 */

/** The minimal slice of stored session metadata the plan reads (structural — no store coupling). */
export interface MemoryMetaView {
  backendSessionId?: string | undefined;
  resumeStamp?:
    | { provider: string; model?: string | undefined; promptVersion?: string | undefined }
    | undefined;
}

export interface MemoryPlanInput {
  /** The provider this turn routes to (from the session's pinned selection). */
  provider: string;
  /** The model id this turn runs on (undefined ⇒ account default). */
  model?: string | undefined;
  /** The frozen prompt version this turn runs on; a recompile changes it, which
   *  invalidates the resume token (the server session holds the old prompt). */
  promptVersion?: string | undefined;
  /** The stored session metadata (undefined ⇒ a brand-new conversation). */
  meta?: MemoryMetaView | undefined;
  /** The canonical neutral transcript loaded from the store (system omitted). */
  transcript: readonly BackendMessage[];
}

export interface MemoryPlan {
  /** Claude native resume by backend session id — set ONLY when eligible. */
  resume?: string;
  /** The transcript to hand the adapter (always the full canonical transcript). */
  history: readonly BackendMessage[];
  /** Claude cross-provider case: deliver `history` to the model as a first-turn preamble. */
  deliverHistoryAsPreamble: boolean;
}

/** True when the stored resume token was captured under the same provider+model
 *  (and, when both are known, the same frozen prompt) now in use. */
export function resumeEligible(input: {
  provider: string;
  model?: string | undefined;
  promptVersion?: string | undefined;
  meta?: MemoryMetaView | undefined;
}): boolean {
  const { meta } = input;
  if (meta?.backendSessionId === undefined || meta.resumeStamp === undefined) return false;
  const stamp = meta.resumeStamp;
  if (stamp.provider !== input.provider || stamp.model !== input.model) return false;
  // Gate on prompt version only when both sides know it — a recompile bumps it and
  // must invalidate the token (the server session still holds the old prompt); a
  // legacy stamp with no version falls back to provider+model matching.
  if (stamp.promptVersion !== undefined && input.promptVersion !== undefined) {
    return stamp.promptVersion === input.promptVersion;
  }
  return true;
}

export function planMemory(input: MemoryPlanInput): MemoryPlan {
  const isClaude = input.provider === 'claude';
  const eligible = resumeEligible(input);

  if (isClaude && eligible) {
    // Fast path: the server session already holds the memory (and the frozen prompt).
    return { resume: input.meta!.backendSessionId!, history: input.transcript, deliverHistoryAsPreamble: false };
  }
  if (isClaude) {
    // No resumable server session for this transcript (fresh, or switched in from
    // another provider): carry memory across as a first-turn preamble when there is any.
    return { history: input.transcript, deliverHistoryAsPreamble: input.transcript.length > 0 };
  }
  // Pure-API backend: always replay the neutral transcript as history messages.
  return { history: input.transcript, deliverHistoryAsPreamble: false };
}
