import { describe, expect, it } from 'vitest';
import { Governance } from './governance.js';

describe('Governance (the composed governance surface)', () => {
  it('exposes the cost cap as a default pass-through and meters when charged', () => {
    const gov = new Governance();
    gov.charge('s1', 5);
    expect(gov.capState()).toEqual({ remaining: null, capHit: false });
  });

  it('records only the secret-clean projection of an event', () => {
    const gov = new Governance();
    gov.record({ tokensIn: 40, costUsd: 0.02, message: 'never persist me' });
    expect(gov.ledgerEntries()).toEqual([{ tokensIn: 40, costUsd: 0.02 }]);
  });

  it('returns the per-session sandbox set', () => {
    const gov = new Governance({ allowedTools: ['get_symbol'] });
    const set = gov.sandboxPolicy({ sessionId: 's1', trust: 'local', worktree: '/w' });
    expect(set.allowedTools).toEqual(['get_symbol']);
    expect(set.denyRead).toContain('~/.claude/**');
  });
});
