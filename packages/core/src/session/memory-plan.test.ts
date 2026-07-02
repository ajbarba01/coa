import { describe, expect, it } from 'vitest';
import type { BackendMessage } from '@coa/shared';
import { planMemory, resumeEligible } from './memory-plan.js';

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
