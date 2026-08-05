// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState } from '../panels/fixtures.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { NewSessionDialog } from './NewSession.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

const AGENTS = [
  { ref: 'roles/dev', name: 'dev', icon: 'bot', color: 'slate', scope: 'project' as const },
  { ref: 'roles/doc', name: 'docs', icon: 'bot', color: 'slate', scope: 'user' as const },
];

const AGENTS_WITH_BUILTIN = [
  ...AGENTS,
  { ref: 'general-purpose', name: 'General purpose', icon: 'bot', color: 'slate', scope: 'builtin' as const },
];

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
});

function mount(newSession = vi.fn()): ReturnType<typeof vi.fn> {
  publishConsoleState(
    makeState({ data: { agents: { status: 'ok', value: AGENTS } }, actions: { newSession } }),
  );
  useShell.getState().setNewSessionOpen(true);
  render(<NewSessionDialog />);
  return newSession;
}

describe('NewSessionDialog', () => {
  it('is closed until something opens it', () => {
    publishConsoleState(makeState({ data: { agents: { status: 'ok', value: AGENTS } } }));
    render(<NewSessionDialog />);
    expect(screen.queryByPlaceholderText(/^new session with…$/i)).toBeNull();
  });

  it('lists the agents and starts a session with the one picked', () => {
    const newSession = mount();
    fireEvent.click(screen.getByText('docs'));
    expect(newSession).toHaveBeenCalledExactlyOnceWith('roles/doc');
    expect(useShell.getState().newSessionOpen).toBe(false);
  });

  it('filters the agents as the user types', () => {
    mount();
    fireEvent.change(screen.getByPlaceholderText(/^new session with…$/i), {
      target: { value: 'doc' },
    });
    expect(screen.getByText('docs')).toBeInTheDocument();
    expect(screen.queryByText('dev')).toBeNull();
  });

  it('labels a built-in agent "Built-in", not "Personal" — the three-scope picker', () => {
    publishConsoleState(makeState({ data: { agents: { status: 'ok', value: AGENTS_WITH_BUILTIN } } }));
    useShell.getState().setNewSessionOpen(true);
    render(<NewSessionDialog />);

    expect(screen.getByText('Built-in')).toBeInTheDocument();
    expect(screen.getByText('Project')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
  });
});
