// Archived from packages/core/src/context/grounding.test.ts
import { describe, expect, it } from 'vitest';
import type { SymbolRecord, ToolCall } from '@coa/shared';
import { ground, type SymbolOracle } from './grounding.js';

function call(ref?: ToolCall['ref']): ToolCall {
  return { tool: 'get_symbol', args: {}, sessionId: 's1', ...(ref ? { ref } : {}) };
}

function oracle(over: Partial<SymbolOracle> = {}): SymbolOracle {
  return {
    lookup: () => undefined,
    fuzzyMatch: () => [],
    walPosition: () => 0,
    ...over,
  };
}

const sym = (name: string, extra: Partial<SymbolRecord> = {}): SymbolRecord => ({
  name,
  definedIn: 'src/pay.ts',
  ...extra,
});

describe('ground — the L-GND existence tier', () => {
  it('returns no block when the named symbol exists (a hit)', () => {
    const found = oracle({ lookup: (name) => (name === 'capturePayment' ? sym(name) : undefined) });
    expect(ground(call({ name: 'capturePayment' }), found)).toBeUndefined();
  });

  it('returns no block when the call names no symbol', () => {
    expect(ground(call(), oracle())).toBeUndefined();
  });

  it('returns no block for a path ref that names no symbol within it', () => {
    expect(ground(call({ path: 'src/pay.ts' }), oracle())).toBeUndefined();
  });

  it('returns no block on a miss with no near match (fails toward proceed — a genuinely new name)', () => {
    expect(ground(call({ name: 'brandNewThing' }), oracle())).toBeUndefined();
  });

  it('appends a stale correction on a miss with a high-confidence near match', () => {
    const block = ground(
      call({ name: 'chargeCard' }),
      oracle({
        fuzzyMatch: () => [
          { symbol: sym('capturePayment'), confidence: 0.85, why: 'rename r-1187' },
        ],
      }),
    );
    expect(block?.status).toBe('stale');
    expect(block?.named).toBe('chargeCard');
    expect(block?.suggestions).toHaveLength(1);
    expect(block?.ifIntentional).toMatch(/proceed/i);
  });

  it('grades a low-confidence near match as weak', () => {
    const block = ground(
      call({ name: 'chrgCrd' }),
      oracle({
        fuzzyMatch: () => [
          { symbol: sym('capturePayment'), confidence: 0.4, why: 'edit distance 4' },
        ],
      }),
    );
    expect(block?.status).toBe('weak');
  });

  it('stamps the freshness position it checked against', () => {
    const block = ground(
      call({ name: 'chargeCard' }),
      oracle({
        walPosition: () => 42,
        fuzzyMatch: () => [
          { symbol: sym('capturePayment'), confidence: 0.85, why: 'rename r-1187' },
        ],
      }),
    );
    expect(block?.checkedAgainst).toBe('project-symbol-graph @ 42');
  });

  it('carries each candidate signature, definedIn, confidence and why into the suggestion', () => {
    const block = ground(
      call({ name: 'chargeCard' }),
      oracle({
        fuzzyMatch: () => [
          {
            symbol: sym('capturePayment', {
              signature: '(amount: Money)',
              definedIn: 'src/billing.ts',
            }),
            confidence: 0.8,
            why: 'rename r-1187',
          },
        ],
      }),
    );
    expect(block?.suggestions[0]).toEqual({
      symbol: 'capturePayment',
      signature: '(amount: Money)',
      definedIn: 'src/billing.ts',
      confidence: 0.8,
      why: 'rename r-1187',
    });
  });

  it('omits the signature field when the candidate has none', () => {
    const block = ground(
      call({ name: 'chargeCard' }),
      oracle({
        fuzzyMatch: () => [{ symbol: sym('capturePayment'), confidence: 0.8, why: 'near' }],
      }),
    );
    expect(block?.suggestions[0]).not.toHaveProperty('signature');
  });

  it('grounds the symbol named by a path+symbol ref', () => {
    const block = ground(
      call({ path: 'src/pay.ts', symbol: 'chargeCard' }),
      oracle({
        fuzzyMatch: () => [{ symbol: sym('capturePayment'), confidence: 0.8, why: 'near' }],
      }),
    );
    expect(block?.named).toBe('chargeCard');
  });
});
