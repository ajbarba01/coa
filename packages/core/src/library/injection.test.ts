import { describe, expect, it } from 'vitest';
import type { LibraryEntryView, LibraryView, Piece } from '@coa/shared';
import {
  createSessionLibraryPort,
  effectiveMcpServers,
  effectiveSkills,
  listInvocableSkills,
  resolveInvocation,
  resolveMcpServers,
  resolveSkillConfigs,
  SKILL_INDEX_PIECE_NAME,
} from './injection.js';

function skillEntry(
  name: string,
  scope: 'personal' | 'project',
  over: Partial<LibraryEntryView> = {},
): LibraryEntryView {
  return {
    record: {
      name,
      kind: 'skill',
      mode: 'reference',
      enabled: true,
      source: { path: `/src/${name}/SKILL.md` },
    },
    scope,
    status: 'ok',
    skill: { name, description: `${name} (${scope})`, body: `body of ${name} (${scope})` },
    ...over,
  };
}

function mcpEntry(
  name: string,
  scope: 'personal' | 'project',
  url: string,
  over: Partial<LibraryEntryView> = {},
): LibraryEntryView {
  return {
    record: {
      name,
      kind: 'mcp',
      mode: 'reference',
      enabled: true,
      source: { path: '/src/.mcp.json', serverName: name },
    },
    scope,
    status: 'ok',
    mcp: { transport: 'http', url },
    ...over,
  };
}

function view(entries: LibraryEntryView[]): LibraryView {
  return { entries, discovered: { skills: [], mcpServers: [] }, diagnostics: [] };
}

describe('effectiveSkills', () => {
  it('excludes disabled and unresolvable entries', () => {
    const v = view([
      skillEntry('on', 'personal'),
      skillEntry('off', 'personal', {
        record: {
          name: 'off',
          kind: 'skill',
          mode: 'reference',
          enabled: false,
          source: { path: '/src/off/SKILL.md' },
        },
      }),
      skillEntry('gone', 'personal', { status: 'source-missing', skill: undefined }),
    ]);
    expect(effectiveSkills(v).map((e) => e.name)).toEqual(['on']);
  });

  it('project shadows personal on a case-folded name collision', () => {
    const v = view([skillEntry('Commits', 'personal'), skillEntry('commits', 'project')]);
    const folded = effectiveSkills(v);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.scope).toBe('project');
    expect(folded[0]?.skill.body).toBe('body of commits (project)');
  });

  it('scope order in the view does not matter (project wins either way)', () => {
    const v = view([skillEntry('commits', 'project'), skillEntry('commits', 'personal')]);
    expect(effectiveSkills(v)[0]?.scope).toBe('project');
  });
});

describe('resolveSkillConfigs', () => {
  it('maps auto onto a push Piece carrying the body, keyed by the library name', () => {
    const v = view([skillEntry('commits', 'project')]);
    const { pieces, selection, missing } = resolveSkillConfigs(v, [
      { name: 'commits', delivery: 'auto' },
    ]);
    expect(missing).toEqual([]);
    expect(selection).toEqual([{ name: 'commits', delivery: 'auto' }]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({
      name: 'commits',
      body: 'body of commits (project)',
      axes: { delivery: 'push' },
    });
  });

  it('keys the Piece by the LIBRARY name even when the front-matter names itself differently', () => {
    const entry = skillEntry('commits', 'project');
    entry.skill = { name: 'totally-other', description: 'd', body: 'b' };
    const { pieces } = resolveSkillConfigs(view([entry]), [{ name: 'commits', delivery: 'auto' }]);
    expect(pieces[0]?.name).toBe('commits');
  });

  it('maps disclosure onto a pull Piece plus the one aggregated index advertisement', () => {
    const v = view([skillEntry('commits', 'project'), skillEntry('review', 'personal')]);
    const { pieces, selection } = resolveSkillConfigs(v, [
      { name: 'commits', delivery: 'disclosure' },
      { name: 'review', delivery: 'auto' },
    ]);
    expect(selection).toEqual([
      { name: 'commits', delivery: 'disclosure' },
      { name: 'review', delivery: 'auto' },
    ]);
    const byName = new Map(pieces.map((p) => [p.name, p]));
    expect(byName.get('commits')?.axes.delivery).toBe('pull');
    expect(byName.get('review')?.axes.delivery).toBe('push');
    const index = byName.get(SKILL_INDEX_PIECE_NAME);
    expect(index?.axes.delivery).toBe('push');
    // The advertisement names the disclosure skill + its description and points at get_piece;
    // the auto skill (already in the prompt) is not advertised.
    expect(index?.body).toContain('commits — commits (project)');
    expect(index?.body).toContain('get_piece');
    expect(index?.body).not.toContain('review —');
  });

  it('reports configured-but-unresolved names as missing, excluded from the selection', () => {
    const v = view([skillEntry('commits', 'project')]);
    const { pieces, selection, missing } = resolveSkillConfigs(v, [
      { name: 'commits', delivery: 'auto' },
      { name: 'ghost', delivery: 'auto' },
    ]);
    expect(missing).toEqual(['ghost']);
    expect(selection.map((s) => s.name)).toEqual(['commits']);
    expect(pieces.map((p) => p.name)).toEqual(['commits']);
  });

  it('keeps the first occurrence of a case-folded duplicate config', () => {
    const v = view([skillEntry('commits', 'project')]);
    const { selection } = resolveSkillConfigs(v, [
      { name: 'commits', delivery: 'disclosure' },
      { name: 'Commits', delivery: 'auto' },
    ]);
    expect(selection).toEqual([{ name: 'commits', delivery: 'disclosure' }]);
  });
});

describe('invocation', () => {
  it('lists effective skills as invocable rows', () => {
    const v = view([skillEntry('b-skill', 'personal'), skillEntry('a-skill', 'project')]);
    expect(listInvocableSkills(v)).toEqual([
      { name: 'a-skill', description: 'a-skill (project)', scope: 'project' },
      { name: 'b-skill', description: 'b-skill (personal)', scope: 'personal' },
    ]);
  });

  it('resolves an invocation case-insensitively to the library name + body', () => {
    const v = view([skillEntry('Commits', 'personal')]);
    expect(resolveInvocation(v, 'commits')).toEqual({
      name: 'Commits',
      body: 'body of Commits (personal)',
    });
    expect(resolveInvocation(v, 'ghost')).toBeUndefined();
  });
});

describe('effectiveMcpServers / resolveMcpServers', () => {
  it('folds scope precedence and drops disabled/broken entries', () => {
    const v = view([
      mcpEntry('gh', 'personal', 'https://personal.example'),
      mcpEntry('gh', 'project', 'https://project.example'),
      mcpEntry('off', 'project', 'https://off.example', {
        record: {
          name: 'off',
          kind: 'mcp',
          mode: 'reference',
          enabled: false,
          source: { path: '/src/.mcp.json', serverName: 'off' },
        },
      }),
      mcpEntry('broken', 'project', 'https://broken.example', {
        status: 'invalid-source',
        mcp: undefined,
      }),
    ]);
    expect(effectiveMcpServers(v).map((e) => [e.name, e.scope])).toEqual([['gh', 'project']]);
    expect(resolveMcpServers(v)).toEqual({
      gh: { transport: 'http', url: 'https://project.example' },
    });
  });
});

describe('createSessionLibraryPort', () => {
  it('resolves fresh per call and registers every resolved Piece for get_piece pulls', () => {
    let entries = [skillEntry('commits', 'project')];
    const registered: Piece[] = [];
    const port = createSessionLibraryPort({
      list: () => view(entries),
      registerPiece: (piece) => registered.push(piece),
    });

    const first = port.resolveSkills([{ name: 'commits', delivery: 'disclosure' }]);
    expect(first.selection).toHaveLength(1);
    expect(registered.map((p) => p.name)).toEqual(['commits', SKILL_INDEX_PIECE_NAME]);

    // The library changed on disk between calls — the next resolution sees it.
    entries = [];
    const second = port.resolveSkills([{ name: 'commits', delivery: 'disclosure' }]);
    expect(second.missing).toEqual(['commits']);
  });
});
