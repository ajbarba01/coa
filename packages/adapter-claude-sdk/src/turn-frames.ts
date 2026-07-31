import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TurnFrame } from '@coa/shared';

/**
 * The M9 SDK→neutral mapping: one Claude `SDKMessage` → zero or more M0
 * {@link TurnFrame}s. This is the backend-specific half of the session output
 * seam — only M9 knows the SDK's message/content-block shape, so the translation
 * to coa's own turn vocabulary lives here, not in the core. M8 owns the emission
 * policy (sequencing + wrapping each frame into a `turn` Push); this stays a pure,
 * per-message function so a second adapter (e.g. a from-scratch pure-API backend)
 * implements the same contract against its own wire format.
 *
 * Only the frames the transcript renders are produced; transport/system messages
 * (init, status, retries) map to nothing. Tool-return distillation (the byte-
 * faithful handle/pointer, D57) is M6/M8's job — the floor carries the tool_use id
 * as the handle and a short content pointer.
 */

/** A content block as it appears on an assistant/user SDK message (the fields the mapper reads). */
interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export function messageToFrames(message: SDKMessage): TurnFrame[] {
  switch (message.type) {
    case 'assistant':
      return blocksToFrames(contentBlocks(message.message.content));
    case 'user':
      return blocksToFrames(contentBlocks(message.message.content));
    case 'result':
      return resultFrames(message);
    case 'stream_event':
      return streamEventFrames(message);
    default:
      return [];
  }
}

/** A partial-message stream event's fields this mapper reads (Anthropic `BetaRawMessageStreamEvent`). */
interface StreamEvent {
  event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
}

/**
 * Map a `SDKPartialAssistantMessage` (`includePartialMessages`, Piece B / G7) to a delivery-only
 * delta frame. Only content-block text/thinking deltas render live; block start/stop, tool-input
 * (`input_json_delta`), and message-level events carry no frame — the settled assistant message
 * still yields the canonical `text`/`thinking` frames, and only those persist (docs/adr/0013).
 */
function streamEventFrames(message: SDKMessage): TurnFrame[] {
  const ev = (message as unknown as StreamEvent).event;
  if (ev?.type !== 'content_block_delta') return [];
  if (ev.delta?.type === 'text_delta') return [{ t: 'text-delta', text: ev.delta.text ?? '' }];
  if (ev.delta?.type === 'thinking_delta')
    return [{ t: 'thinking-delta', text: ev.delta.thinking ?? '' }];
  return [];
}

/** Normalize a message `content` field to a block array (a plain string carries no renderable frame). */
function contentBlocks(content: unknown): ContentBlock[] {
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

function blocksToFrames(blocks: ContentBlock[]): TurnFrame[] {
  const frames: TurnFrame[] = [];
  for (const block of blocks) {
    const frame = blockToFrame(block);
    if (frame !== undefined) frames.push(frame);
  }
  return frames;
}

function blockToFrame(block: ContentBlock): TurnFrame | undefined {
  switch (block.type) {
    case 'text':
      return { t: 'text', text: block.text ?? '' };
    case 'thinking':
      return { t: 'thinking', text: block.thinking ?? '' };
    case 'tool_use':
      return {
        t: 'tool_use',
        tool: block.name ?? '',
        input: block.input ?? {},
        handle: block.id ?? '',
      };
    case 'tool_result':
      return {
        t: 'tool_result',
        handle: block.tool_use_id ?? '',
        ok: block.is_error !== true,
        pointer: pointerOf(block.content),
      };
    default:
      return undefined;
  }
}

/** A short, render-safe pointer to the tool return (the byte-faithful body stays in the daemon, D57). */
function pointerOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'object' && part !== null && 'text' in part
          ? String((part as { text: unknown }).text)
          : '',
      )
      .join('');
  }
  return '';
}

function resultFrames(message: Extract<SDKMessage, { type: 'result' }>): TurnFrame[] {
  if (message.subtype === 'success') {
    const stop = message.stop_reason ?? undefined;
    return [{ t: 'turn-boundary', role: 'assistant', ...(stop !== undefined ? { stop } : {}) }];
  }
  return [
    { t: 'error', message: message.subtype, origin: 'loop' },
    { t: 'turn-boundary', role: 'assistant' },
  ];
}
