import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRegistry, loadAgentScope, mergeAgentScopes } from './agent-defs.js';
import type { AgentSummary } from '@coa/shared';

function scopeDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'coa-agents-'));
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

/**
 * A synthetic `AgentScopeIO` backed by an in-memory filename→body map, keyed
 * exactly as given (no case-folding). Used where a test needs two entries that
 * differ only in case — real filesystems (NTFS, default APFS) fold case and
 * would collapse such a fixture before `loadAgentScope` ever saw it.
 */
function fakeIO(files: Record<string, string>): {
  readdirSync: () => string[];
  readFileSync: (path: string) => string;
} {
  return {
    readdirSync: () => Object.keys(files),
    readFileSync: (path) => {
      const name = basename(path);
      const body = files[name];
      if (body === undefined) throw new Error(`fakeIO: no fixture for ${path}`);
      return body;
    },
  };
}

describe('loadAgentScope', () => {
  it('is empty and silent when the directory does not exist', () => {
    const loaded = loadAgentScope(join(tmpdir(), 'coa-agents-absent-xyz'), 'project');
    expect(loaded.agents).toEqual([]);
    expect(loaded.diagnostics).toEqual([]);
  });

  it('takes the ref from the filename and the scope from the caller', () => {
    const dir = scopeDir({ 'reviewer.yaml': 'name: Reviewer\ndescription: reviews code\n' });
    const loaded = loadAgentScope(dir, 'project');
    expect(loaded.agents).toHaveLength(1);
    expect(loaded.agents[0]?.ref).toBe('reviewer');
    expect(loaded.agents[0]?.scope).toBe('project');
    expect(loaded.agents[0]?.description).toBe('reviews code');
  });

  it('reports an invalid file and keeps the valid ones', () => {
    const dir = scopeDir({
      'good.yaml': 'name: Good\ndescription: fine\n',
      'bad.yaml': 'name: Bad\n',
    });
    const loaded = loadAgentScope(dir, 'personal');
    expect(loaded.agents.map((a) => a.ref)).toEqual(['good']);
    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.diagnostics[0]?.problem).toBe('invalid');
    expect(loaded.diagnostics[0]?.ref).toBe('bad');
  });

  it('flags a ref field in the file rather than honouring it', () => {
    const dir = scopeDir({ 'real.yaml': 'ref: pretend\nname: Real\ndescription: fine\n' });
    const loaded = loadAgentScope(dir, 'project');
    expect(loaded.agents[0]?.ref).toBe('real');
    expect(loaded.diagnostics[0]?.problem).toBe('ref-in-file');
  });

  it('flags a case-folded duplicate instead of picking silently', () => {
    const loaded = loadAgentScope(
      '/fake/project',
      'project',
      fakeIO({
        'Worker.yaml': 'name: Upper\ndescription: one\n',
        'worker.yaml': 'name: Lower\ndescription: two\n',
      }),
    );
    expect(loaded.agents).toHaveLength(1);
    expect(loaded.diagnostics.some((d) => d.problem === 'duplicate-ref')).toBe(true);
  });

  it('ignores files that are not .yaml', () => {
    const dir = scopeDir({
      'notes.md': 'not an agent',
      'keeper.yaml': 'name: Keeper\ndescription: fine\n',
    });
    expect(loadAgentScope(dir, 'project').agents.map((a) => a.ref)).toEqual(['keeper']);
  });
});

function agent(ref: string, scope: AgentSummary['scope'], name: string): AgentSummary {
  return { ref, scope, name, description: `${name} description`, icon: 'bot', color: 'slate' };
}

describe('mergeAgentScopes', () => {
  it('unions the scopes', () => {
    const merged = mergeAgentScopes([
      { agents: [agent('builtin-one', 'builtin', 'B')], diagnostics: [] },
      { agents: [agent('personal-one', 'personal', 'P')], diagnostics: [] },
      { agents: [agent('project-one', 'project', 'R')], diagnostics: [] },
    ]);
    expect(merged.agents.map((a) => a.ref).sort()).toEqual([
      'builtin-one',
      'personal-one',
      'project-one',
    ]);
  });

  it('lets a later scope win a ref collision', () => {
    const merged = mergeAgentScopes([
      { agents: [agent('worker', 'builtin', 'Built in')], diagnostics: [] },
      { agents: [agent('worker', 'personal', 'Personal')], diagnostics: [] },
      { agents: [agent('worker', 'project', 'Project')], diagnostics: [] },
    ]);
    expect(merged.agents).toHaveLength(1);
    expect(merged.agents[0]?.name).toBe('Project');
    expect(merged.agents[0]?.scope).toBe('project');
  });

  it("carries every scope's diagnostics through", () => {
    const merged = mergeAgentScopes([
      { agents: [], diagnostics: [] },
      {
        agents: [],
        diagnostics: [
          { scope: 'personal', ref: 'x', path: '/x.yaml', problem: 'invalid', detail: 'boom' },
        ],
      },
    ]);
    expect(merged.diagnostics).toHaveLength(1);
  });

  it('returns a stable ref-sorted order', () => {
    const merged = mergeAgentScopes([
      { agents: [agent('zeta', 'builtin', 'Z'), agent('alpha', 'builtin', 'A')], diagnostics: [] },
    ]);
    expect(merged.agents.map((a) => a.ref)).toEqual(['alpha', 'zeta']);
  });
});

describe('AgentRegistry', () => {
  function registry(): { reg: AgentRegistry; home: string; root: string } {
    const home = mkdtempSync(join(tmpdir(), 'coa-home-'));
    const root = mkdtempSync(join(tmpdir(), 'coa-root-'));
    return { reg: new AgentRegistry(home, root), home, root };
  }

  it('lists the built-ins when nothing is on disk', () => {
    const { reg } = registry();
    expect(
      reg
        .list()
        .agents.map((a) => a.ref)
        .sort(),
    ).toEqual(['explorer', 'general-purpose']);
  });

  it('round-trips a saved personal agent', () => {
    const { reg } = registry();
    reg.save(
      'reviewer',
      { name: 'Reviewer', description: 'reviews code', icon: 'eye', color: 'teal' },
      'personal',
    );
    const found = reg.list().agents.find((a) => a.ref === 'reviewer');
    expect(found?.description).toBe('reviews code');
    expect(found?.scope).toBe('personal');
  });

  it('lets a project agent override a built-in ref', () => {
    const { reg } = registry();
    reg.save(
      'explorer',
      { name: 'Our explorer', description: 'ours', icon: 'bot', color: 'slate' },
      'project',
    );
    const found = reg.list().agents.find((a) => a.ref === 'explorer');
    expect(found?.name).toBe('Our explorer');
    expect(found?.scope).toBe('project');
  });

  it('removes an agent and reports whether anything was removed', () => {
    const { reg } = registry();
    reg.save(
      'temp',
      { name: 'Temp', description: 'temporary', icon: 'bot', color: 'slate' },
      'project',
    );
    expect(reg.remove('temp', 'project')).toBe(true);
    expect(reg.remove('temp', 'project')).toBe(false);
    expect(reg.list().agents.some((a) => a.ref === 'temp')).toBe(false);
  });

  it('refuses a ref that would escape its scope directory', () => {
    const { reg } = registry();
    expect(() =>
      reg.save(
        '../escape',
        { name: 'X', description: 'x', icon: 'bot', color: 'slate' },
        'project',
      ),
    ).toThrow();
  });
});
