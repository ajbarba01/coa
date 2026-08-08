/** Pure, fenced-code-aware segmentation of accumulating streamed markdown into settled blocks
 *  plus the in-progress trailing region. A blank line is a block boundary only when NOT inside a
 *  ``` / ~~~ fence; a closing fence ends its block; a trailing single newline stays trailing
 *  (soft-break ambiguity) so `completed` is append-only as text grows. Append-only is what lets
 *  the caller memoize each completed block by content and key it by index. No DOM, no React;
 *  re-run each frame under `useMemo` (StrictMode-safe — no mutation). */
export interface StreamSplit {
  completed: string[];
  /** The in-progress region after the last settled block. Part of the pure segmentation contract
   *  (and test-locked) though the current output renderer consumes only `completed` — the trailing
   *  region and its open-fence flag stay available for a future trailing-block consumer. */
  trailing: string;
  trailingIsOpenCode: boolean;
}

const FENCE = /^\s*(`{3,}|~{3,})/;

function fenceChar(line: string): '`' | '~' | undefined {
  const m = FENCE.exec(line);
  if (m === null) return undefined;
  return m[1]![0] as '`' | '~';
}

/** A closing fence: the marker char repeated (>=3), only whitespace around it, no info string. */
function isFenceClose(line: string, ch: '`' | '~'): boolean {
  const t = line.trim();
  return t.length >= 3 && [...t].every((c) => c === ch);
}

export function splitStreamingMarkdown(text: string): StreamSplit {
  const lines = text.split('\n');
  const completed: string[] = [];
  let current: string[] = [];
  let fence: '`' | '~' | undefined;

  const flush = (): void => {
    if (current.length > 0) {
      completed.push(current.join('\n'));
      current = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const isLast = i === lines.length - 1;

    if (fence !== undefined) {
      current.push(line);
      if (isFenceClose(line, fence)) {
        // A closing fence unambiguously ends the block, even as the last line so far — its
        // content is frozen (append-only), so completing it now is safe.
        fence = undefined;
        flush();
      }
      continue;
    }

    const ch = fenceChar(line);
    if (ch !== undefined) {
      flush(); // any prose before the fence is its own completed block
      fence = ch;
      current.push(line);
      continue;
    }

    if (line.trim() === '') {
      // A blank line ends a block — but a TRAILING blank (the final line) is left pending: the
      // stream may add a soft-break continuation next frame. Only an interior blank commits.
      if (!isLast) flush();
      continue;
    }

    current.push(line);
  }

  return {
    completed,
    trailing: current.join('\n'),
    trailingIsOpenCode: fence !== undefined,
  };
}

export interface WordToken {
  value: string;
  /** True for a non-whitespace run (an animated word), false for a whitespace run. */
  word: boolean;
}

/** Split into alternating word / whitespace runs, keeping whitespace as its own tokens so
 *  wrapping is unaffected (per the OSS survey: never split per-character). */
export function splitWords(text: string): WordToken[] {
  return (text.match(/\s+|\S+/g) ?? []).map((value) => ({ value, word: /\S/.test(value) }));
}
