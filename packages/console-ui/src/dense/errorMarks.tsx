import { Fragment, type ReactNode } from 'react';

// The small, defensive marker set: a TS diagnostic code, a process exit code, or a
// leading `error:` prefix. `m` (multiline) anchors the `error:` prefix to each line start.
// Global so we can walk every occurrence; the alternation order is longest-first so
// `error TS\d+` wins over a bare `error:` at the same spot.
const MARKERS = /error TS\d+|Exit code: \d+|^error:/gmu;

/** Wrap error markers (`error TS\d+`, `Exit code: \d+`, a leading `error:`) in a strong
 *  `danger` token span, layered over whatever tint the surrounding body already applies.
 *  Byte-faithful (D128): the returned fragments' combined textContent equals the input —
 *  markers are span-wrapped, never rewritten. Pure; never throws. */
export function markErrors(text: string): ReactNode {
  MARKERS.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKERS.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    out.push(
      <span key={key++} className="text-danger font-medium">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
    if (m[0].length === 0) MARKERS.lastIndex++; // guard against a zero-width match looping
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return out;
}
