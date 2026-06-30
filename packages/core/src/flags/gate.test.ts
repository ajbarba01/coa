import { describe, expect, it } from 'vitest';
import type { FlagRecord } from '@coa/shared';
import { FlagPipeline } from './pipeline.js';

function flag(over: Partial<FlagRecord> = {}): FlagRecord {
  return {
    ruleId: 'tsc/2304',
    location: 'charge.ts:42',
    severity: 'high',
    message: 'Cannot find name X',
    fingerprint: 'fp-1',
    type: 1,
    confidence: 'high',
    concernKey: 'chargeTs42',
    ...over,
  };
}

describe('FlagPipeline.gate (the close-gate — the one legitimate block)', () => {
  it('allows close when there are no flags', () => {
    expect(new FlagPipeline().gate()).toEqual({ allow: true });
  });

  it('blocks close on an unresolved Type-1 high-severity flag', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag());
    const result = pipe.gate();
    expect(result.allow).toBe(false);
    if (!result.allow) expect(result.message).toContain('charge.ts:42');
  });

  it('never blocks on a Type-2 flag, however severe or confident', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag({ type: 2, severity: 'crit', confidence: 'high' }));
    expect(pipe.gate()).toEqual({ allow: true });
  });

  it('does not block on a Type-1 low/med-severity flag', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag({ severity: 'med' }));
    expect(pipe.gate()).toEqual({ allow: true });
  });

  it('allows close once the blocking flag is resolved', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag());
    pipe.resolve('fp-1');
    expect(pipe.gate()).toEqual({ allow: true });
  });

  it('a baselined pre-existing violation does not block but stays visible to the user (D17)', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag());
    pipe.baseline('fp-1');
    expect(pipe.gate()).toEqual({ allow: true });
    expect(pipe.flagsForUser().expanded).toHaveLength(1);
  });

  it('keeps a baselined flag out of the agent injection', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag());
    pipe.baseline('fp-1');
    expect(pipe.flagsForAgent().groups).toHaveLength(0);
  });
});
