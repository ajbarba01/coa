import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChangeKernel } from '../kernel.js';
import { GovernanceLog } from './governance-log.js';

let dir: string;
let walPath: string;
const kernels: ChangeKernel[] = [];
const open = (): ChangeKernel => {
  const k = new ChangeKernel({ walPath, worktree: 'main' });
  kernels.push(k);
  return k;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coa-gov-'));
  walPath = join(dir, 'log.ndjson');
  kernels.length = 0;
});
afterEach(() => {
  for (const k of kernels) k.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('GovernanceLog decision log (D73 — WAL-fed projection)', () => {
  it('appends a decision and reads it back by id and by target', () => {
    const log = new GovernanceLog(open());
    const id = log.decisionLog.append('rule:no-raw-sql', 'narrowed for builder false-positives');
    expect(log.decisionLog.read(id)?.entry).toBe('narrowed for builder false-positives');
    expect(log.decisionLog.findByTarget('rule:no-raw-sql')).toHaveLength(1);
  });

  it('returns every decision for a target in append order', () => {
    const log = new GovernanceLog(open());
    log.decisionLog.append('rule:x', 'first');
    log.decisionLog.append('rule:x', 'second');
    expect(log.decisionLog.findByTarget('rule:x').map((e) => e.entry)).toEqual(['first', 'second']);
  });

  it('reconstructs the decision log from the WAL after a restart', () => {
    const id = new GovernanceLog(open()).decisionLog.append('rule:x', 'why x');
    for (const k of kernels) k.close();
    kernels.length = 0;
    const reopened = new GovernanceLog(open());
    expect(reopened.decisionLog.read(id)?.entry).toBe('why x');
  });
});

describe('GovernanceLog vouch (D137 — human-only)', () => {
  it('records a human-issued vouch pinned to a commit', () => {
    const log = new GovernanceLog(open());
    log.vouch('charge.ts', 'abc123', { human: true });
    expect(log.vouchOf('charge.ts')?.vouchedAt).toBe('abc123');
  });

  it('refuses a vouch that is not human-issued (an agent may request, never grant)', () => {
    const log = new GovernanceLog(open());
    expect(() => log.vouch('charge.ts', 'abc123', { human: false })).toThrow();
  });
});

describe('GovernanceLog surfaceSubtractiveChange (D147 — visibility floor, never blocks)', () => {
  it('surfaces a subtractive change as a reviewable feed item without blocking', () => {
    const log = new GovernanceLog(open());
    expect(
      log.surfaceSubtractiveChange('scope:@api', 'added ignore region vendor/**'),
    ).toBeUndefined();
    expect(log.subtractiveFeed()).toHaveLength(1);
    expect(log.subtractiveFeed()[0]?.target).toBe('scope:@api');
  });

  it('reconstructs the subtractive feed from the WAL after a restart', () => {
    new GovernanceLog(open()).surfaceSubtractiveChange('scope:@api', 'weakened');
    for (const k of kernels) k.close();
    kernels.length = 0;
    expect(new GovernanceLog(open()).subtractiveFeed()).toHaveLength(1);
  });
});
