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

function allPieces(): { name: string; slot: unknown }[] {
  const fromPackages = STARTER_PACKAGES.flatMap((pkg) => pkg.pieces ?? []);
  const fromRoles = STARTER_ROLES.flatMap((role) => role.pieces ?? []);
  return [...fromPackages, ...fromRoles];
}

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

  it('slots every starter role piece into the roles section', () => {
    for (const role of STARTER_ROLES) {
      for (const piece of role.pieces ?? []) expect(piece.slot).toBe('roles');
    }
  });

  it('assigns a DC-6 slot to every starter package piece — no dangling pieces', () => {
    for (const piece of allPieces()) expect(piece.slot).toBeDefined();
  });

  it('gives pkg-coding sole ownership of code-editing conduct', () => {
    const pkgCoding = STARTER_PACKAGES.find((pkg) => pkg.id === 'coding');
    const piece = pkgCoding?.pieces?.find((p) => p.name === 'pkg-coding');
    expect(piece?.slot).toBe('code-discipline');
    expect(piece?.body).toMatch(/edit_symbol/);
    expect(piece?.body).toMatch(/apply_patch/);
  });

  it('keeps role-swe scope-only — no code-editing conduct duplicated from pkg-coding', () => {
    const swe = STARTER_ROLES.find((role) => role.id === 'swe');
    const piece = swe?.pieces?.find((p) => p.name === 'role-swe');
    expect(piece?.slot).toBe('roles');
    expect(piece?.body).not.toMatch(/edit_symbol|apply_patch|smallest correct change/);
  });

  it('keeps role-researcher scope-only — no research how-to duplicated from pkg-research', () => {
    const researcher = STARTER_ROLES.find((role) => role.id === 'researcher');
    const piece = researcher?.pieces?.find((p) => p.name === 'role-researcher');
    expect(piece?.slot).toBe('roles');
    expect(piece?.body).not.toMatch(/Gather evidence|codebase graph/);
  });

  it('places coa-orientation in the governance slot', () => {
    const orientation = STARTER_PACKAGES.find((pkg) => pkg.id === 'coa-orientation');
    const piece = orientation?.pieces?.find((p) => p.name === 'coa-orientation');
    expect(piece?.slot).toBe('governance');
  });
});
