import type {
  AgentFile,
  AgentScope,
  AgentSummary,
  FeedView,
  PackageSummary,
  RoleSummary,
} from '@coa/shared';
import { RPC_ERROR } from '@coa/shared';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CapState } from '../governance/cost-cap.js';
import { AgentRegistry } from '../session/agent-defs.js';
import { dispatch } from './router.js';
import {
  buildAgentRegistryHandlers,
  buildConsoleHandlers,
  buildRegistryHandlers,
  type ConsoleReadPorts,
} from './console-handlers.js';

const EMPTY_FEED: FeedView = { expanded: [], collapsed: [] };

function ports(over: Partial<ConsoleReadPorts> = {}): ConsoleReadPorts {
  return {
    capState: (): CapState => ({ capHit: false, remaining: 12.5 }),
    flagsForUser: () => EMPTY_FEED,
    listTimeline: () => [],
    ...over,
  };
}

describe('console handlers — the read-only inspector verbs over the dispatch router', () => {
  it('serves capState from the cost surface', async () => {
    const handlers = buildConsoleHandlers(
      ports({ capState: () => ({ capHit: true, remaining: null }) }),
    );

    const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'capState' }, handlers);

    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: { capHit: true, remaining: null } });
  });

  it('passes an optional sessionId through to capState', async () => {
    let seen: string | undefined = 'unset';
    const handlers = buildConsoleHandlers(
      ports({
        capState: (sessionId) => {
          seen = sessionId;
          return { capHit: false, remaining: 1 };
        },
      }),
    );

    await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'capState', params: { sessionId: 's7' } },
      handlers,
    );

    expect(seen).toBe('s7');
  });

  it('serves flagsForUser, forwarding the optional scope', async () => {
    let seenScope: string | undefined = 'unset';
    const feed: FeedView = {
      expanded: [],
      collapsed: [{ concernKey: 'k', count: 2, severity: 'low' }],
    };
    const handlers = buildConsoleHandlers(
      ports({
        flagsForUser: (scope) => {
          seenScope = scope;
          return feed;
        },
      }),
    );

    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'flagsForUser', params: { scope: 'src/api' } },
      handlers,
    );

    expect(seenScope).toBe('src/api');
    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: feed });
  });

  it('serves listTimeline as the checkpoint list', async () => {
    const checkpoints = [
      { id: 'c1', seq: 3, ts: '2026-06-30T00:00:00Z', worktree: 'main', pinned: false },
    ];
    const handlers = buildConsoleHandlers(ports({ listTimeline: () => checkpoints }));

    const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'listTimeline' }, handlers);

    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: checkpoints });
  });

  it('registers exactly the read-only verb set', () => {
    expect(Object.keys(buildConsoleHandlers(ports())).sort()).toEqual([
      'capState',
      'flagsForUser',
      'listTimeline',
    ]);
  });
});

describe('registry handlers — the agent-assembly catalogue verbs', () => {
  const role: RoleSummary = {
    id: 'swe',
    name: 'SWE',
    description: 'writes code',
    packageIds: ['coding'],
  };
  const pkg: PackageSummary = {
    id: 'coding',
    name: 'Coding',
    description: 'edits',
    inclusion: 'opt-in',
    toolRefs: ['Edit'],
  };

  it('serves listRoles as the role summary list', async () => {
    const handlers = buildRegistryHandlers({ listRoles: () => [role], listPackages: () => [] });

    const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'listRoles' }, handlers);

    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: [role] });
  });

  it('serves listPackages as the package summary list', async () => {
    const handlers = buildRegistryHandlers({ listRoles: () => [], listPackages: () => [pkg] });

    const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'listPackages' }, handlers);

    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: [pkg] });
  });

  it('registers exactly the catalogue verb set', () => {
    const handlers = buildRegistryHandlers({ listRoles: () => [], listPackages: () => [] });
    expect(Object.keys(handlers).sort()).toEqual(['listPackages', 'listRoles']);
  });
});

describe('buildAgentRegistryHandlers', () => {
  function ports() {
    const saved: { ref: string; file: AgentFile; scope: string }[] = [];
    const agents: AgentSummary[] = [
      {
        ref: 'explorer',
        scope: 'builtin' as AgentScope,
        name: 'Explorer',
        description: 'reads',
        icon: 'search',
        color: 'sky',
      },
    ];
    return {
      saved,
      agents,
      handlers: buildAgentRegistryHandlers({
        listAgents: () => ({ agents, diagnostics: [] }),
        saveAgent: (ref, file, scope) => saved.push({ ref, file, scope }),
        deleteAgent: () => true,
      }),
    };
  }

  it('listAgents returns the merged set and its diagnostics', async () => {
    const { handlers, agents } = ports();

    const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'listAgents' }, handlers);

    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: { agents, diagnostics: [] } });
  });

  it('saveAgent validates the file before writing', async () => {
    const { handlers, saved } = ports();

    await dispatch(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'saveAgent',
        params: {
          ref: 'reviewer',
          scope: 'personal',
          file: { name: 'Reviewer', description: 'reviews' },
        },
      },
      handlers,
    );

    expect(saved[0]?.ref).toBe('reviewer');
    expect(saved[0]?.file.description).toBe('reviews');
  });

  it('saveAgent rejects a definition with no description as invalidParams', async () => {
    const { handlers } = ports();

    const res = await dispatch(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'saveAgent',
        params: { ref: 'bad', scope: 'personal', file: { name: 'Bad' } },
      },
      handlers,
    );

    expect(res).toMatchObject({ error: { code: RPC_ERROR.invalidParams } });
  });

  it('saveAgent refuses the builtin scope as invalidParams', async () => {
    const { handlers } = ports();

    const res = await dispatch(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'saveAgent',
        params: { ref: 'x', scope: 'builtin', file: { name: 'X', description: 'x' } },
      },
      handlers,
    );

    expect(res).toMatchObject({ error: { code: RPC_ERROR.invalidParams } });
  });

  it('deleteAgent answers removed:false when the file was already gone', async () => {
    const home = mkdtempSync(join(tmpdir(), 'coa-home-'));
    const root = mkdtempSync(join(tmpdir(), 'coa-root-'));
    const registry = new AgentRegistry(home, root);
    const handlers = buildAgentRegistryHandlers({
      listAgents: () => registry.list(),
      saveAgent: (ref, file, scope) => registry.save(ref, file, scope),
      deleteAgent: (ref, scope) => registry.remove(ref, scope),
    });

    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'deleteAgent', params: { ref: 'ghost', scope: 'project' } },
      handlers,
    );

    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: { removed: false } });
  });

  it('deleteAgent carries a genuinely failed remove back to the caller as an error', async () => {
    const home = mkdtempSync(join(tmpdir(), 'coa-home-'));
    const root = mkdtempSync(join(tmpdir(), 'coa-root-'));
    const registry = new AgentRegistry(home, root);
    const handlers = buildAgentRegistryHandlers({
      listAgents: () => registry.list(),
      saveAgent: (ref, file, scope) => registry.save(ref, file, scope),
      deleteAgent: (ref, scope) => registry.remove(ref, scope),
    });
    // A real unlink that cannot succeed — a non-empty directory where the agent's file
    // belongs — rather than a stub that rejects, so this proves the whole edge and not
    // just the mock. Answering `{ removed: false }` here is what let a failed delete
    // travel the stack as a success.
    mkdirSync(join(root, '.coa', 'agents', 'wedged.yaml'), { recursive: true });
    writeFileSync(join(root, '.coa', 'agents', 'wedged.yaml', 'occupant.txt'), 'in the way');

    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'deleteAgent', params: { ref: 'wedged', scope: 'project' } },
      handlers,
    );

    expect(res).toMatchObject({ id: 1, error: { code: RPC_ERROR.internalError } });
  });
});
