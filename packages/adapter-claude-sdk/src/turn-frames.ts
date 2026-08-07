import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TurnFrame } from '@coa/shared';

/**
 * The SDK→neutral mapping: one Claude `SDKMessage` → zero or more neutral
 * {@link TurnFrame}s. This is the backend-specific half of the session output
 * seam — only this adapter knows the SDK's message/content-block shape, so the
 * translation to coa's own turn vocabulary lives here, not in the core. The daemon
 * owns the emission
 * policy (sequencing + wrapping each frame into a `turn` Push); this stays a pure,
 * per-message function so a second adapter (e.g. a from-scratch pure-API backend)
 * implements the same contract against its own wire format.
 *
 * Only the frames the transcript renders are produced; transport/system messages
 * (init, status, retries) map to nothing. Tool-return distillation (the byte-
 * faithful handle/pointer) is the workbench's and daemon's job — the floor carries the tool_use id
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
 * Map a `SDKPartialAssistantMessage` (`includePartialMessages`) to a delivery-only
 * delta frame. Only content-block text/thinking deltas render live; block start/stop, tool-input
 * (`input_json_delta`), and message-level events carry no frame — the settled assistant message
 * still yields the canonical `text`/`thinking` frames, and only those persist (deltas
 * are delivery-only, never written to the record).
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

/** A short, render-safe pointer to the tool return (the byte-faithful body stays in the daemon). */
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
  // `terminal_reason` is optional on BOTH result shapes and distinguishes 13 endings.
  // Reading only `subtype` made a close-gate block, a turn-cap cutoff and a clean finish
  // indistinguishable. Reported verbatim on the boundary; only coa's own blocks are
  // reinterpreted as denials — the system blocks only through its own two gates, so
  // anything else must surface untouched.
  const terminal = message.terminal_reason;
  const boundary: TurnFrame = {
    t: 'turn-boundary',
    role: 'assistant',
    ...(message.subtype === 'success' && message.stop_reason !== null
      ? { stop: message.stop_reason }
      : {}),
    ...(terminal !== undefined ? { terminal } : {}),
  };
  if (message.subtype === 'success') return [boundary];
  if (terminal === 'stop_hook_prevented')
    return [{ t: 'deny', denyKind: 'close-gate', reason: terminal }, boundary];
  return [{ t: 'error', message: message.subtype, origin: 'loop' }, boundary];
}
