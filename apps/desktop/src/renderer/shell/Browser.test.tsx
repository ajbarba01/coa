// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState } from '../panels/fixtures.js';
import { Browser } from './Browser.js';
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

function mount(selectSession = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <Browser
      state={makeState({
        data: {
          sessions: { status: 'ok', value: SESSIONS },
          agents: { status: 'ok', value: AGENTS },
        },
        actions: { selectSession },
      })}
    />,
  );
  return selectSession;
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
    const selectSession = mount();
    fireEvent.click(screen.getByText('wire the dock'));
    expect(selectSession).toHaveBeenCalledWith('c1');
    expect(useShell.getState().mode).toBe('work');
  });
});
