import type { Delivery } from '@coa/spi';

/**
 * Why a child session ended. Exactly the three outcomes the daemon OBSERVES —
 * there is deliberately no inferred or advisory reason (no "went quiet"), because
 * a signal that cannot be detected must not be reported as one.
 */
export type SessionEndReason = 'completed' | 'errored' | 'stopped';

export interface ChildEndedNotice {
  child: string;
  agentRef: string;
  reason: SessionEndReason;
  /** Free text for an `errored` outcome (e.g. the provider's message). */
  detail?: string;
  /**
   * The child's own final answer, for a `completed` outcome — a read-time fold
   * of the child's (and, if it spawned any, its own descendants') event log
   * (`session-service.ts`'s `#childResultText`, built on `transcript-projection.ts`'s
   * `foldTreeToTranscript` + `latestAssistantText`), never text the child asserts
   * about itself through any tool-reachable seam. Absent ⇒ the child produced no
   * assistant text (a pure tool-only run, an interrupted one) or the store was
   * unavailable — the pre-result fallback sentence is used instead.
   */
  result?: string;
}

/**
 * How much of a provider's raw error text to keep. Long enough to be useful,
 * short enough that one runaway stack trace can't flood the parent's context.
 */
const MAX_DETAIL_LENGTH = 300;

/**
 * How much of a child's own final answer to quote in its completion notice. Wider
 * than `MAX_DETAIL_LENGTH`: unlike an error's raw exception text, a `completed`
 * result is the whole point of the notice, not an incidental diagnostic — but it
 * is still bounded, because the full text stays honestly readable via the child's
 * own transcript (the existing read path this was never meant to replace; see
 * `docs/adr/0033`) and a subagent's answer must not be able to flood the parent's
 * context outright.
 */
const MAX_RESULT_LENGTH = 2000;

/**
 * Collapse every C0 control character, DEL, and the Unicode line/paragraph
 * separators (code points 8232/8233) to a single space, then trim. Shared by
 * `sanitizeDetail` and the `completed` sentence's result text below — both are
 * free text with no upstream format guarantee (provider/SDK exception text, and a
 * child's own model-generated final answer, respectively) that could otherwise
 * carry a newline and make injected text look like a second, line-initial
 * notice — not just to a model reading its context, but to a human operator too:
 * the console transcript is a browser-rendered view, and those two separators are
 * mandatory line breaks there independent of any `white-space` handling, so they
 * need flattening for the same reason CR/LF do.
 */
function flattenControlChars(raw: string): string {
  let flattened = '';
  let sawSpace = false;
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || code === 0x7f || code === 8232 || code === 8233;
    if (isControl) {
      if (!sawSpace) {
        flattened += ' ';
        sawSpace = true;
      }
      continue;
    }
    flattened += ch;
    sawSpace = ch === ' ';
  }
  return flattened.trim();
}

/**
 * `detail` is one of two fields here with no upstream format guarantee: `child`
 * is a daemon-generated id, and `agentRef` is constrained by `agent-defs.ts`'s
 * `SAFE_REF` (a single-path-segment regex with no whitespace or control
 * characters — this module's safety for those two fields depends on that
 * constraint holding upstream). `detail` (provider/SDK exception text) and
 * `result` (the child's own final answer, see {@link renderCompleted}) get the
 * same flatten-and-cap treatment as each other, via the shared
 * {@link flattenControlChars}, because neither is constrained upstream the way
 * `child`/`agentRef` are.
 */
function sanitizeDetail(detail: string): string {
  const flattened = flattenControlChars(detail);
  if (flattened.length === 0) return 'no detail reported';
  return flattened.length > MAX_DETAIL_LENGTH
    ? `${flattened.slice(0, MAX_DETAIL_LENGTH)}…`
    : flattened;
}

/**
 * The `completed` sentence: the child's own final answer when the caller folded
 * one (see {@link ChildEndedNotice.result}), else the pre-result fallback for a
 * child that produced no readable text. `result` gets the same flatten-and-cap
 * treatment `detail` already gets (see {@link flattenControlChars}) — it is
 * model-generated text with no upstream format guarantee, so it is sanitized
 * exactly like any other tool output a model reads, never trusted as a bare
 * system assertion just because it rides a `system`-origin delivery. A truncated
 * result says so explicitly and names the child's own transcript as where to
 * read the rest, rather than silently presenting a fragment as the whole answer.
 */
function renderCompleted(head: string, child: string, result: string | undefined): string {
  if (result === undefined) return `${head} finished. Read its transcript for the result.`;
  const flattened = flattenControlChars(result);
  if (flattened.length === 0) return `${head} finished. Read its transcript for the result.`;
  const truncated = flattened.length > MAX_RESULT_LENGTH;
  const text = truncated ? `${flattened.slice(0, MAX_RESULT_LENGTH)}…` : flattened;
  const tail = truncated
    ? ` (truncated — read session ${child}'s full transcript for the rest)`
    : '';
  return `${head} finished: ${text}${tail}`;
}

/**
 * Render a child's ending as a system-authored delivery. The origin is `system`
 * and is unforgeable: it is hardcoded below, not a parameter, and no producer is
 * reachable from a tool handler, so a model cannot fabricate a completion for
 * itself. `child` and `agentRef` are interpolated as inert data, never as
 * instructions the text asks the reader to follow, so a hostile child name still
 * reads only as the labeled subject of a fixed system sentence. `detail`/`result`
 * get the same sanitizing treatment before they're interpolated, since unlike the
 * other two fields neither is already constrained to a single line upstream —
 * `result` in particular is the child's own model-generated text, and rides the
 * unforgeable `system` envelope only as sanitized, quoted DATA, never as an
 * assertion the envelope itself vouches for (`docs/adr/0033`, extended by
 * `docs/adr/0038`).
 */
export function renderChildEnded(notice: ChildEndedNotice): Delivery {
  const head = `subagent ${notice.agentRef} (${notice.child})`;
  const body =
    notice.reason === 'completed'
      ? renderCompleted(head, notice.child, notice.result)
      : notice.reason === 'stopped'
        ? `${head} was stopped before it finished.`
        : `${head} failed: ${notice.detail !== undefined ? sanitizeDetail(notice.detail) : 'no detail reported'}.`;
  return { origin: 'system', text: body };
}
