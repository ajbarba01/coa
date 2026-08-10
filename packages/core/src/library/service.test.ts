import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LibraryService } from './service.js';
import { copiedSkillPath, libraryStoreDir } from './store.js';

/** A fresh synthetic home+project pair per test — never the real home. */
function fixture(): { home: string; projectRoot: string; service: LibraryService } {
  const base = mkdtempSync(join(tmpdir(), 'coa-libsvc-'));
  const home = join(base, 'home');
  const projectRoot = join(base, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  return { home, projectRoot, service: new LibraryService({ home, projectRoot }) };
}

function writeSkill(dir: string, name: string, description = 'a skill'): string {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const path = join(skillDir, 'SKILL.md');
  writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\n---\nbody of ${name}\n`);
  return path;
}

function writeMcpJson(projectRoot: string, servers: Record<string, unknown>): string {
  const path = join(projectRoot, '.mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: servers }));
  return path;
}

describe('LibraryService.link', () => {
  it('links a discovered skill as a live reference; reads reflect later edits', () => {
    const { home, service } = fixture();
    const path = writeSkill(join(home, '.claude', 'skills'), 'commits', 'v1');
    const summary = service.link({ kind: 'skill', scope: 'personal', source: { path } });
    expect(summary.record).toMatchObject({ name: 'commits', mode: 'reference', enabled: true });

    writeFileSync(path, '---\nname: commits\ndescription: v2\n---\nnew body\n');
    const entry = service
      .list()
      .entries.find((e) => e.record.name === 'commits' && e.scope === 'personal');
    expect(entry?.status).toBe('ok');
    expect(entry?.skill?.description).toBe('v2'); // live — never a stale copy
  });

  it('refuses to link a missing source', () => {
    const { home, service } = fixture();
    expect(() =>
      service.link({
        kind: 'skill',
        scope: 'personal',
        source: { path: join(home, 'nope', 'SKILL.md') },
      }),
    ).toThrow(/not readable/);
  });

  it('refuses a duplicate (kind, name) in the same scope', () => {
    const { home, service } = fixture();
    const path = writeSkill(join(home, '.claude', 'skills'), 'commits');
    service.link({ kind: 'skill', scope: 'personal', source: { path } });
    expect(() => service.link({ kind: 'skill', scope: 'personal', source: { path } })).toThrow(
      /already exists/,
    );
  });

  it('links an mcp server by config path + server name, resolving local over user layers', () => {
    const { projectRoot, service } = fixture();
    const configPath = writeMcpJson(projectRoot, { gh: { command: 'npx', args: ['gh'] } });
    const summary = service.link({
      kind: 'mcp',
      scope: 'project',
      source: { path: configPath, serverName: 'gh' },
    });
    expect(summary.record.name).toBe('gh');
    const entry = service.list().entries.find((e) => e.record.kind === 'mcp');
    expect(entry?.mcp).toMatchObject({ transport: 'stdio', command: 'npx' });
  });

  it('surfaces a reference whose source later vanished — kept, flagged, diagnosed', () => {
    const { home, service } = fixture();
    const path = writeSkill(join(home, '.claude', 'skills'), 'gone');
    service.link({ kind: 'skill', scope: 'personal', source: { path } });
    rmSync(join(home, '.claude', 'skills', 'gone'), { recursive: true });

    const view = service.list();
    const entry = view.entries.find((e) => e.record.name === 'gone');
    expect(entry?.status).toBe('source-missing');
    expect(view.diagnostics.some((d) => d.problem === 'missing-source' && d.name === 'gone')).toBe(
      true,
    );
  });
});

describe('LibraryService.copy', () => {
  it('materializes a skill into the project store with provenance', () => {
    const { home, projectRoot, service } = fixture();
    const sourcePath = writeSkill(join(home, '.claude', 'skills'), 'commits');
    const summary = service.copy({ kind: 'skill', source: { path: sourcePath } });

    expect(summary.scope).toBe('project');
    expect(summary.record.mode).toBe('copy');
    expect(summary.record.provenance?.sourcePath).toBe(sourcePath);

    const materialized = copiedSkillPath(libraryStoreDir(home, projectRoot, 'project'), 'commits');
    expect(readFileSync(materialized, 'utf8')).toBe(readFileSync(sourcePath, 'utf8'));
  });

  it('shows drift after the source changes, and re-copy re-syncs', () => {
    const { home, service } = fixture();
    const sourcePath = writeSkill(join(home, '.claude', 'skills'), 'commits', 'v1');
    service.copy({ kind: 'skill', source: { path: sourcePath } });

    const before = service.list().entries.find((e) => e.record.name === 'commits');
    expect(before?.drift).toBe('in-sync');

    writeFileSync(sourcePath, '---\nname: commits\ndescription: v2\n---\nchanged\n');
    const drifted = service.list().entries.find((e) => e.record.name === 'commits');
    expect(drifted?.drift).toBe('drifted');
    expect(drifted?.skill?.description).toBe('v1'); // the copy renders the copy, not the source

    service.copy({ kind: 'skill', source: { path: sourcePath } }); // one-click re-sync = re-copy
    const resynced = service.list().entries.find((e) => e.record.name === 'commits');
    expect(resynced?.drift).toBe('in-sync');
    expect(resynced?.skill?.description).toBe('v2');
  });

  it('reports a copied entry whose source is gone as source-missing drift, still rendering', () => {
    const { home, service } = fixture();
    const sourcePath = writeSkill(join(home, '.claude', 'skills'), 'commits');
    service.copy({ kind: 'skill', source: { path: sourcePath } });
    rmSync(join(home, '.claude', 'skills', 'commits'), { recursive: true });

    const entry = service.list().entries.find((e) => e.record.name === 'commits');
    expect(entry?.status).toBe('ok'); // the store is the source of truth for a copy
    expect(entry?.drift).toBe('source-missing');
  });

  it('copies an mcp server by embedding its config; config-only churn in the file is not drift', () => {
    const { projectRoot, service } = fixture();
    const configPath = writeMcpJson(projectRoot, { gh: { command: 'npx', env: { A: '1' } } });
    service.copy({ kind: 'mcp', source: { path: configPath, serverName: 'gh' } });

    // Reformat + reorder keys: content-identical, must stay in-sync.
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { gh: { env: { A: '1' }, command: 'npx' } } }, null, 2),
    );
    expect(service.list().entries.find((e) => e.record.kind === 'mcp')?.drift).toBe('in-sync');

    writeMcpJson(projectRoot, { gh: { command: 'npx', env: { A: '2' } } });
    const drifted = service.list().entries.find((e) => e.record.kind === 'mcp');
    expect(drifted?.drift).toBe('drifted');
    expect(drifted?.mcp).toMatchObject({ env: { A: '1' } }); // renders the store's copy
  });

  it('keeps the enabled choice across a re-sync', () => {
    const { home, service } = fixture();
    const sourcePath = writeSkill(join(home, '.claude', 'skills'), 'commits');
    service.copy({ kind: 'skill', source: { path: sourcePath } });
    service.setEnabled({ kind: 'skill', scope: 'project', name: 'commits' }, false);
    service.copy({ kind: 'skill', source: { path: sourcePath } });
    const entry = service.list().entries.find((e) => e.record.name === 'commits');
    expect(entry?.record.enabled).toBe(false);
  });
});

describe('LibraryService.unlink / setEnabled', () => {
  it('unlinks a record and removes a skill copy’s materialized directory', () => {
    const { home, projectRoot, service } = fixture();
    const sourcePath = writeSkill(join(home, '.claude', 'skills'), 'commits');
    service.copy({ kind: 'skill', source: { path: sourcePath } });
    const materialized = copiedSkillPath(libraryStoreDir(home, projectRoot, 'project'), 'commits');
    expect(existsSync(materialized)).toBe(true);

    expect(service.unlink({ kind: 'skill', scope: 'project', name: 'commits' })).toBe(true);
    expect(existsSync(materialized)).toBe(false);
    expect(service.unlink({ kind: 'skill', scope: 'project', name: 'commits' })).toBe(false);
  });

  it('never removes a directory outside the store for a crafted traversal record name', () => {
    const { home, projectRoot, service } = fixture();
    // A directory OUTSIDE the store that a traversal name would reach:
    // join(storeDir, 'skills', '../../../victim') === join(projectRoot, 'victim').
    const victimDir = join(projectRoot, 'victim');
    mkdirSync(victimDir, { recursive: true });
    writeFileSync(join(victimDir, 'precious.txt'), 'do not delete');

    // Hand-write the project store the way a hostile repo clone would carry it.
    const storeDir = libraryStoreDir(home, projectRoot, 'project');
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(
      join(storeDir, 'library.json'),
      JSON.stringify({
        version: 1,
        records: [
          {
            name: '../../../victim',
            kind: 'skill',
            mode: 'copy',
            enabled: true,
            source: { path: join(projectRoot, 'victim', 'SKILL.md') },
            provenance: { sourcePath: join(projectRoot, 'victim', 'SKILL.md'), contentHash: 'x' },
          },
        ],
      }),
    );

    // The crafted record must never load as a live entry (only a diagnostic)…
    const view = service.list();
    expect(view.entries).toEqual([]);
    expect(view.diagnostics.some((d) => d.problem === 'invalid')).toBe(true);
    // …so unlink finds nothing, and the victim directory survives untouched.
    expect(service.unlink({ kind: 'skill', scope: 'project', name: '../../../victim' })).toBe(
      false,
    );
    expect(existsSync(join(victimDir, 'precious.txt'))).toBe(true);
  });

  it('setEnabled flips the flag and throws for an unknown entry', () => {
    const { home, service } = fixture();
    const path = writeSkill(join(home, '.claude', 'skills'), 'commits');
    service.link({ kind: 'skill', scope: 'personal', source: { path } });
    const summary = service.setEnabled(
      { kind: 'skill', scope: 'personal', name: 'commits' },
      false,
    );
    expect(summary.record.enabled).toBe(false);
    expect(() =>
      service.setEnabled({ kind: 'skill', scope: 'personal', name: 'ghost' }, true),
    ).toThrow(/no skill entry/);
  });
});

describe('LibraryService × duplicate ~/.claude.json project keys', () => {
  it('resolves a server recorded under a LATER samePath-equal project key (Claude Code writes case-variant duplicates)', () => {
    const { home, projectRoot, service } = fixture();
    const configPath = join(home, '.claude.json');
    // Two distinct JSON keys naming the same root — the real file on a Windows
    // machine carries case-variant duplicates; a trailing separator is the
    // portable equivalent (samePath-equal on every platform).
    writeFileSync(
      configPath,
      JSON.stringify({
        projects: {
          [projectRoot]: { mcpServers: {} },
          [`${projectRoot}${sep}`]: { mcpServers: { gh: { command: 'npx' } } },
        },
      }),
    );
    const summary = service.link({
      kind: 'mcp',
      scope: 'project',
      source: { path: configPath, serverName: 'gh' },
    });
    expect(summary.record.name).toBe('gh');
    const entry = service.list().entries.find((e) => e.record.kind === 'mcp');
    expect(entry?.status).toBe('ok');
    expect(entry?.mcp).toMatchObject({ transport: 'stdio', command: 'npx' });
  });
});

describe('LibraryService.list discovery', () => {
  it('shows unlinked sources as discovered and removes them once linked or copied', () => {
    const { home, projectRoot, service } = fixture();
    const skillPath = writeSkill(join(home, '.claude', 'skills'), 'commits');
    const configPath = writeMcpJson(projectRoot, { gh: { command: 'npx' } });

    const before = service.list();
    expect(before.discovered.skills.map((s) => s.name)).toEqual(['commits']);
    expect(before.discovered.mcpServers.map((s) => s.name)).toEqual(['gh']);

    service.link({ kind: 'skill', scope: 'personal', source: { path: skillPath } });
    service.copy({ kind: 'mcp', source: { path: configPath, serverName: 'gh' } });

    const after = service.list();
    expect(after.discovered.skills).toEqual([]);
    expect(after.discovered.mcpServers).toEqual([]);
    expect(after.entries).toHaveLength(2);
  });
});
