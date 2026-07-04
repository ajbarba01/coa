import type { TranscriptFrame } from './Transcript.js';

/** Text content of a frame for search, or '' for non-text kinds. */
function frameText(fr: TranscriptFrame): string {
  if (fr.kind === 'text' || fr.kind === 'thinking') return fr.text;
  if (fr.kind === 'raw') return fr.text;
  if (fr.kind === 'error') return fr.message;
  return '';
}

export interface FindMatch {
  frameId: string;
  index: number;
}

/** Frames (in order) whose text contains `query` (case-insensitive). Empty query → none. */
export function findMatches(frames: TranscriptFrame[], query: string): FindMatch[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const out: FindMatch[] = [];
  frames.forEach((fr, index) => {
    if (frameText(fr).toLowerCase().includes(q)) out.push({ frameId: fr.id, index });
  });
  return out;
}
