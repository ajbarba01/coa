import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
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

  it('follows a symlinked/junction skill directory — how skill managers install skills', () => {
    const base = mkdtempSync(join(tmpdir(), 'coa-library-link-'));
    const home = join(base, 'home');
    const projectRoot = join(base, 'project');
    mkdirSync(projectRoot, { recursive: true });

    // The skill's real files live OUTSIDE the skills root; the root holds only a link.
    const target = join(base, 'elsewhere', 'linked-skill');
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, 'SKILL.md'),
      '---\nname: linked-skill\ndescription: installed via link\n---\nbody',
    );
    const skillsRoot = join(home, '.claude', 'skills');
    mkdirSync(skillsRoot, { recursive: true });
    // 'junction' works unprivileged on Windows and degrades to a plain symlink elsewhere.
    symlinkSync(target, join(skillsRoot, 'linked-skill'), 'junction');
    // A dangling link is not a skill directory — skipped, never a throw.
    symlinkSync(join(base, 'gone'), join(skillsRoot, 'dangling'), 'junction');

    const scan = scanLibrary({ home, projectRoot });
    expect(scan.skills.map((s) => s.name)).toEqual(['linked-skill']);
    expect(scan.diagnostics).toEqual([]);
  });

  it('merges samePath-equal duplicate project keys in ~/.claude.json, surfacing name collisions as shadowed', () => {
    const base = mkdtempSync(join(tmpdir(), 'coa-library-dupkey-'));
    const home = join(base, 'home');
    const projectRoot = join(base, 'project');
    mkdirSync(home, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    // Two distinct JSON keys naming the same root (the real file carries
    // case-variant duplicates; a trailing separator is the portable analogue).
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        projects: {
          [projectRoot]: { mcpServers: { both: { command: 'first' } } },
          [`${projectRoot}${sep}`]: {
            mcpServers: { both: { command: 'second' }, onlyhere: { command: 'o' } },
          },
        },
      }),
    );

    const scan = scanLibrary({ home, projectRoot });
    const locals = scan.mcpServers.filter((s) => s.layer === 'claude-local');
    // A server only the second key defines is discovered, never silently dropped…
    expect(locals.map((s) => s.name)).toEqual(['both', 'both', 'onlyhere']);
    // …and a name both keys claim keeps the first key's config, surfacing the loser.
    const [winner, loser] = locals;
    expect(winner?.config).toMatchObject({ transport: 'stdio', command: 'first' });
    expect(winner?.shadowedBy).toBeUndefined();
    expect(loser?.shadowedBy).toBe('claude-local');
  });

  it('is the empty floor on a machine with none of the locations', () => {
    const base = mkdtempSync(join(tmpdir(), 'coa-library-empty-'));
    const scan = scanLibrary({ home: join(base, 'h'), projectRoot: join(base, 'p') });
    expect(scan.skills).toEqual([]);
    expect(scan.mcpServers).toEqual([]);
    expect(scan.diagnostics).toEqual([]);
  });
});
