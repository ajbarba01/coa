import { describe, expect, it, vi } from 'vitest';
import type { RuntimeUsage } from '@coa/spi';
import { makeSummarizer } from './summarizer.js';

const USAGE = { tokensIn: 10, tokensOut: 5, costUsd: 0.001 } satisfies RuntimeUsage;

const completeReturning = (text: string) =>
  vi.fn(async () => ({ text, toolCalls: [], usage: USAGE }));

describe('makeSummarizer', () => {
  it('feeds page + prompt to complete() and returns its text', async () => {
    const complete = completeReturning('SUMMARY');
    const s = makeSummarizer({ complete });
    const out = await s.summarize({ markdown: '# page', prompt: 'what is it?' });
    expect(out).toBe('SUMMARY');
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[1]).toEqual([]);
  });

  it('records the summarize call cost to the ledger port', async () => {
    const recordCost = vi.fn();
    const s = makeSummarizer({ complete: completeReturning('x'), recordCost });
    await s.summarize({ markdown: 'm', prompt: 'p' });
    expect(recordCost).toHaveBeenCalledWith({ tokensIn: 10, tokensOut: 5, costUsd: 0.001 });
  });
});
