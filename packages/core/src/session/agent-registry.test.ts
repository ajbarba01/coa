import { packageSummarySchema, pieceSchema, roleSummarySchema } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import {
  STARTER_PACKAGES,
  STARTER_ROLES,
  packageSummaries,
  roleSummaries,
  toPackageSummary,
  toRoleSummary,
} from './agent-registry.js';

describe('agent-registry summaries — the picker projections', () => {
  it('projects a role to its summary, dropping the prompt Pieces', () => {
    const summary = toRoleSummary({
      id: 'swe',
      name: 'SWE',
      description: 'writes code',
      packageIds: ['coding', 'planning'],
      pieces: [{ name: 'p', description: 'd', body: 'b', axes: { delivery: 'push', salience: 'never', provenance: 'authored' } }],
    });

    expect(summary).toEqual({
      id: 'swe',
      name: 'SWE',
      description: 'writes code',
      packageIds: ['coding', 'planning'],
    });
    expect('pieces' in summary).toBe(false);
  });

  it('projects a package to its summary, keeping inclusion/advise/toolRefs and dropping Pieces', () => {
    const summary = toPackageSummary({
      id: 'core',
      name: 'Core',
      description: 'floor',
      inclusion: 'default',
      advise: true,
      pieces: [{ name: 'p', description: 'd', body: 'b', axes: { delivery: 'push', salience: 'never', provenance: 'authored' } }],
      toolRefs: ['Read', 'Grep'],
    });

    expect(summary).toEqual({
      id: 'core',
      name: 'Core',
      description: 'floor',
      inclusion: 'default',
      advise: true,
      toolRefs: ['Read', 'Grep'],
    });
    expect('pieces' in summary).toBe(false);
  });

  it('omits absent advise/mcpServers rather than emitting undefined', () => {
    const summary = toPackageSummary({
      id: 'coding',
      name: 'Coding',
      description: 'edits',
      inclusion: 'opt-in',
      pieces: [],
      toolRefs: ['Edit'],
    });

    expect('advise' in summary).toBe(false);
    expect('mcpServers' in summary).toBe(false);
  });

  it('summarizes the whole starter registry into wire-valid shapes', () => {
    const roles = roleSummaries();
    const packages = packageSummaries();

    expect(roles).toHaveLength(STARTER_ROLES.length);
    expect(packages).toHaveLength(STARTER_PACKAGES.length);
    for (const r of roles) expect(roleSummarySchema.parse(r)).toEqual(r);
    for (const p of packages) expect(packageSummarySchema.parse(p)).toEqual(p);
  });

  it('gives every starter role its own prose section so a role shapes conduct', () => {
    expect(STARTER_ROLES.length).toBeGreaterThan(0);
    for (const role of STARTER_ROLES) {
      expect(role.pieces?.length ?? 0).toBeGreaterThan(0);
      for (const piece of role.pieces ?? []) {
        expect(pieceSchema.safeParse(piece).success).toBe(true);
        expect(piece.axes.delivery).toBe('push');
      }
    }
  });
});
