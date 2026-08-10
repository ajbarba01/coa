import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from './discovery.js';

/** A synthetic home+project tree shaped exactly like the real conventions. */
function fixtureTree(): { home: string; projectRoot: string } {
  const base = mkdtempSync(join(tmpdir(), 'coa-library-'));
  const home = join(base, 'home');
  const projectRoot = join(base, 'project');

  const writeSkill = (dir: string, name: string, text: string): void => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), text);
  };

  writeSkill(
    join(home, '.claude', 'skills'),
    'commits',
    '---\nname: commits\ndescription: commit conventions\n---\nbody',
  );
  writeSkill(join(home, '.claude', 'skills'), 'broken', 'no front matter here');
  writeSkill(
    join(home, '.codex', 'skills'),
    'brainstorming',
    '---\ndescription: design first\n---\nbody',
  );
  writeSkill(
    join(projectRoot, '.claude', 'skills'),
    'writing-in-voice',
    '---\nname: writing-in-voice\ndescription: voice profile\n---\nbody',
  );
  // A bare directory without a SKILL.md is not a skill and not a diagnostic.
  mkdirSync(join(home, '.claude', 'skills', 'not-a-skill'), { recursive: true });

  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        github: { command: 'npx', args: ['gh'] },
        shared: { command: 'user-version' },
      },
      projects: {
        [projectRoot]: { mcpServers: { localonly: { type: 'http', url: 'https://l' } } },
      },
    }),
  );
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(
    join(projectRoot, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        shared: { command: 'project-version' },
        bad: { type: 'http' },
      },
    }),
  );

  return { home, projectRoot };
}

describe('scanLibrary', () => {
  it('finds skills across the claude-user, claude-project, and codex-user roots', () => {
    const scan = scanLibrary(fixtureTree());
    expect(scan.skills.map((s) => `${s.origin}:${s.name}`)).toEqual([
      'claude-user:commits',
      'claude-project:writing-in-voice',
      'codex-user:brainstorming',
    ]);
  });

  it('takes a nameless skill name from its directory', () => {
    const scan = scanLibrary(fixtureTree());
    const codex = scan.skills.find((s) => s.origin === 'codex-user');
    expect(codex?.name).toBe('brainstorming');
    expect(codex?.description).toBe('design first');
  });

  it('reports an unparseable SKILL.md as a diagnostic and keeps scanning', () => {
    const scan = scanLibrary(fixtureTree());
    const broken = scan.diagnostics.find((d) => d.path.includes('broken'));
    expect(broken?.problem).toBe('invalid');
    expect(scan.skills.length).toBe(3);
  });

  it('reads the three MCP layers and marks project-shadowed names instead of dropping them', () => {
    const { home, projectRoot } = fixtureTree();
    const scan = scanLibrary({ home, projectRoot });
    const byName = new Map(scan.mcpServers.map((s) => [`${s.layer}:${s.name}`, s]));

    expect(byName.get('claude-local:localonly')?.config.transport).toBe('http');
    expect(byName.get('project-mcp:shared')?.shadowedBy).toBeUndefined();
    // The user-layer "shared" is shadowed by the project layer (local > project > user).
    expect(byName.get('claude-user:shared')?.shadowedBy).toBe('project-mcp');
    expect(byName.get('claude-user:github')?.shadowedBy).toBeUndefined();
  });

  it('surfaces an invalid server entry as a diagnostic', () => {
    const scan = scanLibrary(fixtureTree());
    const bad = scan.diagnostics.find((d) => d.kind === 'mcp' && d.name === 'bad');
    expect(bad?.problem).toBe('invalid');
  });

  it('is the empty floor on a machine with none of the locations', () => {
    const base = mkdtempSync(join(tmpdir(), 'coa-library-empty-'));
    const scan = scanLibrary({ home: join(base, 'h'), projectRoot: join(base, 'p') });
    expect(scan.skills).toEqual([]);
    expect(scan.mcpServers).toEqual([]);
    expect(scan.diagnostics).toEqual([]);
  });
});
