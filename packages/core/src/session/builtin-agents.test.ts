import { describe, expect, it } from 'vitest';
import { agentSummarySchema } from '@coa/shared';
import { BUILTIN_AGENTS } from './builtin-agents.js';
import { STARTER_ROLES } from './agent-registry.js';

describe('BUILTIN_AGENTS', () => {
  it('ships a general-purpose worker and a read-only explorer', () => {
    expect(BUILTIN_AGENTS.map((a) => a.ref).sort()).toEqual(['explorer', 'general-purpose']);
  });

  it('are all valid summaries in the builtin scope', () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(agentSummarySchema.safeParse(agent).success).toBe(true);
      expect(agent.scope).toBe('builtin');
    }
  });

  it('every named role exists in the starter registry', () => {
    const known = new Set(STARTER_ROLES.map((r) => r.id));
    for (const agent of BUILTIN_AGENTS) {
      for (const role of agent.roles ?? []) expect(known.has(role)).toBe(true);
    }
  });

  it('the explorer names no editing role', () => {
    const explorer = BUILTIN_AGENTS.find((a) => a.ref === 'explorer');
    expect(explorer?.roles).toEqual(['researcher']);
  });
});
