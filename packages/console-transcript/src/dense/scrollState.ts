import type { TranscriptFrame } from './frames.js';

/** Whether the scroll position is within `thresholdPx` of the bottom. A threshold
 *  (not exact equality) absorbs sub-pixel rounding so stick-to-bottom is stable. */
export function nearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  thresholdPx = 80,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= thresholdPx;
}

const isUserText = (fr: TranscriptFrame): boolean =>
  'role' in fr && fr.role === 'you' && fr.kind === 'text';

/** Index of the nearest user-prompt frame strictly above `fromIndex`, or undefined
 *  if none — drives the "↑ previous prompt" jump. */
export function previousPromptIndex(
  frames: TranscriptFrame[],
  fromIndex: number,
): number | undefined {
  for (let i = Math.min(fromIndex, frames.length) - 1; i >= 0; i--) {
    if (isUserText(frames[i]!)) return i;
  }
  return undefined;
}
