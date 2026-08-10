import { describe, expect, it } from 'vitest';
import type { BackendMessage } from '@coa/shared';
import { planMemory, resumeEligible, unreadableMemoryNotice } from './memory-plan.js';

const transcript: BackendMessage[] = [
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'hello' },
];

describe('resumeEligible', () => {
  it('is false with no token or no stamp', () => {
    expect(resumeEligible({ provider: 'claude', model: 'm' })).toBe(false);
    expect(
      resumeEligible({ provider: 'claude', model: 'm', meta: { backendSessionId: 'x' } }),
    ).toBe(false);
  });

  it('is true only when provider AND model both match the stamp', () => {
    const meta = { backendSessionId: 'sid', resumeStamp: { provider: 'claude', model: 'opus' } };
    expect(resumeEligible({ provider: 'claude', model: 'opus', meta })).toBe(true);
    expect(resumeEligible({ provider: 'claude', model: 'sonnet', meta })).toBe(false);
    expect(resumeEligible({ provider: 'deepseek', model: 'opus', meta })).toBe(false);
  });

  it('matches undefined model against an unstamped model', () => {
    const meta = { backendSessionId: 'sid', resumeStamp: { provider: 'claude' } };
    expect(resumeEligible({ provider: 'claude', meta })).toBe(true);
    expect(resumeEligible({ provider: 'claude', model: 'opus', meta })).toBe(false);
  });
});

describe('planMemory', () => {
  it('Claude same-provider continuation uses native resume (no preamble)', () => {
    const meta = { backendSessionId: 'sid', resumeStamp: { provider: 'claude', model: 'opus' } };
    expect(planMemory({ provider: 'claude', model: 'opus', meta, transcript })).toEqual({
      resume: 'sid',
      history: transcript,
      deliverHistoryAsPreamble: false,
    });
  });

  it('Claude with a mismatched (stale-model) token drops resume and preambles the transcript', () => {
    const meta = { backendSessionId: 'sid', resumeStamp: { provider: 'claude', model: 'opus' } };
    const plan = planMemory({ provider: 'claude', model: 'sonnet', meta, transcript });
    expect(plan.resume).toBeUndefined();
    expect(plan.deliverHistoryAsPreamble).toBe(true);
    expect(plan.history).toBe(transcript);
  });

  it('Claude switched in from DeepSeek (token stamped deepseek) preambles the transcript', () => {
    const meta = { backendSessionId: 'ds', resumeStamp: { provider: 'deepseek', model: 'chat' } };
    const plan = planMemory({ provider: 'claude', model: 'opus', meta, transcript });
    expect(plan.resume).toBeUndefined();
    expect(plan.deliverHistoryAsPreamble).toBe(true);
  });

  it('Claude fresh conversation with empty transcript needs no preamble', () => {
    const plan = planMemory({ provider: 'claude', model: 'opus', transcript: [] });
    expect(plan).toEqual({ history: [], deliverHistoryAsPreamble: false });
  });

  it('DeepSeek always replays the transcript as history, never resumes or preambles', () => {
    const meta = { backendSessionId: 'sid', resumeStamp: { provider: 'claude', model: 'opus' } };
    expect(planMemory({ provider: 'deepseek', model: 'chat', meta, transcript })).toEqual({
      history: transcript,
      deliverHistoryAsPreamble: false,
    });
  });
});

describe('planMemory — a transcript the store could not fully read', () => {
  it('tells the model its memory is a fragment, without touching what was read', () => {
    // The silence this replaces: the store counted the events it could not read, but the
    // resume path took only the messages — so a model was handed a truncated transcript
    // that looked exactly like a whole one and carried on as if nothing were missing.
    const plan = planMemory({ provider: 'deepseek', model: 'chat', transcript, skippedEvents: 2 });
    expect(plan.history.slice(0, 2)).toEqual(transcript); // read turns, in order, untouched
    expect(plan.history).toHaveLength(3);
    expect(plan.history[2]).toEqual({
      role: 'user',
      content: unreadableMemoryNotice(2),
    });
    expect(unreadableMemoryNotice(2)).toContain('2 earlier events');
    expect(unreadableMemoryNotice(1)).toContain('1 earlier event');
  });

  it('marks the Claude preamble the same way — the branch taken must not decide honesty', () => {
    const plan = planMemory({ provider: 'claude', model: 'opus', transcript, skippedEvents: 1 });
    expect(plan.deliverHistoryAsPreamble).toBe(true);
    expect(plan.history[plan.history.length - 1]).toEqual({
      role: 'user',
      content: unreadableMemoryNotice(1),
    });
  });

  it('says nothing when the record read cleanly', () => {
    // A clean read is the normal case and must be byte-identical to before: no note, and
    // the very same array (nothing copied, nothing appended).
    expect(planMemory({ provider: 'deepseek', transcript, skippedEvents: 0 }).history).toBe(
      transcript,
    );
    expect(planMemory({ provider: 'deepseek', transcript }).history).toBe(transcript);
  });
});
