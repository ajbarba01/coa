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
}

/**
 * How much of a provider's raw error text to keep. Long enough to be useful,
 * short enough that one runaway stack trace can't flood the parent's context.
 */
const MAX_DETAIL_LENGTH = 300;

/**
 * `detail` is the one field here with no upstream format guarantee: `child` is a
 * daemon-generated id, and `agentRef` is constrained by `agent-defs.ts`'s
 * `SAFE_REF` (a single-path-segment regex with no whitespace or control
 * characters — this module's safety for that field depends on that constraint
 * holding upstream). `detail` is provider/SDK exception text with no such
 * guarantee, so it is the only field that could otherwise carry a newline and
 * make injected text look like a second, line-initial notice — not just to a
 * model reading its context, but to a human operator too: the console transcript
 * is a browser-rendered view, and the Unicode line/paragraph separators (code
 * points 8232/8233) are mandatory line breaks there independent of any
 * `white-space` handling, so they need flattening for the same reason CR/LF do.
 * Collapse every C0 control character (this covers CR and LF, the concrete
 * vector), DEL, and those two separators to a single space so the string can
 * never break out of the one sentence it's embedded in, and cap the length. This
 * keeps a hostile or merely huge string as inert data inside a fixed sentence,
 * rather than re-encoding it into escape noise a model has to puzzle over.
 */
function sanitizeDetail(detail: string): string {
  let flattened = '';
  let sawSpace = false;
  for (const ch of detail) {
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
  flattened = flattened.trim();
  if (flattened.length === 0) return 'no detail reported';
  return flattened.length > MAX_DETAIL_LENGTH
    ? `${flattened.slice(0, MAX_DETAIL_LENGTH)}…`
    : flattened;
}

/**
 * Render a child's ending as a system-authored delivery. The origin is `system`
 * and is unforgeable: it is hardcoded below, not a parameter, and no producer is
 * reachable from a tool handler, so a model cannot fabricate a completion for
 * itself. `child` and `agentRef` are interpolated as inert data, never as
 * instructions the text asks the reader to follow, so a hostile child name still
 * reads only as the labeled subject of a fixed system sentence. `detail` gets the
 * same treatment after `sanitizeDetail` flattens it, since unlike the other two
 * fields it isn't already constrained to a single line upstream.
 */
export function renderChildEnded(notice: ChildEndedNotice): Delivery {
  const head = `subagent ${notice.agentRef} (${notice.child})`;
  const body =
    notice.reason === 'completed'
      ? `${head} finished. Read its transcript for the result.`
      : notice.reason === 'stopped'
        ? `${head} was stopped before it finished.`
        : `${head} failed: ${notice.detail !== undefined ? sanitizeDetail(notice.detail) : 'no detail reported'}.`;
  return { origin: 'system', text: body };
}
