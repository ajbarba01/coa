// @vitest-environment jsdom
import type { SessionSummary } from '@coa/console-viewmodel';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState, resetStores, seedState } from '../testing/fixtures.js';
import { arrangeSessions, Browser } from './Browser.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

const SESSIONS = [
  {
    id: 'c1',
    title: 'wire the dock',
    agentRef: 'roles/dev',
    updatedAt: '2026-07-11T00:00:00.000Z',
  },
  {
    id: 'c2',
    title: 'audit the ledger',
    agentRef: 'roles/doc',
    updatedAt: '2026-07-11T01:00:00.000Z',
  },
];
const AGENTS = [
  { ref: 'roles/dev', name: 'dev', icon: 'bot', color: 'slate', scope: 'project' as const },
  { ref: 'roles/doc', name: 'docs', icon: 'bot', color: 'slate', scope: 'project' as const },
];

beforeEach(() => {
  useShell.setState(initialShell, true);
  resetStores();
});

function mount(
  selectSession = vi.fn(),
  deleteSession = vi.fn(),
): { selectSession: ReturnType<typeof vi.fn>; deleteSession: ReturnType<typeof vi.fn> } {
  seedState(
    makeState({
      data: {
        sessions: { status: 'ok', value: SESSIONS },
        agents: { status: 'ok', value: AGENTS },
      },
      actions: { selectSession, deleteSession },
    }),
  );
  render(<Browser />);
  return { selectSession, deleteSession };
}

/** The result rows in render order (their accessible names collide with the per-row
 *  delete buttons, so query the rows themselves). */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-session-row]')];
}

describe('Browser', () => {
  it('lists every session with its agent name when the query is empty', () => {
    mount();
    expect(screen.getByText('wire the dock')).toBeTruthy();
    expect(screen.getByText('audit the ledger')).toBeTruthy();
    expect(screen.getByText('docs')).toBeTruthy();
  });

  it('filters by title or agent name', () => {
    useShell.getState().openSearch();
    useShell.getState().setQuery('docs');
    mount();
    expect(screen.queryByText('wire the dock')).toBeNull();
    expect(screen.getByText('audit the ledger')).toBeTruthy();
  });

  it('opening a row selects the session and leaves search mode', () => {
    useShell.getState().openSearch();
    const { selectSession } = mount();
    fireEvent.click(screen.getByText('wire the dock'));
    expect(selectSession).toHaveBeenCalledWith('c1');
    expect(useShell.getState().mode).toBe('work');
  });

  /** Label-adjacency law (UI.md): an icon-ONLY control carries a drawn mark. */
  it('draws the row’s delete mark rather than typing one', () => {
    mount();
    const del = screen.getByRole('button', { name: 'Delete session: wire the dock' });
    expect(del.querySelector('svg')).not.toBeNull();
    expect(del.textContent).toBe('');
  });

  it('clicking a row’s delete affordance calls deleteSession with that row’s id', () => {
    const { deleteSession, selectSession } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete session: wire the dock' }));
    expect(deleteSession).toHaveBeenCalledExactlyOnceWith('c1');
    // Deleting is not opening — it must not also select the session.
    expect(selectSession).not.toHaveBeenCalled();
  });

  it('arrow keys move a cursor over the results and Enter opens the one it names', () => {
    useShell.getState().openSearch();
    const { selectSession } = mount();
    // sorted by recency: audit the ledger (c2, newest) then wire the dock (c1). The cursor
    // starts on the top hit — the row Enter would open is always the one that looks hovered.
    expect(rows()[0]?.className).toContain('bg-s2');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(rows()[1]?.className).toContain('bg-s2');
    expect(rows()[0]?.className).not.toContain('bg-s2');
    // the dock previews whatever the cursor names, keyboard or mouse
    expect(useShell.getState().previewId).toBe('c1');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(selectSession).toHaveBeenCalledExactlyOnceWith('c1');
    expect(useShell.getState().mode).toBe('work');
  });

  it('Delete removes the session the cursor names — the same row Enter would open', () => {
    useShell.getState().openSearch();
    const { deleteSession, selectSession } = mount();
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // cursor → wire the dock (c1)
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(deleteSession).toHaveBeenCalledExactlyOnceWith('c1');
    // deleting is not opening, and search stays up so you can keep pruning
    expect(selectSession).not.toHaveBeenCalled();
    expect(useShell.getState().mode).toBe('search');
  });

  it('a deleted session leaves nothing on the reopen stack to resurrect', () => {
    useShell.getState().openSearch();
    useShell.setState({ tabs: ['c1'], closedTabs: ['c1'] });
    mount();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(useShell.getState().closedTabs).toEqual([]);
    expect(useShell.getState().tabs).toEqual([]);
  });

  it('the cursor wraps at the ends and follows the mouse', () => {
    useShell.getState().openSearch();
    mount();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(rows()[1]?.className).toContain('bg-s2');
    fireEvent.mouseEnter(rows()[0] as HTMLElement);
    expect(rows()[0]?.className).toContain('bg-s2');
    expect(useShell.getState().previewId).toBe('c2');
  });

  it('a re-ranking query returns the cursor to the top hit', () => {
    useShell.getState().openSearch();
    mount();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(useShell.getState().previewId).toBe('c1');
    act(() => useShell.getState().setQuery('audit'));
    expect(rows()).toHaveLength(1);
    expect(useShell.getState().previewId).toBe('c2');
  });

  it('leaves the arrows alone while a dialog owns the layer', () => {
    useShell.getState().openSearch();
    mount();
    act(() => useShell.getState().setPaletteOpen(true));
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(rows()[0]?.className).toContain('bg-s2');
  });

  it('nests a spawned child under its root — the mixed fixture: a root with two children plus an unrelated root', () => {
    const root = {
      id: 'root',
      title: 'root task',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T03:00:00.000Z',
    };
    const child1 = {
      id: 'child1',
      title: 'first child',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T02:00:00.000Z',
      parent: 'root',
      root: 'root',
    };
    const child2 = {
      id: 'child2',
      title: 'second child',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T01:00:00.000Z',
      parent: 'root',
      root: 'root',
    };
    const otherRoot = {
      id: 'other',
      title: 'unrelated root',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T00:00:00.000Z',
    };
    seedState(
      makeState({
        data: {
          sessions: { status: 'ok', value: [root, child1, child2, otherRoot] },
          agents: { status: 'ok', value: AGENTS },
        },
      }),
    );
    render(<Browser />);
    const r = rows();
    // Both children render nested under their root, in tree order — never as flat
    // peers of the unrelated root, and the unrelated root is never absorbed into it.
    expect(r.map((el) => el.getAttribute('data-session-id'))).toEqual([
      'root',
      'child1',
      'child2',
      'other',
    ]);
    expect(r.find((el) => el.dataset.sessionId === 'root')?.dataset.depth).toBe('0');
    expect(r.find((el) => el.dataset.sessionId === 'child1')?.dataset.depth).toBe('1');
    expect(r.find((el) => el.dataset.sessionId === 'child2')?.dataset.depth).toBe('1');
    expect(r.find((el) => el.dataset.sessionId === 'other')?.dataset.depth).toBe('0');
  });

  it('nests a grandchild two levels deep', () => {
    const root = {
      id: 'root',
      title: 'root task',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T02:00:00.000Z',
    };
    const child = {
      id: 'child',
      title: 'child task',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T01:00:00.000Z',
      parent: 'root',
      root: 'root',
    };
    const grandchild = {
      id: 'grandchild',
      title: 'grandchild task',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T00:00:00.000Z',
      parent: 'child',
      root: 'root',
    };
    seedState(
      makeState({
        data: {
          sessions: { status: 'ok', value: [root, child, grandchild] },
          agents: { status: 'ok', value: AGENTS },
        },
      }),
    );
    render(<Browser />);
    const r = rows();
    expect(r.map((el) => el.dataset.sessionId)).toEqual(['root', 'child', 'grandchild']);
    expect(r.find((el) => el.dataset.sessionId === 'grandchild')?.dataset.depth).toBe('2');
  });

  it('a session with no lineage renders exactly as before', () => {
    mount();
    const r = rows();
    expect(r.every((el) => el.dataset.depth === '0')).toBe(true);
  });

  it('a search hit still nests under its real parent even when the parent’s own title does not match — and the parent count stays the true hit count', () => {
    const root = {
      id: 'root',
      title: 'audit auth',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T02:00:00.000Z',
    };
    const child = {
      id: 'child',
      title: 'wire the dock',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T01:00:00.000Z',
      parent: 'root',
      root: 'root',
    };
    useShell.getState().openSearch();
    useShell.getState().setQuery('wire');
    seedState(
      makeState({
        data: {
          sessions: { status: 'ok', value: [root, child] },
          agents: { status: 'ok', value: AGENTS },
        },
      }),
    );
    render(<Browser />);
    // Only the child matched "wire" — but its real parent is pulled in for
    // context rather than the child rendering as an apparent, unrelated root.
    expect(screen.getByText('1 sessions')).toBeTruthy();
    const r = rows();
    expect(r.map((el) => el.dataset.sessionId)).toEqual(['root', 'child']);
    expect(r.find((el) => el.dataset.sessionId === 'root')?.dataset.depth).toBe('0');
    expect(r.find((el) => el.dataset.sessionId === 'root')?.dataset.matched).toBe('false');
    expect(r.find((el) => el.dataset.sessionId === 'child')?.dataset.depth).toBe('1');
    expect(r.find((el) => el.dataset.sessionId === 'child')?.dataset.matched).toBe('true');
  });

  it('resolves the WHOLE ancestor chain for a matched grandchild whose parent AND grandparent both fail the query — a one-level fix could not prove this', () => {
    const root = {
      id: 'root',
      title: 'audit auth',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T02:00:00.000Z',
    };
    const child = {
      id: 'child',
      title: 'code review',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T01:00:00.000Z',
      parent: 'root',
      root: 'root',
    };
    const grandchild = {
      id: 'grandchild',
      title: 'polish the diff',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T00:00:00.000Z',
      parent: 'child',
      root: 'root',
    };
    useShell.getState().openSearch();
    useShell.getState().setQuery('polish');
    seedState(
      makeState({
        data: {
          sessions: { status: 'ok', value: [root, child, grandchild] },
          agents: { status: 'ok', value: AGENTS },
        },
      }),
    );
    render(<Browser />);
    expect(screen.getByText('1 sessions')).toBeTruthy();
    const r = rows();
    // Neither 'root' nor 'child' matched "polish", yet both are pulled in so the
    // grandchild nests at its true depth instead of surfacing as its own root.
    expect(r.map((el) => el.dataset.sessionId)).toEqual(['root', 'child', 'grandchild']);
    expect(r.find((el) => el.dataset.sessionId === 'root')?.dataset.depth).toBe('0');
    expect(r.find((el) => el.dataset.sessionId === 'child')?.dataset.depth).toBe('1');
    expect(r.find((el) => el.dataset.sessionId === 'grandchild')?.dataset.depth).toBe('2');
    expect(r.find((el) => el.dataset.sessionId === 'grandchild')?.dataset.matched).toBe('true');
    expect(r.find((el) => el.dataset.sessionId === 'child')?.dataset.matched).toBe('false');
    expect(r.find((el) => el.dataset.sessionId === 'root')?.dataset.matched).toBe('false');
  });

  it('a search that matches nothing in a tree renders nothing from it — ancestor-pulling never resurrects a non-hit tree', () => {
    const root = {
      id: 'root',
      title: 'audit auth',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T00:00:00.000Z',
    };
    const child = {
      id: 'child',
      title: 'wire the dock',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T00:00:00.000Z',
      parent: 'root',
      root: 'root',
    };
    useShell.getState().openSearch();
    useShell.getState().setQuery('nonexistent-term');
    seedState(
      makeState({
        data: {
          sessions: { status: 'ok', value: [root, child] },
          agents: { status: 'ok', value: AGENTS },
        },
      }),
    );
    render(<Browser />);
    expect(rows()).toHaveLength(0);
  });

  it('a matched grandchild whose parent was deleted still nests under its root — the root fallback, not just the parent walk', () => {
    const root = {
      id: 'root',
      title: 'audit auth',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T02:00:00.000Z',
    };
    // 'deleted-mid' is intentionally absent from `sessions` — a real, supported
    // action (Browser's own `remove()`) can leave exactly this shape behind: a
    // grandchild whose immediate parent is gone but whose `root` still names a
    // present session.
    const grandchild = {
      id: 'grandchild',
      title: 'polish the diff',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T00:00:00.000Z',
      parent: 'deleted-mid',
      root: 'root',
    };
    useShell.getState().openSearch();
    useShell.getState().setQuery('polish');
    seedState(
      makeState({
        data: {
          sessions: { status: 'ok', value: [root, grandchild] },
          agents: { status: 'ok', value: AGENTS },
        },
      }),
    );
    render(<Browser />);
    const r = rows();
    // The broken parent link alone can't find 'root' — only the stored `.root`
    // fallback can. Without it this renders as a single 'grandchild' row at
    // depth 0, an apparent unrelated root.
    expect(r.map((el) => el.dataset.sessionId)).toEqual(['root', 'grandchild']);
    expect(r.find((el) => el.dataset.sessionId === 'root')?.dataset.depth).toBe('0');
    expect(r.find((el) => el.dataset.sessionId === 'grandchild')?.dataset.depth).toBe('1');
  });

  it('a tree only reachable by pulling still sorts by recency among genuine hits, not always last', () => {
    const rootA = {
      id: 'rootA',
      title: 'audit auth',
      agentRef: 'roles/dev',
      updatedAt: '2020-01-01T00:00:00.000Z', // old — a DIRECT hit
    };
    const rootB = {
      id: 'rootB',
      title: 'spawn tree',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T02:00:00.000Z', // newer — never itself matched
    };
    const childB = {
      id: 'childB',
      title: 'audit report',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T03:00:00.000Z', // newer still — the actual hit
      parent: 'rootB',
      root: 'rootB',
    };
    useShell.getState().openSearch();
    useShell.getState().setQuery('audit');
    seedState(
      makeState({
        data: {
          sessions: { status: 'ok', value: [rootA, rootB, childB] },
          agents: { status: 'ok', value: AGENTS },
        },
      }),
    );
    render(<Browser />);
    const r = rows();
    // rootB's tree is newer than rootA even though rootB itself is only pulled
    // in for context — Sort: Recent must still put it first.
    expect(r.map((el) => el.dataset.sessionId)).toEqual(['rootB', 'childB', 'rootA']);
  });

  it('an already-sorted no-search render is untouched by the group re-sort', () => {
    const root = {
      id: 'root',
      title: 'root task',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T03:00:00.000Z',
    };
    const child1 = {
      id: 'child1',
      title: 'first child',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T02:00:00.000Z',
      parent: 'root',
      root: 'root',
    };
    const otherRoot = {
      id: 'other',
      title: 'unrelated root',
      agentRef: 'roles/dev',
      updatedAt: '2026-07-11T00:00:00.000Z',
    };
    seedState(
      makeState({
        data: {
          sessions: { status: 'ok', value: [root, child1, otherRoot] },
          agents: { status: 'ok', value: AGENTS },
        },
      }),
    );
    render(<Browser />);
    // No search at all — nothing is pulled, so this is exactly the pre-existing
    // recency order: newest tree first, unaffected by the ordering fix.
    expect(rows().map((el) => el.dataset.sessionId)).toEqual(['root', 'child1', 'other']);
  });

  it('picking group: status from the toolbar renders a header per run state', () => {
    seedState(
      makeState({
        data: {
          sessions: { status: 'ok', value: SESSIONS },
          agents: { status: 'ok', value: AGENTS },
        },
        ui: { runStatus: { c1: { since: 0 } } },
      }),
    );
    render(<Browser />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Group sessions by' }));
    const option = screen.getByRole('option', { name: /^status$/i });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    expect(screen.getByText(/^running$/i)).toBeTruthy();
    expect(screen.getByText(/^idle$/i)).toBeTruthy();
  });
});

describe('arrangeSessions', () => {
  const agentName = (ref: string): string => AGENTS.find((a) => a.ref === ref)?.name ?? ref;
  const isRunning = (id: string): boolean => id === 'a3';

  const THREE: SessionSummary[] = [
    { id: 'a1', agentRef: 'roles/dev', title: 'mango tree', updatedAt: '2026-07-11T00:00:00.000Z' },
    { id: 'a2', agentRef: 'roles/doc', title: 'apple pie', updatedAt: '2026-07-11T02:00:00.000Z' },
    {
      id: 'a3',
      agentRef: 'roles/dev',
      title: 'zebra crossing',
      updatedAt: '2026-07-11T01:00:00.000Z',
    },
  ];

  it('groups by agent, newest session first within each group, one header per group', () => {
    const groups = arrangeSessions(THREE, 'recent', 'agent', agentName, isRunning);
    expect(groups.map((g) => g.key)).toEqual(['docs', 'dev']);
    expect(groups.find((g) => g.key === 'dev')?.sessions.map((s) => s.id)).toEqual(['a3', 'a1']);
    expect(groups.find((g) => g.key === 'docs')?.sessions.map((s) => s.id)).toEqual(['a2']);
  });

  it('groups by run status', () => {
    const groups = arrangeSessions(THREE, 'recent', 'status', agentName, isRunning);
    // The key is the group's HEADER text, so it is cased for display.
    expect(groups.map((g) => g.key)).toEqual(['Idle', 'Running']);
    expect(groups.find((g) => g.key === 'Idle')?.sessions.map((s) => s.id)).toEqual(['a2', 'a1']);
    expect(groups.find((g) => g.key === 'Running')?.sessions.map((s) => s.id)).toEqual(['a3']);
  });

  it('sort: title reorders alphabetically', () => {
    const groups = arrangeSessions(THREE, 'title', 'none', agentName, isRunning);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(['a2', 'a1', 'a3']);
  });

  it('group: none yields a single flat group', () => {
    const groups = arrangeSessions(THREE, 'recent', 'none', agentName, isRunning);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(['a2', 'a3', 'a1']);
  });
});
