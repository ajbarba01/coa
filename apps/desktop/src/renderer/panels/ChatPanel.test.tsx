// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TurnFrame } from '@coa/console-viewmodel';
import { chatPanel, frameToRawLine, selectChatVm, toGovernedFrame } from './ChatPanel.js';
import type { ConsoleState } from './state.js';

const ChatView = chatPanel.render;
const host = {
  title: 'Chat',
  setTitle: () => {},
  onVisibilityChange: () => () => {},
  requestFocus: () => {},
};

const stateWith = (
  turns: ConsoleState['data']['turns'],
  ui: Partial<ConsoleState['ui']> = {},
): ConsoleState => ({
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
    rawMode: false,
    resolvedApprovals: {},
    ...ui,
  },
  actions: {
    setRoute: () => {},
    refresh: () => {},
    switchAccount: () => {},
    setSettings: () => {},
    toggleRaw: () => {},
    respondApproval: () => {},
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

describe('raw + approval projection', () => {
  const stream: TurnFrame[] = [
    { id: '1', role: 'agent', kind: 'text', text: 'hi' },
    { id: '2', kind: 'approval', requestId: 'r1', tool: 'write_file', summary: 's' },
  ];

  it('serializes each frame to a verbatim raw line', () => {
    const line = frameToRawLine({ id: '1', role: 'agent', kind: 'text', text: 'hi' });
    expect(line).toContain('agent');
    expect(line).toContain('hi');
  });

  it('reprojects the stream to raw frames in raw mode', () => {
    const vm = selectChatVm(stateWith({ status: 'ok', value: stream }, { rawMode: true }));
    expect(vm.status).toBe('ready');
    if (vm.status === 'ready') {
      expect(vm.rawMode).toBe(true);
      expect(vm.frames.every((f) => f.kind === 'raw')).toBe(true);
    }
  });

  it('overlays a resolved approval from ui state', () => {
    const vm = selectChatVm(
      stateWith({ status: 'ok', value: stream }, { resolvedApprovals: { r1: 'approved' } }),
    );
    if (vm.status === 'ready') {
      const approval = vm.frames.find((f) => f.kind === 'approval');
      expect(approval).toMatchObject({ resolved: 'approved' });
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
        vm={{
          status: 'ready',
          rawMode: false,
          frames: [],
          onRespond: () => {},
          toggleRaw: () => {},
        }}
        host={host}
      />,
    );
    expect(screen.getByText(/no conversation/i)).toBeTruthy();
  });

  it('shows a stateful raw toggle in the header and fires it', () => {
    const toggleRaw = vi.fn();
    render(
      <ChatView
        vm={{ status: 'ready', rawMode: false, frames: [], onRespond: () => {}, toggleRaw }}
        host={host}
      />,
    );
    const raw = screen.getByRole('button', { name: 'raw' });
    expect(raw.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(raw);
    expect(toggleRaw).toHaveBeenCalledTimes(1);
  });

  it('renders the transcript log when there are frames', () => {
    render(
      <ChatView
        vm={{
          status: 'ready',
          rawMode: false,
          frames: [{ id: '1', role: 'you', kind: 'text', text: 'hi' }],
          onRespond: () => {},
          toggleRaw: () => {},
        }}
        host={host}
      />,
    );
    expect(screen.getByRole('log')).toBeTruthy();
  });
});
