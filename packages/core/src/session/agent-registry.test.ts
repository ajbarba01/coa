import { packageSummarySchema, pieceSchema, roleSummarySchema } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import { TOOL_CATALOGUE } from '../workbench/catalogue.js';
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
      pieces: [
        {
          name: 'p',
          description: 'd',
          body: 'b',
          axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
        },
      ],
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
      pieces: [
        {
          name: 'p',
          description: 'd',
          body: 'b',
          axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
        },
      ],
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

  it('grants the planning and research packages the web tools', () => {
    for (const id of ['planning', 'research']) {
      const pkg = STARTER_PACKAGES.find((p) => p.id === id);
      expect(pkg?.toolRefs).toContain('WebSearch');
      expect(pkg?.toolRefs).toContain('WebFetch');
    }
  });

  it('grants every catalogue tool through at least one starter package — none is dead on arrival', () => {
    // A frame's allow-list is the union of the resolved packages' toolRefs (assembleAgent.ts:91),
    // never the catalogue directly — registering a tool in TOOL_CATALOGUE does not make it
    // reachable by any agent. Partition (kernel/on-demand) is the D100 schema-budget axis, not
    // the availability axis, so this deliberately does not require kernel tools to sit in Core
    // specifically (edit_symbol/apply_patch are kernel yet correctly opt-in-only, via `coding` —
    // an edit-less role like `researcher` must not gain them). It only asserts that some starter
    // package grants each tool, catching a catalogue entry no agent configuration can ever reach
    // (the spawn_agent gap this test was added to catch). One-directional by design: a toolRef
    // with no catalogue entry (coa-butler's placeholder create_agent/configure_role/list_packages)
    // is the reverse case and is untouched here.
    const grantedNames = new Set(STARTER_PACKAGES.flatMap((pkg) => pkg.toolRefs));
    const catalogueNames = TOOL_CATALOGUE.map((tool) => tool.name);
    expect(catalogueNames.length).toBeGreaterThan(0);
    for (const name of catalogueNames) {
      expect(grantedNames.has(name)).toBe(true);
    }
  });
});
