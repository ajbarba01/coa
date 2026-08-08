import type { BackendMessage } from '@coa/shared';

/**
 * The per-turn memory strategy . The canonical transcript is the
 * read-time fold over the conversation's append-only `events.ndjson`
 * — the single source of truth for a conversation's memory; this decides HOW to hand
 * it to the turn's backend so the agent's memory always matches what the user sees,
 * across restarts and provider switches, while keeping the provider's cache as warm
 * as possible:
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
 * The transcript is ALWAYS carried to the adapter (for bookkeeping — the server
 * session or a preamble carries it forward), independent of whether the model is
 * fed `resume`, `history`, or a preamble.
 *
 * When the store could not read part of the stored record, the transcript that reaches
 * the model is a FRAGMENT, and nothing about it looks different from a whole one —
 * missing events leave no gap to notice. So the count travels with the transcript and
 * the plan marks the history with one plain-language note (see
 * {@link unreadableMemoryNotice}). It is a statement about this transcript, not a
 * governance action: the turn runs either way.
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
  /** How many stored events that transcript's own read could not parse. 0 (or absent) ⇒
   *  the record read cleanly and the history is handed over exactly as it was folded. */
  skippedEvents?: number | undefined;
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

/**
 * The note appended to a transcript whose read lost events. Phrased as a fact about the
 * transcript (which is always true, wherever it is delivered) rather than about the
 * model's memory, and in plain language the model can act on: it can ask instead of
 * assuming the record above is everything that happened. Rides the `user` lane like the
 * other coa-authored notices — a chat API has no other slot for mid-conversation input.
 */
export function unreadableMemoryNotice(skipped: number): string {
  const events = skipped === 1 ? '1 earlier event' : `${skipped} earlier events`;
  return `[coa: ${events} in this conversation could not be read from the stored record and ${skipped === 1 ? 'is' : 'are'} missing from the transcript above — it is a fragment, not the whole conversation. Ask rather than assume when something seems to be missing.]`;
}

/** Append the fragment notice when events were lost. The transcript itself is untouched
 *  — nothing is dropped, rewritten, or reordered — so a clean read (the normal case)
 *  hands back the exact same array. */
function withUnreadableNotice(
  transcript: readonly BackendMessage[],
  skipped: number,
): readonly BackendMessage[] {
  if (skipped <= 0) return transcript;
  return [...transcript, { role: 'user', content: unreadableMemoryNotice(skipped) }];
}

export function planMemory(input: MemoryPlanInput): MemoryPlan {
  const isClaude = input.provider === 'claude';
  const eligible = resumeEligible(input);
  // Marked once, ahead of the branch: every path carries the same transcript, and which
  // path the turn takes must not decide whether the loss is admitted. On the native
  // resume path the note rides along without reaching the model — the server session
  // holds its own copy of the memory, which coa's unreadable line did not damage.
  const transcript = withUnreadableNotice(input.transcript, input.skippedEvents ?? 0);

  if (isClaude && eligible) {
    // Fast path: the server session already holds the memory (and the frozen prompt).
    return {
      resume: input.meta!.backendSessionId!,
      history: transcript,
      deliverHistoryAsPreamble: false,
    };
  }
  if (isClaude) {
    // No resumable server session for this transcript (fresh, or switched in from
    // another provider): carry memory across as a first-turn preamble when there is any.
    return { history: transcript, deliverHistoryAsPreamble: transcript.length > 0 };
  }
  // Pure-API backend: always replay the neutral transcript as history messages.
  return { history: transcript, deliverHistoryAsPreamble: false };
}
