import { describe, expect, it } from 'vitest';
import { agentPackageSchema, roleSchema, type AgentPackage, type Role } from '@coa/shared';
import { assembleAgent, createRegistryAssemblePieces, CORE_PACKAGE_ID } from './assemble-agent.js';
import {
  STARTER_PACKAGES,
  STARTER_ROLES,
  packageRegistry,
  roleRegistry,
} from './agent-registry.js';
import type { BaselineContext } from './baseline-pieces.js';

const CTX: BaselineContext = {
  worktree: '/w',
  platform: 'linux',
  model: 'claude-opus-4-8',
  date: '2026-07-02',
};

const registry = packageRegistry();
const swe = roleRegistry().get('swe') as Role;
const emptyRole: Role = { id: 'x', name: 'x', description: '', packageIds: [] };

/** A tiny hand-rolled registry for the mechanics tests. */
function mini(...packages: AgentPackage[]): Map<string, AgentPackage> {
  return packageRegistry(packages);
}

describe('assembleAgent — inclusion', () => {
  it('includes default packages (core scaffold) for an empty role', () => {
    const { frame, pieces } = assembleAgent({ role: emptyRole }, registry, CTX);
    expect(frame.allow).toContain('get_symbol'); // core toolRefs
    expect(frame.allow).toContain('Read');
    expect(pieces.some((p) => p.name === 'baseline-identity')).toBe(true); // core pieces
  });

  it('excluding core degrades to the raw loop — no scaffold, no volatile tail (nothing mandatory)', () => {
    const { pieces } = assembleAgent({ role: emptyRole, exclude: ['core'] }, registry, CTX);
    expect(pieces.some((p) => p.name === 'baseline-identity')).toBe(false);
    expect(pieces.some((p) => p.name === 'baseline-model')).toBe(false);
    expect(pieces.some((p) => p.name === 'baseline-environment')).toBe(false);
  });

  it('turns on the role’s opt-in packages on top of the defaults', () => {
    const { frame } = assembleAgent({ role: swe }, registry, CTX);
    expect(frame.allow).toEqual(
      expect.arrayContaining(['edit_symbol', 'apply_patch', 'context_status']),
    );
    expect(frame.allow).toContain('get_symbol'); // still gets core
    expect(frame.allow.length).toBe(new Set(frame.allow).size); // deduped
  });

  it('collapses a tool referenced by two packages to a single grant', () => {
    const reg = mini(
      {
        id: CORE_PACKAGE_ID,
        name: 'c',
        description: '',
        inclusion: 'default',
        pieces: [],
        toolRefs: ['Read'],
      },
      {
        id: 'a',
        name: 'a',
        description: '',
        inclusion: 'opt-in',
        pieces: [],
        toolRefs: ['Bash', 'Read'],
      },
      { id: 'b', name: 'b', description: '', inclusion: 'opt-in', pieces: [], toolRefs: ['Bash'] },
    );
    const role: Role = { id: 'r', name: 'r', description: '', packageIds: ['a', 'b'] };
    const { frame } = assembleAgent({ role }, reg, CTX);
    expect(frame.allow.filter((t) => t === 'Bash')).toHaveLength(1);
    expect(frame.allow.filter((t) => t === 'Read')).toHaveLength(1);
  });

  it('skips unknown package ids instead of throwing', () => {
    const role: Role = { id: 'r', name: 'r', description: '', packageIds: ['nope', 'coding'] };
    const { frame } = assembleAgent({ role }, registry, CTX);
    expect(frame.allow).toContain('edit_symbol');
  });

  it('turns on user-added opt-in packages beyond the role’s', () => {
    const { frame } = assembleAgent({ role: emptyRole, packageIds: ['research'] }, registry, CTX);
    expect(frame.allow).toContain('WebSearch'); // research toolRef, not in the empty role
  });

  it('lets an exclusion override a user-added package (exclude wins)', () => {
    const { frame } = assembleAgent(
      { role: emptyRole, packageIds: ['research'], exclude: ['research'] },
      registry,
      CTX,
    );
    expect(frame.allow).not.toContain('WebSearch');
  });
});

describe('assembleAgent — pieces, mcps, advisories', () => {
  it('orders pieces: core/default pieces → package → role → skills → volatile tail', () => {
    const skill = {
      name: 'skill-x',
      description: 's',
      body: 'b',
      axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
    } as const;
    const role: Role = {
      id: 'swe2',
      name: 'swe2',
      description: '',
      packageIds: ['coding'],
      pieces: [{ ...skill, name: 'role-x' }],
    };
    const names = assembleAgent({ role, skills: [skill] }, registry, CTX).pieces.map((p) => p.name);

    expect(names[0]).toBe('baseline-identity'); // core pieces lead
    expect(names[names.length - 1]).toBe('baseline-environment'); // volatile last
    expect(names.indexOf('pkg-coding')).toBeGreaterThan(names.indexOf('baseline-code-quality'));
    expect(names.indexOf('role-x')).toBeGreaterThan(names.indexOf('pkg-coding'));
    expect(names.indexOf('skill-x')).toBeGreaterThan(names.indexOf('role-x'));
    expect(names.indexOf('skill-x')).toBeLessThan(names.indexOf('baseline-model'));
  });

  it('unions external MCP servers across included packages, deduped', () => {
    const reg = mini(
      {
        id: CORE_PACKAGE_ID,
        name: 'c',
        description: '',
        inclusion: 'default',
        pieces: [],
        toolRefs: [],
        mcpServers: ['fs'],
      },
      {
        id: 'a',
        name: 'a',
        description: '',
        inclusion: 'opt-in',
        pieces: [],
        toolRefs: [],
        mcpServers: ['fs', 'playwright'],
      },
    );
    const role: Role = { id: 'r', name: 'r', description: '', packageIds: ['a'] };
    const { mcpServers } = assembleAgent({ role }, reg, CTX);
    expect([...mcpServers].sort()).toEqual(['fs', 'playwright']);
  });

  it('reports an advised package that ends up absent, and stays quiet when it is present', () => {
    const absent = assembleAgent({ role: emptyRole, exclude: ['coa-orientation'] }, registry, CTX);
    expect(absent.advisories).toContain('coa-orientation');

    const present = assembleAgent({ role: emptyRole }, registry, CTX);
    expect(present.advisories).not.toContain('coa-orientation');
    expect(present.advisories).not.toContain('core');
  });
});

describe('createRegistryAssemblePieces (the live assemblePieces)', () => {
  const assemble = createRegistryAssemblePieces({
    roles: roleRegistry(),
    packages: packageRegistry(),
    platform: 'linux',
    now: () => new Date('2026-07-02T00:00:00Z'),
  });

  it('a known role restricts the frame to its packages’ tools', () => {
    const { frame, pieces } = assemble({ role: 'swe', scope: 'src', worktree: '/w', model: 'm' });
    expect(frame.allow).toEqual(expect.arrayContaining(['edit_symbol', 'Bash', 'get_symbol']));
    expect(pieces.some((p) => p.name === 'pkg-coding')).toBe(true);
    expect(pieces.some((p) => p.name === 'baseline-model')).toBe(true);
  });

  it('an unknown/unset role is the permissive floor: baseline scaffold, empty frame (all tools)', () => {
    const { frame, pieces } = assemble({ role: 'nope', scope: '', worktree: '/w' });
    expect(frame.allow).toEqual([]); // empty ⇒ D85 pass-through, no restriction
    expect(pieces.some((p) => p.name === 'baseline-identity')).toBe(true);
    expect(pieces.some((p) => p.name === 'pkg-coding')).toBe(false);
  });

  it('threads the assembly selection (added package + excluded default) into the frame', () => {
    const { frame } = assemble({
      role: 'swe',
      scope: 'src',
      worktree: '/w',
      packageIds: ['research'],
      exclude: ['core'],
    });
    expect(frame.allow).toContain('WebSearch'); // the added research package
    expect(frame.allow).not.toContain('get_symbol'); // core excluded ⇒ its tools gone
  });
});

describe('the starter registry', () => {
  it('is schema-valid (every package + role parses)', () => {
    for (const pkg of STARTER_PACKAGES)
      expect(agentPackageSchema.safeParse(pkg).success).toBe(true);
    for (const role of STARTER_ROLES) expect(roleSchema.safeParse(role).success).toBe(true);
  });

  it('roles reference only defined packages', () => {
    const ids = new Set(STARTER_PACKAGES.map((p) => p.id));
    for (const role of STARTER_ROLES) {
      for (const id of role.packageIds) expect(ids.has(id)).toBe(true);
    }
  });

  it('ships core + orientation as advised defaults and the rest as opt-in', () => {
    const byId = new Map(STARTER_PACKAGES.map((p) => [p.id, p]));
    expect(byId.get('core')?.inclusion).toBe('default');
    expect(byId.get('core')?.advise).toBe(true);
    expect(byId.get('coa-orientation')?.inclusion).toBe('default');
    expect(byId.get('coding')?.inclusion).toBe('opt-in');
    expect(byId.get('coa-butler')?.inclusion).toBe('opt-in');
  });
});
