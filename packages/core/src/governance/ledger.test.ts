import { describe, expect, it } from 'vitest';
import { Ledger, redactLedgerEvent } from './ledger.js';

describe('redactLedgerEvent (D135 — strict allow-list, not a deny-list)', () => {
  it('keeps the allow-listed numeric / cost / cache / rule / scope fields', () => {
    const record = redactLedgerEvent({
      tokensIn: 1200,
      tokensOut: 340,
      costUsd: 0.04,
      cacheHit: true,
      ruleId: 'tsc/2304',
      scope: '@payments',
      nodeId: 'charge.ts#chargeCard',
    });
    expect(record).toEqual({
      tokensIn: 1200,
      tokensOut: 340,
      costUsd: 0.04,
      cacheHit: true,
      ruleId: 'tsc/2304',
      scope: '@payments',
      nodeId: 'charge.ts#chargeCard',
    });
  });

  it('drops prose-bearing fields by schema (raw contents / messages / prompt text)', () => {
    const record = redactLedgerEvent({
      tokensIn: 10,
      fileContents: 'const secret = ...',
      message: 'missing symbol chargeCard',
      prompt: 'the user said ...',
      response: 'the model replied ...',
    });
    expect(record).toEqual({ tokensIn: 10 });
  });

  it('drops an absolute-path node id (node-IDs must be anonymized/relative)', () => {
    expect(redactLedgerEvent({ nodeId: 'C:\\Users\\me\\charge.ts' })).toEqual({});
    expect(redactLedgerEvent({ nodeId: '/home/me/charge.ts' })).toEqual({});
  });

  it('drops a full/absolute path on any field', () => {
    expect(redactLedgerEvent({ scope: '/abs/path/payments' })).toEqual({});
  });

  it('drops a field present with the wrong type', () => {
    expect(redactLedgerEvent({ tokensIn: 'lots' })).toEqual({});
  });
});

describe('Ledger.record (the local-only, secret-clean audit projection)', () => {
  it('appends only the redacted projection — never a forbidden field', () => {
    const ledger = new Ledger();
    ledger.record({ tokensIn: 50, costUsd: 0.01, message: 'do not persist me' });
    expect(ledger.entries()).toEqual([{ tokensIn: 50, costUsd: 0.01 }]);
  });

  it('does not append an event that reduces to nothing after redaction', () => {
    const ledger = new Ledger();
    ledger.record({ message: 'prose only' });
    expect(ledger.entries()).toEqual([]);
  });
});
