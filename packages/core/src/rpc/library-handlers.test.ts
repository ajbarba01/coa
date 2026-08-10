import { describe, expect, it } from 'vitest';
import type { LibrarySummary, LibraryView } from '@coa/shared';
import { buildLibraryHandlers, type LibraryPorts } from './library-handlers.js';
import { dispatch } from './router.js';

const emptyView: LibraryView = {
  entries: [],
  discovered: { skills: [], mcpServers: [] },
  diagnostics: [],
};

const summary: LibrarySummary = {
  scope: 'personal',
  record: {
    name: 'commits',
    kind: 'skill',
    mode: 'reference',
    enabled: true,
    source: { path: '/h/.claude/skills/commits/SKILL.md' },
  },
};

function makePorts(): { ports: LibraryPorts; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ports: {
      list: () => {
        calls.push('list');
        return emptyView;
      },
      link: (args) => {
        calls.push(`link:${args.kind}:${args.source.path}`);
        return summary;
      },
      copy: (args) => {
        calls.push(`copy:${args.kind}:${args.source.serverName ?? ''}`);
        return summary;
      },
      unlink: (ref) => {
        calls.push(`unlink:${ref.name}`);
        return ref.name === 'present';
      },
      setEnabled: (ref, enabled) => {
        calls.push(`setEnabled:${ref.name}:${String(enabled)}`);
        if (ref.name === 'ghost') throw new Error('no such entry');
        return summary;
      },
      invocable: () => {
        calls.push('invocable');
        return [{ name: 'commits', description: 'commit discipline', scope: 'personal' }];
      },
    },
  };
}

const req = (method: string, params?: unknown): Record<string, unknown> => ({
  jsonrpc: '2.0',
  id: 1,
  method,
  ...(params !== undefined ? { params } : {}),
});

describe('buildLibraryHandlers', () => {
  it('serves listLibrary and rescanLibrary as the same fresh read', async () => {
    const { ports, calls } = makePorts();
    const handlers = buildLibraryHandlers(ports);
    const list = await dispatch(req('listLibrary'), handlers);
    const rescan = await dispatch(req('rescanLibrary'), handlers);
    expect(list).toMatchObject({ result: emptyView });
    expect(rescan).toMatchObject({ result: emptyView });
    expect(calls).toEqual(['list', 'list']);
  });

  it('serves listSkills from the invocable port (the composer /skill picker)', async () => {
    const { ports, calls } = makePorts();
    const handlers = buildLibraryHandlers(ports);
    const response = await dispatch(req('listSkills'), handlers);
    expect(response).toMatchObject({
      result: {
        skills: [{ name: 'commits', description: 'commit discipline', scope: 'personal' }],
      },
    });
    expect(calls).toEqual(['invocable']);
  });

  it('validates link params at the edge and passes them through', async () => {
    const { ports, calls } = makePorts();
    const handlers = buildLibraryHandlers(ports);
    const ok = await dispatch(
      req('linkLibrary', {
        kind: 'skill',
        scope: 'personal',
        source: { path: '/x/SKILL.md' },
      }),
      handlers,
    );
    expect(ok).toMatchObject({ result: summary });
    expect(calls).toEqual(['link:skill:/x/SKILL.md']);

    const bad = await dispatch(req('linkLibrary', { kind: 'nope', scope: 'personal' }), handlers);
    expect(bad).toMatchObject({ error: { code: -32602 } });
  });

  it('copyLibrary takes no scope — a copy always lands in the project store', async () => {
    const { ports } = makePorts();
    const handlers = buildLibraryHandlers(ports);
    const ok = await dispatch(
      req('copyLibrary', { kind: 'mcp', source: { path: '/r/.mcp.json', serverName: 'gh' } }),
      handlers,
    );
    expect(ok).toMatchObject({ result: summary });
  });

  it('unlinkLibrary reports removed as data', async () => {
    const { ports } = makePorts();
    const handlers = buildLibraryHandlers(ports);
    const hit = await dispatch(
      req('unlinkLibrary', { kind: 'skill', scope: 'project', name: 'present' }),
      handlers,
    );
    expect(hit).toMatchObject({ result: { removed: true } });
    const miss = await dispatch(
      req('unlinkLibrary', { kind: 'skill', scope: 'project', name: 'absent' }),
      handlers,
    );
    expect(miss).toMatchObject({ result: { removed: false } });
  });

  it('turns a port throw into an ordinary coded error reply', async () => {
    const { ports } = makePorts();
    const handlers = buildLibraryHandlers(ports);
    const response = await dispatch(
      req('setLibraryEnabled', { kind: 'skill', scope: 'personal', name: 'ghost', enabled: true }),
      handlers,
    );
    expect(response).toMatchObject({ error: { message: 'no such entry' } });
  });
});
