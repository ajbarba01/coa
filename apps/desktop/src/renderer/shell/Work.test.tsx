// @vitest-environment jsdom
import type { TurnFrame } from '@coa/console-viewmodel';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleState } from '../panels/state.js';
import { makeState } from '../testing/fixtures.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { useShell } from './store.js';
import { childDotStatus, Work } from './Work.js';

const initialShell = useShell.getState();

const SESSION = {
  id: 'c1',
  title: 'wire the dock',
  agentRef: 'roles/dev',
  updatedAt: '2026-07-11T00:00:00.000Z',
};

function publish(runStatus: Record<string, { since: number }> = {}): void {
  publishConsoleState(
    makeState({
      data: { sessions: { status: 'ok', value: [SESSION] } },
      ui: { activeSessionId: 'c1', runStatus },
    }),
  );
}

function renderWorkWithTurns(turns: TurnFrame[]): void {
  publishConsoleState(
    makeState({
      data: { sessions: { status: 'ok', value: [SESSION] }, turns: { status: 'ok', value: turns } },
      ui: { activeSessionId: 'c1' },
    }),
  );
  render(<Work />);
}

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
  (window as unknown as { coa: unknown }).coa = { platform: 'win32' };
});

describe('Work', () => {
  it('shows the active session as the root row with its real run status', () => {
    publish({ c1: { since: 1 } });
    render(<Work />);
    expect(screen.getByText('wire the dock')).toBeTruthy();
    expect(screen.getByText(/^root$/i)).toBeTruthy();
  });

  it('labels a spawned child’s own tab "Subagent", not "Root" — the badge names the session, not the panel', () => {
    const root = { ...SESSION };
    const child = {
      id: 'child1',
      title: 'first child',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T01:00:00.000Z',
      parent: 'c1',
      root: 'c1',
    };
    publishConsoleState(
      makeState({
        data: { sessions: { status: 'ok', value: [root, child] } },
        ui: { activeSessionId: 'child1' },
      }),
    );
    render(<Work />);
    // The title also appears as the Subagents floor's own row for this child, so
    // assert presence, not uniqueness.
    expect(screen.getAllByText('first child').length).toBeGreaterThan(0);
    expect(screen.getByText(/^subagent$/i)).toBeTruthy();
    expect(screen.queryByText(/^root$/i)).toBeNull();
  });

  it('falls to the quiet empty line with no active session', () => {
    publishConsoleState(makeState({ data: { sessions: { status: 'ok', value: [] } } }));
    render(<Work />);
    expect(screen.getByText(/^no session$/i)).toBeTruthy();
  });

  it('collapses through the foot control', () => {
    publish();
    render(<Work />);
    fireEvent.click(screen.getByRole('button', { name: /^hide session panel$/i }));
    expect(useShell.getState().workOpen).toBe(false);
  });

  it('carries the window controls in its title-bar segment', () => {
    publish();
    render(<Work />);
    expect(screen.getByRole('button', { name: /^close$/i })).toBeTruthy();
  });

  it('shows the agent plan checklist from the active session plan frame', () => {
    renderWorkWithTurns([
      {
        id: 'p1',
        role: 'agent',
        kind: 'plan',
        items: [
          { text: 'wire the surface', status: 'in-progress' },
          { text: 'read the spec', status: 'done' },
        ],
      },
    ]);
    expect(screen.getByText('wire the surface')).toBeTruthy();
    expect(screen.getByText('read the spec')).toBeTruthy();
  });

  it('labels the un-backed sections as floors, not fake data', () => {
    renderWorkWithTurns([]);
    expect(screen.getAllByText(/not tracked yet/i).length).toBeGreaterThan(0);
  });

  it('rolls the Cost section up over the whole tree, not the root’s own spend — a root that spends LESS than its descendants', () => {
    const root = { ...SESSION, costUsd: 1 };
    const child1 = {
      id: 'child1',
      title: 'first child',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T01:00:00.000Z',
      parent: 'c1',
      root: 'c1',
      costUsd: 10,
    };
    const child2 = {
      id: 'child2',
      title: 'second child',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T01:00:00.000Z',
      parent: 'c1',
      root: 'c1',
      costUsd: 5,
    };
    publishConsoleState(
      makeState({
        data: { sessions: { status: 'ok', value: [root, child1, child2] } },
        ui: { activeSessionId: 'c1' },
      }),
    );
    render(<Work />);
    expect(screen.getByText('$16.00')).toBeTruthy();
    expect(screen.queryByText('$1.00')).toBeNull();
  });

  it('shows the SAME family total from a nested child’s own tab, not just its own spend', () => {
    const root = { ...SESSION, costUsd: 1 };
    const child = {
      id: 'child1',
      title: 'first child',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T01:00:00.000Z',
      parent: 'c1',
      root: 'c1',
      costUsd: 10,
    };
    publishConsoleState(
      makeState({
        data: { sessions: { status: 'ok', value: [root, child] } },
        ui: { activeSessionId: 'child1' }, // viewing the CHILD's own tab
      }),
    );
    render(<Work />);
    expect(screen.getByText('$11.00')).toBeTruthy();
  });

  it('Cost degrades honestly to the floor while NOTHING in the tree carries a spend (roll-up producer parked)', () => {
    const root = { ...SESSION };
    const child = {
      id: 'child1',
      title: 'first child',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T01:00:00.000Z',
      parent: 'c1',
      root: 'c1',
    };
    publishConsoleState(
      makeState({
        data: { sessions: { status: 'ok', value: [root, child] } },
        ui: { activeSessionId: 'c1' },
      }),
    );
    render(<Work />);
    // No fabricated number anywhere — the floor line stands in (Changes floors too,
    // so at least one "not tracked yet" must be the Cost section's).
    expect(screen.queryByText(/^\$/)).toBeNull();
    expect(screen.getAllByText(/not tracked yet/i).length).toBeGreaterThan(1);
  });
});

const CHILD = {
  id: 'child1',
  title: 'first child',
  agentRef: 'roles/dev',
  updatedAt: '2026-07-11T01:00:00.000Z',
  parent: 'c1',
  root: 'c1',
};
const GRANDCHILD = {
  id: 'grandchild1',
  title: 'grandchild task',
  agentRef: 'roles/dev',
  updatedAt: '2026-07-11T02:00:00.000Z',
  parent: 'child1',
  root: 'c1',
};
const DEV_AGENT = {
  ref: 'roles/dev',
  name: 'dev',
  description: 'builds things',
  icon: 'bot' as const,
  color: 'teal' as const,
  scope: 'project' as const,
};

describe('Work — Subagents floor', () => {
  it('shows a childless tree as "no subagents yet", never the not-tracked floor', () => {
    publish();
    render(<Work />);
    expect(screen.getByText(/no subagents yet/i)).toBeTruthy();
  });

  it('lists children depth-nested with the agent identity name and a jump-to-thread row', () => {
    const selectSession = vi.fn();
    publishConsoleState(
      makeState({
        data: {
          sessions: { status: 'ok', value: [SESSION, CHILD, GRANDCHILD] },
          agents: { status: 'ok', value: [DEV_AGENT] },
        },
        ui: { activeSessionId: 'c1' },
        actions: { selectSession },
      }),
    );
    render(<Work />);
    const childRow = screen.getByRole('button', { name: 'Open first child' });
    const grandchildRow = screen.getByRole('button', { name: 'Open grandchild task' });
    // Depth nests via the row's own indent (one step per depth beyond a direct child).
    expect(childRow.style.paddingLeft).toBe('14px');
    expect(grandchildRow.style.paddingLeft).toBe('26px');
    // The identity color marks the agent name.
    expect(childRow.querySelector('.text-agent-teal')?.textContent).toBe('dev');
    fireEvent.click(childRow);
    expect(selectSession).toHaveBeenCalledWith('child1');
  });

  it('childDotStatus reads the console run map first, then the announcement mirror, then idle', () => {
    const base = makeState({});
    expect(childDotStatus('x', base)).toBe('idle');
    expect(childDotStatus('x', makeState({ ui: { runStatus: { x: { since: 1 } } } }))).toBe(
      'running',
    );
    expect(
      childDotStatus('x', makeState({ ui: { subagentStatus: { x: { state: 'running' } } } })),
    ).toBe('running');
    expect(
      childDotStatus('x', makeState({ ui: { subagentStatus: { x: { state: 'completed' } } } })),
    ).toBe('done');
    expect(
      childDotStatus('x', makeState({ ui: { subagentStatus: { x: { state: 'errored' } } } })),
    ).toBe('critical');
    expect(
      childDotStatus('x', makeState({ ui: { subagentStatus: { x: { state: 'stopped' } } } })),
    ).toBe('idle');
  });
});

describe('Work — Worktree floor', () => {
  const WT = {
    sessionId: 'child1',
    path: '/repo/.coa/worktrees/child1',
    createdAt: '2026-08-09T00:00:00.000Z',
  };

  function publishWorktrees(
    worktrees: ConsoleState['data']['worktrees'],
    reapWorktree = vi.fn(),
  ): ReturnType<typeof vi.fn> {
    publishConsoleState(
      makeState({
        data: {
          sessions: { status: 'ok', value: [SESSION, CHILD] },
          worktrees,
        },
        ui: { activeSessionId: 'c1' },
        actions: { reapWorktree },
      }),
    );
    return reapWorktree;
  }

  it('a failed read surfaces as a quiet alert line, never fake rows', () => {
    publishWorktrees({ status: 'error', message: 'daemon unreachable' });
    render(<Work />);
    expect(screen.getByRole('alert').textContent).toContain('daemon unreachable');
  });

  it('no isolated worktrees reads as the honest shared-root line', () => {
    publishWorktrees({ status: 'ok', value: [] });
    render(<Work />);
    expect(screen.getByText(/shared project root/i)).toBeTruthy();
  });

  it('a clean tree-member row shows its path tail + Clean and reaps on one click', () => {
    const reap = publishWorktrees({
      status: 'ok',
      value: [{ ...WT, dirty: false, filesChanged: 0, running: false }],
    });
    render(<Work />);
    expect(screen.getByText(/child1$/)).toBeTruthy();
    expect(screen.getByText('Clean')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reap' }));
    expect(reap).toHaveBeenCalledWith('child1');
  });

  it('a DIRTY row asks once more (arm → Discard Changes) before reaping', () => {
    const reap = publishWorktrees({
      status: 'ok',
      value: [{ ...WT, dirty: true, filesChanged: 3, running: false }],
    });
    render(<Work />);
    expect(screen.getByText('3 changed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reap' }));
    expect(reap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(reap).toHaveBeenCalledWith('child1');
  });

  it('a RUNNING session’s row withholds the reap control and says so', () => {
    publishWorktrees({
      status: 'ok',
      value: [{ ...WT, dirty: false, filesChanged: 0, running: true }],
    });
    render(<Work />);
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reap' })).toBeNull();
  });

  it('worktrees outside the active family tree fold to one quiet count line', () => {
    publishWorktrees({
      status: 'ok',
      value: [
        {
          sessionId: 'elsewhere',
          path: '/repo/.coa/worktrees/elsewhere',
          createdAt: '2026-08-09T00:00:00.000Z',
        },
      ],
    });
    render(<Work />);
    expect(screen.getByText(/shared project root/i)).toBeTruthy();
    expect(screen.getByText('1 in other sessions')).toBeTruthy();
  });
});
