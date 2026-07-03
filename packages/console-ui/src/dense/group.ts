import type { TranscriptFrame } from './Transcript.js';

const isUserTurn = (fr: TranscriptFrame): boolean => 'role' in fr && fr.role === 'you' && fr.kind === 'text';

export interface GroupedFrames {
  counts: number[];
  headers: (TranscriptFrame | undefined)[];
  items: TranscriptFrame[];
}

/** Group the stream by user turn: each `you` text frame is a sticky group header; the
 *  following non-user frames are its body. Frames before the first user turn form a
 *  leading group with an undefined header. */
export function groupByUserTurn(frames: TranscriptFrame[]): GroupedFrames {
  const counts: number[] = [];
  const headers: (TranscriptFrame | undefined)[] = [];
  const items: TranscriptFrame[] = [];
  let current = 0;
  let started = false;
  for (const fr of frames) {
    if (isUserTurn(fr)) {
      if (started) counts.push(current);
      headers.push(fr);
      current = 0;
      started = true;
    } else {
      if (!started) {
        headers.push(undefined);
        started = true;
      }
      current += 1;
      items.push(fr);
    }
  }
  if (started) counts.push(current);
  return { counts, headers, items };
}
