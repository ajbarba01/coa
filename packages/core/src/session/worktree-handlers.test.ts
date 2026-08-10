import { describe, expect, it } from 'vitest';
import { dispatch } from '../rpc/router.js';
import { buildWorktreeHandlers, type WorktreeHandlerDeps } from './worktree-handlers.js';
import type { WorktreeRecord, WorktreeStatus } from './worktree-manager.js';

/** A hand-rolled manager double — the handlers only touch list/status/reap. */
function fakeWorktrees(
  records: WorktreeRecord[],
  options: {
    status?: (sessionId: string) => WorktreeStatus | undefined;
    onReap?: (sessionId: string) => void;
  } = {},
): WorktreeHandlerDeps['worktrees'] {
  const byId = new Map(records.map((r) => [r.sessionId, r] as const));
  return {
    list: () => [...byId.values()],
    status: (sessionId) =>
      options.status !== undefined
        ? options.status(sessionId)
        : byId.has(sessionId)
          ? { dirty: false, filesChanged: 0 }
          : undefined,
    reap: (sessionId) => {
      if (!byId.has(sessionId)) return false;
      byId.delete(sessionId);
      options.onReap?.(sessionId);
      return true;
    },
  };
}

function record(sessionId: string, path = `/repo/.coa/worktrees/${sessionId}`): WorktreeRecord {
  return { sessionId, path, isolated: true, createdAt: '2026-08-09T00:00:00.000Z' };
}

async function call(
  handlers: ReturnType<typeof buildWorktreeHandlers>,
  method: string,
  params?: unknown,
) {
  const res = await dispatch(
    { jsonrpc: '2.0', id: 1, method, ...(params !== undefined ? { params } : {}) },
    handlers,
  );
  if (res === undefined || !('result' in res)) throw new Error(`no result from ${method}`);
  return res.result;
}

describe('listWorktrees', () => {
  it('lists every isolated worktree with its path, age, liveness and dirty summary', async () => {
    const handlers = buildWorktreeHandlers({
      worktrees: fakeWorktrees([record('s1'), record('s2')], {
        status: (id) =>
          id === 's1' ? { dirty: true, filesChanged: 3 } : { dirty: false, filesChanged: 0 },
      }),
      isRunning: (id) => id === 's2',
    });
    const result = (await call(handlers, 'listWorktrees')) as {
      worktrees: Array<Record<string, unknown>>;
    };
    expect(result.worktrees).toEqual([
      {
        sessionId: 's1',
        path: '/repo/.coa/worktrees/s1',
        createdAt: '2026-08-09T00:00:00.000Z',
        running: false,
        dirty: true,
        filesChanged: 3,
      },
      {
        sessionId: 's2',
        path: '/repo/.coa/worktrees/s2',
        createdAt: '2026-08-09T00:00:00.000Z',
        running: true,
        dirty: false,
        filesChanged: 0,
      },
    ]);
  });

  it('a failed status read costs the row its dirty fields, never the list', async () => {
    const handlers = buildWorktreeHandlers({
      worktrees: fakeWorktrees([record('s1')], {
        status: () => {
          throw new Error('git exploded');
        },
      }),
    });
    const result = (await call(handlers, 'listWorktrees')) as {
      worktrees: Array<Record<string, unknown>>;
    };
    expect(result.worktrees).toHaveLength(1);
    expect(result.worktrees[0]).not.toHaveProperty('dirty');
    expect(result.worktrees[0]).toMatchObject({ sessionId: 's1', running: false });
  });

  it('an empty manager answers an empty list (the floor, not an error)', async () => {
    const handlers = buildWorktreeHandlers({ worktrees: fakeWorktrees([]) });
    expect(await call(handlers, 'listWorktrees')).toEqual({ worktrees: [] });
  });
});

describe('reapWorktree', () => {
  it('reaps an idle session’s worktree through the manager seam', async () => {
    const reaped: string[] = [];
    const handlers = buildWorktreeHandlers({
      worktrees: fakeWorktrees([record('s1')], { onReap: (id) => reaped.push(id) }),
    });
    expect(await call(handlers, 'reapWorktree', { sessionId: 's1' })).toEqual({ reaped: true });
    expect(reaped).toEqual(['s1']);
    expect(await call(handlers, 'listWorktrees')).toEqual({ worktrees: [] });
  });

  it('refuses a session whose turn is running right now, with the reason', async () => {
    const reaped: string[] = [];
    const handlers = buildWorktreeHandlers({
      worktrees: fakeWorktrees([record('s1')], { onReap: (id) => reaped.push(id) }),
      isRunning: () => true,
    });
    expect(await call(handlers, 'reapWorktree', { sessionId: 's1' })).toEqual({
      reaped: false,
      reason: 'running',
    });
    expect(reaped).toEqual([]);
  });

  it('a session with nothing to reap answers false without a reason (a no-op, not an error)', async () => {
    const handlers = buildWorktreeHandlers({ worktrees: fakeWorktrees([]) });
    expect(await call(handlers, 'reapWorktree', { sessionId: 'ghost' })).toEqual({ reaped: false });
  });
});
