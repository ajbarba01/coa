import type { CoaError, DiffSpec } from '@coa/shared';

/**
 * The result of applying a {@link DiffSpec} to a source artifact. A success
 * carries the new bytes; a failure carries a house {@link CoaError} (the agent
 * falls back to the whole-file escape or a fresh attempt — M6 never blocks).
 */
export type DiffResult = { ok: true; bytes: string } | { ok: false; error: CoaError };

/**
 * M6 producer ① — the deterministic, lenient edit core (Ruling-3). Apply a
 * {@link DiffSpec} to `source` and return the new bytes, with no model call (P1).
 * The whole-file form is the co-equal escape (always reachable); search-replace
 * is the preferred lenient localized path. A hunk that cannot be matched
 * unambiguously is a failure, never a silent wrong edit.
 */
export function applyDiff(source: string, diff: DiffSpec): DiffResult {
  switch (diff.form) {
    case 'whole-file':
      return { ok: true, bytes: diff.body };
    case 'search-replace':
      return applySearchReplace(source, diff.hunks);
    case 'unified':
      // A textual unified-diff engine is a deferred follow-up; degrade to a typed
      // error (D85) so the agent falls back to the search-replace / whole-file path.
      return {
        ok: false,
        error: {
          code: 'diff-unsupported-form',
          message: 'unified-diff application is not yet supported',
        },
      };
  }
}

/** Apply each search-replace hunk in order, threading the result of each into the next. */
function applySearchReplace(
  source: string,
  hunks: readonly { find: string; replace: string }[],
): DiffResult {
  let bytes = source;
  for (const hunk of hunks) {
    const exact = occurrences(bytes, hunk.find);
    if (exact > 1) return ambiguous(hunk.find, exact);
    if (exact === 1) {
      bytes = bytes.replace(hunk.find, hunk.replace);
      continue;
    }
    const lenient = lenientReplace(bytes, hunk.find, hunk.replace);
    if (!lenient.ok) return lenient;
    bytes = lenient.bytes;
  }
  return { ok: true, bytes };
}

const notFound = (find: string): DiffResult => ({
  ok: false,
  error: { code: 'diff-not-found', message: `find text not present: ${find}` },
});

const ambiguous = (find: string, count: number): DiffResult => ({
  ok: false,
  error: { code: 'diff-ambiguous', message: `find text matches ${count} sites: ${find}` },
});

/**
 * The lenient fallback (Ruling-3): match the find block against source lines
 * ignoring per-line leading/trailing whitespace, then splice in the replacement
 * re-indented to the matched block's indentation. Requires a single match —
 * zero or many is a failure, never a silent wrong edit.
 */
function lenientReplace(source: string, find: string, replace: string): DiffResult {
  const sourceLines = source.split('\n');
  const findLines = trimTrailingBlank(find.split('\n'));
  if (findLines.length === 0) return notFound(find);

  const starts = matchStarts(sourceLines, findLines);
  if (starts.length === 0) return notFound(find);
  if (starts.length > 1) return ambiguous(find, starts.length);

  const start = starts[0] ?? 0;
  const indent = leadingWhitespace(sourceLines[start] ?? '');
  const reindented = trimTrailingBlank(replace.split('\n')).map((line) =>
    line.length === 0 ? line : indent + line.trimStart(),
  );
  const merged = [
    ...sourceLines.slice(0, start),
    ...reindented,
    ...sourceLines.slice(start + findLines.length),
  ];
  return { ok: true, bytes: merged.join('\n') };
}

/** Window-match `findLines` against `sourceLines`, comparing each line stripped of edge whitespace. */
function matchStarts(sourceLines: readonly string[], findLines: readonly string[]): number[] {
  const starts: number[] = [];
  for (let i = 0; i + findLines.length <= sourceLines.length; i++) {
    if (findLines.every((line, j) => (sourceLines[i + j] ?? '').trim() === line.trim())) {
      starts.push(i);
    }
  }
  return starts;
}

/** Drop trailing all-blank lines (a find/replace block authored with a trailing newline). */
function trimTrailingBlank(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && (out[out.length - 1] ?? '').trim() === '') out.pop();
  return out;
}

/** The leading-whitespace prefix of a line (its indentation). */
function leadingWhitespace(line: string): string {
  return line.slice(0, line.length - line.trimStart().length);
}

/** Count non-overlapping occurrences of `needle` in `haystack` (empty needle counts as zero). */
function occurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}
