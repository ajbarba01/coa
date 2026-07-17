import { describe, it, expect } from 'vitest';
import type { TurnFrame } from '@coa/shared';
import {
  foldEventsToTranscript,
  repairUnpairedToolCalls,
  type PersistedEvent,
} from './transcript-projection.js';

const ev = (seq: number, frame: TurnFrame, full?: string): PersistedEvent =>
  full !== undefined ? { seq, frame, full } : { seq, frame };

describe('foldEventsToTranscript', () => {
  it('folds a clean turn: user, assistant text + tool_use, tool_result, assistant answer', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'do it', role: 'user' }),
      ev(1, { t: 'text', text: 'working' }),
      ev(2, { t: 'tool_use', tool: 'Read', input: { path: 'a' }, handle: 'h1' }),
      ev(3, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'short' }, 'FULL FILE BODY'),
      ev(4, { t: 'text', text: 'done' }),
      ev(5, { t: 'turn-boundary', role: 'assistant' }),
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: 'working',
        toolCalls: [{ id: 'h1', name: 'Read', arguments: { path: 'a' } }],
      },
      { role: 'tool', toolCallId: 'h1', content: 'FULL FILE BODY' },
      { role: 'assistant', content: 'done' },
    ]);
  });

  it('folds an interrupted marker into a user-visible notice so the model knows it was cut off', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'write a poem', role: 'user' }),
      ev(1, { t: 'text', text: 'The clockmaker' }), // the partial the model got out
      ev(2, { t: 'interrupted' }),
    ];
    // The interrupt closes the partial assistant turn and lands as an explicit notice, so the
    // NEXT turn's context shows the model its response was stopped (not that it completed).
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'write a poem' },
      { role: 'assistant', content: 'The clockmaker' },
      { role: 'user', content: '[Request interrupted by user]' },
    ]);
  });

  it('drops thinking/error/reconcile/permission/subagent frames (not in the transcript)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'hi', role: 'user' }),
      ev(1, { t: 'thinking', text: 'hmm' }),
      ev(2, { t: 'text', text: 'reply' }),
      ev(3, { t: 'error', message: 'boom', origin: 'loop' }),
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('uses `full` for the tool message content, falling back to the frame pointer when absent', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'x', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'T', input: {}, handle: 'h1' }),
      ev(2, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'PTR' }), // no full
    ];
    const out = foldEventsToTranscript(events);
    expect(out.find((m) => m.role === 'tool')).toEqual({
      role: 'tool',
      toolCallId: 'h1',
      content: 'PTR',
    });
  });

  it('repairs an interrupted trailing tool_use (synthesize a paired result, not drop the assistant turn)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'go', role: 'user' }),
      ev(1, { t: 'text', text: 'calling' }),
      ev(2, { t: 'tool_use', tool: 'Bash', input: { cmd: 'x' }, handle: 'h9' }), // no result → interrupted
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'calling',
        toolCalls: [{ id: 'h9', name: 'Bash', arguments: { cmd: 'x' } }],
      },
      { role: 'tool', toolCallId: 'h9', content: '[Tool execution was interrupted]' },
    ]);
  });

  it('skips a wholly-empty assistant turn (empty text, no tool calls) — matches the retired mapper', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'hi', role: 'user' }),
      ev(1, { t: 'text', text: '' }), // an empty assistant text block, nothing else in the turn
      ev(2, { t: 'turn-boundary', role: 'assistant' }),
    ];
    // The retired messageToBackendMessages returned [] for an empty assistant turn; the
    // fold must not emit a stray { role:'assistant', content:'' } (D85 parity).
    expect(foldEventsToTranscript(events)).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('repairs a STRANDED non-last call in a parallel batch (set membership, not position)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'go', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'A', input: {}, handle: 'h1' }),
      ev(2, { t: 'tool_use', tool: 'B', input: {}, handle: 'h2' }),
      ev(3, { t: 'tool_result', handle: 'h2', ok: true, pointer: 'p' }, 'B-RESULT'), // h1 stranded
    ];
    const out = foldEventsToTranscript(events);
    // both calls are answered — h1 synthesized, h2 real — inserted after their assistant message
    expect(out.filter((m) => m.role === 'tool')).toEqual([
      { role: 'tool', toolCallId: 'h1', content: '[Tool execution was interrupted]' },
      { role: 'tool', toolCallId: 'h2', content: 'B-RESULT' },
    ]);
  });

  it('drops an ORPHANED tool_result (a result whose handle never had a matching tool_use)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'tool_result', handle: 'ghost', ok: true, pointer: 'p' }, 'GHOST-BODY'),
    ];
    // An orphaned result answers no assistant tool call and would invalidate the
    // transcript (an OpenAI-compatible endpoint 400s on it) — so it is dropped.
    expect(foldEventsToTranscript(events)).toEqual([]);
  });

  it('still emits a matched tool_result even alongside an orphan drop', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'x', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'T', input: {}, handle: 'h1' }),
      ev(2, { t: 'tool_result', handle: 'ghost', ok: true, pointer: 'g' }, 'GHOST'), // orphan → dropped
      ev(3, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'p' }, 'REAL'), // matched → kept
    ];
    expect(foldEventsToTranscript(events).filter((m) => m.role === 'tool')).toEqual([
      { role: 'tool', toolCallId: 'h1', content: 'REAL' },
    ]);
  });

  it('folds a TOOL-ONLY assistant turn (no preceding text) to an empty-content assistant message', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'go', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'Read', input: { path: 'a' }, handle: 'h1' }),
      ev(2, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'p' }, 'BODY'),
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'h1', name: 'Read', arguments: { path: 'a' } }],
      },
      { role: 'tool', toolCallId: 'h1', content: 'BODY' },
    ]);
  });
});
