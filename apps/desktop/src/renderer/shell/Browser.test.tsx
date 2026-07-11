// @vitest-environment jsdom
import type { SessionSummary } from '@coa/console-viewmodel';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState } from '../panels/fixtures.js';
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
});

function mount(
  selectSession = vi.fn(),
  deleteSession = vi.fn(),
): { selectSession: ReturnType<typeof vi.fn>; deleteSession: ReturnType<typeof vi.fn> } {
  render(
    <Browser
      state={makeState({
        data: {
          sessions: { status: 'ok', value: SESSIONS },
          agents: { status: 'ok', value: AGENTS },
        },
        actions: { selectSession, deleteSession },
      })}
    />,
  );
  return { selectSession, deleteSession };
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

  it('clicking a row’s delete affordance calls deleteSession with that row’s id', () => {
    const { deleteSession, selectSession } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete session: wire the dock' }));
    expect(deleteSession).toHaveBeenCalledExactlyOnceWith('c1');
    // Deleting is not opening — it must not also select the session.
    expect(selectSession).not.toHaveBeenCalled();
  });

  it('picking group: status from the toolbar renders a header per run state', () => {
    render(
      <Browser
        state={makeState({
          data: {
            sessions: { status: 'ok', value: SESSIONS },
            agents: { status: 'ok', value: AGENTS },
          },
          ui: { runStatus: { c1: { since: 0 } } },
        })}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Group sessions by' }));
    const option = screen.getByRole('option', { name: 'status' });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText('idle')).toBeTruthy();
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
    expect(groups.map((g) => g.key)).toEqual(['idle', 'running']);
    expect(groups.find((g) => g.key === 'idle')?.sessions.map((s) => s.id)).toEqual(['a2', 'a1']);
    expect(groups.find((g) => g.key === 'running')?.sessions.map((s) => s.id)).toEqual(['a3']);
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
