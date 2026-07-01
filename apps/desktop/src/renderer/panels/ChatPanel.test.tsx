// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TurnFrame } from '@coa/console-viewmodel';
import { chatPanel, selectChatVm, toGovernedFrame } from './ChatPanel.js';
import type { ConsoleState } from './state.js';

const ChatView = chatPanel.render;
const host = {
  title: 'Chat',
  setTitle: () => {},
  onVisibilityChange: () => () => {},
  requestFocus: () => {},
};

const stateWith = (turns: ConsoleState['data']['turns']): ConsoleState => ({
  data: {
    cap: { status: 'loading' },
    flags: { status: 'loading' },
    timeline: { status: 'loading' },
    accounts: { status: 'loading' },
    turns,
  },
  ui: {
    activeMainPanelId: 'cost',
    settings: { theme: 'dark', density: 'comfortable', motion: 'full' },
  },
  actions: {
    setRoute: () => {},
    refresh: () => {},
    switchAccount: () => {},
    setSettings: () => {},
  },
});

describe('toGovernedFrame', () => {
  it('maps a text turn to a text transcript frame', () => {
    const f: TurnFrame = { id: '1', role: 'you', kind: 'text', text: 'hi' };
    expect(toGovernedFrame(f)).toMatchObject({ id: '1', role: 'you', kind: 'text', text: 'hi' });
  });

  it('maps an approval turn to an approval frame', () => {
    const f: TurnFrame = {
      id: '2',
      kind: 'approval',
      requestId: 'r1',
      tool: 'write_file',
      summary: 's',
    };
    expect(toGovernedFrame(f)).toMatchObject({ kind: 'approval', requestId: 'r1' });
  });
});

describe('selectChatVm', () => {
  it('passes loading/error through', () => {
    expect(selectChatVm(stateWith({ status: 'loading' }))).toEqual({ status: 'loading' });
    expect(selectChatVm(stateWith({ status: 'error', message: 'boom' }))).toEqual({
      status: 'error',
      message: 'boom',
    });
  });

  it('projects an ok stream into governed frames', () => {
    const vm = selectChatVm(
      stateWith({ status: 'ok', value: [{ id: '1', role: 'you', kind: 'text', text: 'hi' }] }),
    );
    expect(vm.status).toBe('ready');
    if (vm.status === 'ready') {
      expect(vm.rawMode).toBe(false);
      expect(vm.frames).toHaveLength(1);
    }
  });
});

describe('ChatView states-first', () => {
  it('skeletons while loading', () => {
    const { container } = render(<ChatView vm={{ status: 'loading' }} host={host} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows an error inline', () => {
    render(<ChatView vm={{ status: 'error', message: 'daemon down' }} host={host} />);
    expect(screen.getByText('daemon down')).toBeTruthy();
  });

  it('empty state when the stream is empty', () => {
    render(
      <ChatView
        vm={{ status: 'ready', rawMode: false, frames: [], onRespond: () => {} }}
        host={host}
      />,
    );
    expect(screen.getByText(/no conversation/i)).toBeTruthy();
  });

  it('renders the transcript log when there are frames', () => {
    render(
      <ChatView
        vm={{
          status: 'ready',
          rawMode: false,
          frames: [{ id: '1', role: 'you', kind: 'text', text: 'hi' }],
          onRespond: () => {},
        }}
        host={host}
      />,
    );
    expect(screen.getByRole('log')).toBeTruthy();
  });
});
