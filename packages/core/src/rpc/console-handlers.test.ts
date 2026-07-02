import type { FeedView, PackageSummary, RoleSummary } from '@coa/shared';
import { RPC_ERROR } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import type { CapState } from '../governance/cost-cap.js';
import type { DecisionEntry } from '../governance/governance-log.js';
import { dispatch } from './router.js';
import {
  buildConsoleHandlers,
  buildRegistryHandlers,
  type ConsoleReadPorts,
} from './console-handlers.js';

const EMPTY_FEED: FeedView = { expanded: [], collapsed: [] };

function ports(over: Partial<ConsoleReadPorts> = {}): ConsoleReadPorts {
  return {
    capState: (): CapState => ({ capHit: false, remaining: 12.5 }),
    flagsForUser: () => EMPTY_FEED,
    readDecision: () => undefined,
    decisionsByTarget: () => [],
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

  it('serves getDecision, mapping a missing entry to null', async () => {
    const entry: DecisionEntry = { id: 4, target: 'pay.ts', entry: 'use decimal' };
    const handlers = buildConsoleHandlers(
      ports({ readDecision: (id) => (id === 4 ? entry : undefined) }),
    );

    const hit = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'getDecision', params: { id: 4 } },
      handlers,
    );
    const miss = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'getDecision', params: { id: 9 } },
      handlers,
    );

    expect(hit).toEqual({ jsonrpc: '2.0', id: 1, result: entry });
    expect(miss).toEqual({ jsonrpc: '2.0', id: 1, result: null });
  });

  it('rejects getDecision with a non-numeric id as invalidParams', async () => {
    const handlers = buildConsoleHandlers(ports());
    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'getDecision', params: { id: 'four' } },
      handlers,
    );
    expect(res).toMatchObject({ error: { code: RPC_ERROR.invalidParams } });
  });

  it('serves why as the decisions governing a target', async () => {
    const entries: DecisionEntry[] = [{ id: 1, target: 'pay.ts', entry: 'decimal money' }];
    const handlers = buildConsoleHandlers(ports({ decisionsByTarget: () => entries }));

    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'why', params: { target: 'pay.ts' } },
      handlers,
    );

    expect(res).toEqual({ jsonrpc: '2.0', id: 1, result: entries });
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
      'getDecision',
      'listTimeline',
      'why',
    ]);
  });
});

describe('registry handlers — the agent-assembly catalogue verbs', () => {
  const role: RoleSummary = { id: 'swe', name: 'SWE', description: 'writes code', packageIds: ['coding'] };
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
