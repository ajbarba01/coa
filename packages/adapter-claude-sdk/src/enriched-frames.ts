import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TurnFrame } from '@coa/shared';
import { messageToFrames } from './turn-frames.js';
import { resultText } from './transcript.js';

/**
 * One mapped {@link TurnFrame} plus, for a `tool_result`, the FULL body the model
 * saw — the lossy render-stream pointer paired with the append-only log's fidelity
 * companion (docs/adr/0010). `full` is persistence-only; it never reaches the wire.
 */
export interface EnrichedFrame {
  frame: TurnFrame;
  full?: string;
}

/**
 * Map one SDK message to enriched frames: the lossy UI frame ({@link messageToFrames})
 * plus, for each `tool_result`, the full body from the SDK content. Frames and full
 * bodies are matched positionally — a `user` message's `tool_result` blocks map 1:1,
 * in order, to the `tool_result` frames `messageToFrames` produces from the same blocks.
 */
export function messageToEnrichedFrames(message: SDKMessage): EnrichedFrame[] {
  const frames = messageToFrames(message);
  const fulls = toolResultFullBodies(message); // [] unless a `user` message with tool_result blocks
  let ri = 0;
  return frames.map((frame) => {
    if (frame.t === 'tool_result') {
      const full = fulls[ri++];
      return full !== undefined ? { frame, full } : { frame };
    }
    return { frame };
  });
}

/** A content block as it appears on a `user` SDK message (the fields this mapper reads;
 *  mirrors `transcript.ts`'s local shape rather than the SDK's own narrower union types,
 *  which don't admit a plain structural filter). */
interface ContentBlock {
  type: string;
  content?: unknown;
}

function toolResultFullBodies(message: SDKMessage): string[] {
  if (message.type !== 'user') return [];
  const content = message.message.content;
  if (!Array.isArray(content)) return [];
  return (content as ContentBlock[])
    .filter((b) => b.type === 'tool_result')
    .map((b) => resultText(b.content));
}
