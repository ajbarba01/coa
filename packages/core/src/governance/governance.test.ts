import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChangeKernel } from '../kernel.js';
import { Governance } from './governance.js';

let dir: string;
let walPath: string;
let kernel: ChangeKernel;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coa-gov-facade-'));
  walPath = join(dir, 'log.ndjson');
  kernel = new ChangeKernel({ walPath, worktree: 'main' });
});
afterEach(() => {
  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Governance (the composed M7 surface)', () => {
  it('exposes the cost cap as a default pass-through and meters when charged', () => {
    const gov = new Governance(kernel);
    gov.charge('s1', 5);
    expect(gov.capState()).toEqual({ remaining: null, capHit: false });
  });

  it('records only the secret-clean projection of an event', () => {
    const gov = new Governance(kernel);
    gov.record({ tokensIn: 40, costUsd: 0.02, message: 'never persist me' });
    expect(gov.ledgerEntries()).toEqual([{ tokensIn: 40, costUsd: 0.02 }]);
  });

  it('routes the decision log and the visibility floor through the spine', () => {
    const gov = new Governance(kernel);
    const id = gov.decisionLog.append('rule:x', 'why');
    expect(gov.decisionLog.read(id)?.entry).toBe('why');
    gov.surfaceSubtractiveChange('scope:@api', 'weakened');
    expect(gov.subtractiveFeed()).toHaveLength(1);
  });

  it('returns the per-session sandbox set and gates self-mod promotions', () => {
    const gov = new Governance(kernel, { allowedTools: ['get_symbol'] });
    const set = gov.sandboxPolicy({ sessionId: 's1', trust: 'local', worktree: '/w' });
    expect(set.allowedTools).toEqual(['get_symbol']);
    expect(set.denyRead).toContain('~/.claude/**');
    expect(gov.selfModGuard({ rule: 'r', becomesSoleBlocker: true }, { passed: true })).toBe(
      'needsPinnedSpine',
    );
  });

  it('refuses a non-human vouch', () => {
    const gov = new Governance(kernel);
    expect(() => gov.vouch('charge.ts', 'abc', { human: false })).toThrow();
  });
});
