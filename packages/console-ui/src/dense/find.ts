import type { TranscriptFrame } from './Transcript.js';

/** Text content of a frame for search, or '' for non-text kinds. */
function frameText(fr: TranscriptFrame): string {
  if (fr.kind === 'text' || fr.kind === 'thinking') return fr.text;
  if (fr.kind === 'raw') return fr.text;
  if (fr.kind === 'error') return fr.message;
  return '';
}

export interface FindTermMatch {
  frameId: string;
  /** The owning frame's index — drives row navigation + the active-row wash. */
  index: number;
  /** Which occurrence within its frame this is (0-based). */
  occurrence: number;
}

/** Every occurrence of `query` across the frames' text (case-insensitive), in
 *  document order — the count reads matches, not rows. Empty query → none.
 *  Counting/navigation run on this frame DATA; the painted term highlights walk
 *  the rendered DOM instead (findHighlight.ts) — best-effort twins, since
 *  markdown rendering can reshape text. */
export function findTermMatches(frames: TranscriptFrame[], query: string): FindTermMatch[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const out: FindTermMatch[] = [];
  frames.forEach((fr, index) => {
    const text = frameText(fr).toLowerCase();
    let occurrence = 0;
    for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + q.length)) {
      out.push({ frameId: fr.id, index, occurrence });
      occurrence++;
    }
  });
  return out;
}
