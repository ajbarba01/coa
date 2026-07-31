/** One classified line of a diff. `text` is always a verbatim source line (D128:
 *  no trimming or normalization) — the renderer colorizes, never mutates bytes. */
export interface DiffLine {
  kind: 'context' | 'added' | 'removed';
  text: string;
}

/** A whole line-level diff: counts for a `+N −M` summary plus the classified lines. */
export interface LineDiff {
  added: number;
  removed: number;
  lines: DiffLine[];
}

/** Pure LCS line diff of two texts. Byte-faithful and total — never throws, and every
 *  emitted `text` is an exact source line. Used for the `Edit` summary counts and the
 *  rich specimen's inline diff. */
export function diffLines(before: string, after: string): LineDiff {
  const a = before.split('\n');
  const b = after.split('\n');
  const m = a.length;
  const n = b.length;

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const row = lcs[i];
      const nextRow = lcs[i + 1];
      if (row === undefined || nextRow === undefined) continue; // unreachable; satisfies strict indexing
      row[j] =
        a[i] === b[j] ? (nextRow[j + 1] ?? 0) + 1 : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < m && j < n) {
    const ai = a[i];
    const bj = b[j];
    if (ai === undefined || bj === undefined) break;
    if (ai === bj) {
      lines.push({ kind: 'context', text: ai });
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      lines.push({ kind: 'removed', text: ai });
      i++;
      removed++;
    } else {
      lines.push({ kind: 'added', text: bj });
      j++;
      added++;
    }
  }
  for (; i < m; i++) {
    const ai = a[i];
    if (ai === undefined) break;
    lines.push({ kind: 'removed', text: ai });
    removed++;
  }
  for (; j < n; j++) {
    const bj = b[j];
    if (bj === undefined) break;
    lines.push({ kind: 'added', text: bj });
    added++;
  }
  return { added, removed, lines };
}
