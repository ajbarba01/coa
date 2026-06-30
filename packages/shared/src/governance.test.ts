import { describe, expect, it } from 'vitest';
import { governancePayloadSchema } from './governance.js';

describe('governancePayloadSchema (the typed, prose-bearing bodies — DT-5)', () => {
  it('accepts a decision body keyed by target', () => {
    expect(
      governancePayloadSchema.parse({
        sub: 'decision',
        target: 'rule:no-raw-sql',
        entry: 'narrowed to exclude the query-builder — false-positiving on safe calls',
      }),
    ).toMatchObject({ sub: 'decision', target: 'rule:no-raw-sql' });
  });

  it('accepts a vouch body with a commit hash and an optional note', () => {
    expect(
      governancePayloadSchema.parse({ sub: 'vouch', node: 'charge.ts', vouchedAt: 'abc123' }),
    ).toMatchObject({ sub: 'vouch', vouchedAt: 'abc123' });
  });

  it('accepts a cap-record body of pure numerics', () => {
    expect(
      governancePayloadSchema.parse({
        sub: 'cap-record',
        tokensIn: 1200,
        tokensOut: 340,
        costUsd: 0.04,
      }),
    ).toMatchObject({ sub: 'cap-record', costUsd: 0.04 });
  });

  it('accepts a subtractive-change body with the weakened target and a diff', () => {
    expect(
      governancePayloadSchema.parse({
        sub: 'subtractive-change',
        target: 'scope:@api',
        diff: 'added ignore region for vendor/**',
      }),
    ).toMatchObject({ sub: 'subtractive-change', target: 'scope:@api' });
  });

  it('rejects a decision payload missing its prose entry', () => {
    expect(() => governancePayloadSchema.parse({ sub: 'decision', target: 'x' })).toThrow();
  });

  it('rejects an unknown sub', () => {
    expect(() => governancePayloadSchema.parse({ sub: 'mystery' })).toThrow();
  });
});
