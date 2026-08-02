export interface ClampedLines {
  shown: string;
  truncated: boolean;
  hiddenCount: number;
}

/** Clamp text to `maxLines`, from the start (default) or the end (`fromEnd`). Deterministic
 *  and byte-faithful — `shown` is exact source lines. Pure; never throws. */
export function clampLines(
  text: string,
  maxLines: number,
  opts?: { fromEnd?: boolean } | undefined,
): ClampedLines {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { shown: text, truncated: false, hiddenCount: 0 };
  const hiddenCount = lines.length - maxLines;
  const shown = (opts?.fromEnd === true ? lines.slice(-maxLines) : lines.slice(0, maxLines)).join(
    '\n',
  );
  return { shown, truncated: true, hiddenCount };
}
