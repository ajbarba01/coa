// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptFrame } from '@coa/console-ui';
import type { TurnFrame } from '@coa/console-viewmodel';
import {
  ChatSurface,
  formatElapsed,
  frameToRawLine,
  interleaveNotes,
  relativeTime,
  selectChatVm,
  toGovernedFrame,
} from './ChatPanel.js';
import { makeState, type StateOverrides } from './fixtures.js';
import { MOCK_AGENTS, MOCK_SESSIONS } from './mockAgents.js';
import type { ConsoleState } from './state.js';

const NOW = '2026-07-01T16:00:00Z';

const stateWith = (
  turns: ConsoleState['data']['turns'],
  ui: Partial<ConsoleState['ui']> = {},
  actions: StateOverrides['actions'] = {},
): ConsoleState =>
  makeState({
    data: {
      turns,
      agents: { status: 'ok', value: MOCK_AGENTS },
      sessions: { status: 'ok', value: MOCK_SESSIONS },
    },
    ui: { activeSessionId: 's-audit-auth', ...ui },
    actions,
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

  it('maps a plan view frame to a plan transcript frame', () => {
    expect(
      toGovernedFrame({
        id: '1',
        role: 'agent',
        kind: 'plan',
        items: [{ text: 'x', status: 'pending' }],
      }),
    ).toMatchObject({ kind: 'plan', items: [{ text: 'x', status: 'pending' }] });
  });

  it('maps a thinking view frame to a thinking transcript frame', () => {
    expect(toGovernedFrame({ id: '2', role: 'agent', kind: 'thinking', text: 'hmm' })).toMatchObject(
      { kind: 'thinking', text: 'hmm' },
    );
  });

  it('renders every new kind to a raw line without throwing', () => {
    for (const f of [
      { id: '1', role: 'agent', kind: 'thinking', text: 't' },
      { id: '2', role: 'agent', kind: 'error', message: 'e' },
      { id: '3', role: 'agent', kind: 'plan', items: [{ text: 'p', status: 'done' }] },
      { id: '4', kind: 'subagent', childWorktree: 'w', event: 'spawn' },
    ] as const) {
      expect(typeof frameToRawLine(f)).toBe('string');
    }
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

  it('reports running status while a send is in flight', () => {
    const vm = selectChatVm(
      stateWith({ status: 'ok', value: [] }, { runStatus: { 's-audit-auth': { since: 1000 } } }),
    );
    expect(vm.status === 'ready' && vm.sessionStatus).toBe('running');
    expect(vm.status === 'ready' && vm.runningSince).toBe(1000);
  });

  it('reports idle status with no in-flight send', () => {
    const vm = selectChatVm(stateWith({ status: 'ok', value: [] }));
    expect(vm.status === 'ready' && vm.sessionStatus).toBe('idle');
    expect(vm.status === 'ready' && vm.runningSince).toBeUndefined();
  });

  it('does not show running when only a background session has run status', () => {
    const vm = selectChatVm(
      stateWith({ status: 'ok', value: [] }, { runStatus: { 's-other-session': { since: 1000 } } }),
    );
    expect(vm.status === 'ready' && vm.sessionStatus).toBe('idle');
    expect(vm.status === 'ready' && vm.runningSince).toBeUndefined();
  });

  it('routes onInterrupt to interruptSession for the active session (the Stop/Esc affordance)', () => {
    const interruptSession = vi.fn();
    const vm = selectChatVm(
      stateWith({ status: 'ok', value: [] }, {}, { interruptSession }),
    );
    if (vm.status === 'ready') {
      vm.onInterrupt();
      expect(interruptSession).toHaveBeenCalledExactlyOnceWith('s-audit-auth');
    }
  });

  it('onInterrupt is a no-op with no active session', () => {
    const interruptSession = vi.fn();
    const vm = selectChatVm(
      makeState({
        data: {
          turns: { status: 'ok', value: [] },
          agents: { status: 'ok', value: MOCK_AGENTS },
          sessions: { status: 'ok', value: [] },
        },
        ui: {},
        actions: { interruptSession },
      }),
    );
    if (vm.status === 'ready') {
      vm.onInterrupt();
      expect(interruptSession).not.toHaveBeenCalled();
    }
  });

  it('interleaves a "switched model" note into the governed frames at its recorded position', () => {
    const vm = selectChatVm(
      stateWith(
        {
          status: 'ok',
          value: [
            { id: '1', role: 'you', kind: 'text', text: 'hi' },
            { id: '2', role: 'agent', kind: 'text', text: 'hello' },
          ],
        },
        { notesBySession: { 's-audit-auth': [{ afterCount: 1, text: 'switched to Opus 4.8 · high' }] } },
      ),
    );
    if (vm.status === 'ready') {
      expect(vm.frames.map((f) => f.kind)).toEqual(['text', 'note', 'text']);
      const note = vm.frames[1];
      expect(note && note.kind === 'note' ? note.text : undefined).toBe(
        'switched to Opus 4.8 · high',
      );
    }
  });

  it('omits switched-model notes in raw mode (raw stays verbatim loop output)', () => {
    const vm = selectChatVm(
      stateWith(
        { status: 'ok', value: [{ id: '1', role: 'you', kind: 'text', text: 'hi' }] },
        {
          rawMode: true,
          notesBySession: { 's-audit-auth': [{ afterCount: 0, text: 'switched to Opus 4.8 · high' }] },
        },
      ),
    );
    if (vm.status === 'ready') {
      expect(vm.frames.every((f) => f.kind === 'raw')).toBe(true);
      expect(vm.frames.some((f) => f.kind === 'note')).toBe(false);
    }
  });

  it('keeps stable frame identity for unchanged turns across renders (memo regression guard)', () => {
    const turns: TurnFrame[] = [
      { id: '1', role: 'you', kind: 'text', text: 'hi' },
      { id: '2', role: 'agent', kind: 'text', text: 'hello' },
    ];
    const state1 = stateWith({ status: 'ok', value: turns });
    const vm1 = selectChatVm(state1);
    // Simulate a later daemon push: previously-seen turns keep object identity
    // (appendTurns builds [...prev, ...new]); only the new turn is a new object.
    const turns2: TurnFrame[] = [...turns, { id: '3', role: 'agent', kind: 'text', text: 'more' }];
    const state2 = stateWith({ status: 'ok', value: turns2 });
    const vm2 = selectChatVm(state2);
    expect(vm1.status).toBe('ready');
    expect(vm2.status).toBe('ready');
    if (vm1.status === 'ready' && vm2.status === 'ready') {
      expect(vm2.frames.length).toBe(vm1.frames.length + 1);
      expect(vm2.frames[0]).toBe(vm1.frames[0]);
      expect(vm2.frames[1]).toBe(vm1.frames[1]);
    }
  });

  it('keeps stable frame identity for unchanged turns in raw mode too', () => {
    const turns: TurnFrame[] = [
      { id: '1', role: 'you', kind: 'text', text: 'hi' },
      { id: '2', role: 'agent', kind: 'text', text: 'hello' },
    ];
    const state1 = stateWith({ status: 'ok', value: turns }, { rawMode: true });
    const vm1 = selectChatVm(state1);
    const turns2: TurnFrame[] = [...turns, { id: '3', role: 'agent', kind: 'text', text: 'more' }];
    const state2 = stateWith({ status: 'ok', value: turns2 }, { rawMode: true });
    const vm2 = selectChatVm(state2);
    expect(vm1.status).toBe('ready');
    expect(vm2.status).toBe('ready');
    if (vm1.status === 'ready' && vm2.status === 'ready') {
      expect(vm2.frames.length).toBe(vm1.frames.length + 1);
      expect(vm2.frames[0]).toBe(vm1.frames[0]);
      expect(vm2.frames[1]).toBe(vm1.frames[1]);
    }
  });
});

describe('interleaveNotes', () => {
  const frames: TranscriptFrame[] = [
    { id: 't1', role: 'you', kind: 'text', text: 'first' },
    { id: 't2', role: 'agent', kind: 'text', text: 'reply' },
    { id: 't3', role: 'you', kind: 'text', text: 'second' },
  ];

  it('splices a note in after its afterCount-th frame', () => {
    const result = interleaveNotes(
      frames,
      [{ afterCount: 2, text: 'switched to Opus 4.8 · high' }],
      's1',
    );
    expect(result.map((f) => f.id)).toEqual(['t1', 't2', 'note:s1:0', 't3']);
    expect(result[2]).toMatchObject({ kind: 'note', text: 'switched to Opus 4.8 · high' });
  });

  it('is a no-op with no notes', () => {
    expect(interleaveNotes(frames, [])).toEqual(frames);
  });

  it('inserts a note at position 0 (afterCount 0)', () => {
    const result = interleaveNotes(frames, [{ afterCount: 0, text: 'switched to Sonnet' }]);
    expect(result[0]).toMatchObject({ kind: 'note' });
    expect(result.map((f) => f.id).slice(1)).toEqual(['t1', 't2', 't3']);
  });

  it('inserts multiple notes at their respective positions, stably ordered', () => {
    const result = interleaveNotes(frames, [
      { afterCount: 1, text: 'first switch' },
      { afterCount: 3, text: 'second switch' },
    ]);
    expect(result.map((f) => (f.kind === 'note' ? f.text : f.id))).toEqual([
      't1',
      'first switch',
      't2',
      't3',
      'second switch',
    ]);
  });

  it('appends a note whose afterCount exceeds the frame count at the end', () => {
    const result = interleaveNotes(frames, [{ afterCount: 99, text: 'late note' }]);
    expect(result.at(-1)).toMatchObject({ kind: 'note', text: 'late note' });
    expect(result).toHaveLength(4);
  });
});

describe('formatElapsed', () => {
  it('formats elapsed seconds for the running pill', () => {
    expect(formatElapsed(1000, 4200)).toBe('3s'); // (4200-1000)/1000 floored
  });
});

describe('relativeTime', () => {
  it('renders compact ages', () => {
    expect(relativeTime('2026-07-01T15:59:40Z', NOW)).toBe('now');
    expect(relativeTime('2026-07-01T15:10:00Z', NOW)).toBe('50m');
    expect(relativeTime('2026-07-01T09:30:00Z', NOW)).toBe('6h');
    expect(relativeTime('2026-06-28T09:30:00Z', NOW)).toBe('3d');
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

  it('surfaces an unresolved approval as vm.approval and omits it from vm.frames', () => {
    const vm = selectChatVm(stateWith({ status: 'ok', value: stream }));
    if (vm.status === 'ready') {
      expect(vm.approval).toMatchObject({ id: 'r1', tool: 'write_file', summary: 's' });
      expect(vm.frames.some((f) => f.kind === 'approval')).toBe(false);
      // The text frame that isn't the approval is untouched.
      expect(vm.frames).toHaveLength(1);
    }
  });

  it('leaves vm.approval undefined and keeps the frame when the approval is resolved', () => {
    const vm = selectChatVm(
      stateWith({ status: 'ok', value: stream }, { resolvedApprovals: { r1: 'approved' } }),
    );
    if (vm.status === 'ready') {
      expect(vm.approval).toBeUndefined();
      expect(vm.frames.some((f) => f.kind === 'approval')).toBe(true);
    }
  });

  it('surfaces the newest unresolved approval when more than one is pending', () => {
    const twoApprovals: TurnFrame[] = [
      { id: '1', kind: 'approval', requestId: 'r1', tool: 'write_file', summary: 'first' },
      { id: '2', role: 'agent', kind: 'text', text: 'hi' },
      { id: '3', kind: 'approval', requestId: 'r2', tool: 'bash', summary: 'second' },
    ];
    const vm = selectChatVm(stateWith({ status: 'ok', value: twoApprovals }));
    if (vm.status === 'ready') {
      expect(vm.approval).toMatchObject({ id: 'r2', tool: 'bash', summary: 'second' });
    }
  });

  it('does not surface vm.approval in raw mode (raw stays untouched)', () => {
    const vm = selectChatVm(stateWith({ status: 'ok', value: stream }, { rawMode: true }));
    if (vm.status === 'ready') {
      expect(vm.approval).toBeUndefined();
      expect(vm.frames).toHaveLength(2);
    }
  });

  it('derives the drift banner from a config mismatch and routes its action to the active session', () => {
    const onBannerAction = vi.fn();
    const agent = {
      ref: 'a/x', name: 'x', icon: 'bot' as const, color: 'slate' as const,
      scope: 'personal' as const, roles: ['swe'], packageIds: ['research'],
    };
    const vm = selectChatVm(
      makeState({
        data: {
          turns: { status: 'ok', value: [] },
          agents: { status: 'ok', value: [agent] },
          sessions: {
            status: 'ok',
            value: [{ id: 's1', agentRef: 'a/x', title: 't', updatedAt: NOW, promptConfig: { roles: ['swe'] } }],
          },
        },
        ui: { activeSessionId: 's1' },
        actions: { onBannerAction },
      }),
      NOW,
    );
    if (vm.status === 'ready') {
      expect(vm.banners.some((b) => b.kind === 'drift')).toBe(true);
      vm.onBannerAction('drift', 'recompile');
      expect(onBannerAction).toHaveBeenCalledWith('s1', 'drift', 'recompile');
    }
  });

  it('exposes the merged model list + current model and re-pins the session on pick', () => {
    const setSessionModel = vi.fn();
    const vm = selectChatVm(
      makeState({
        data: {
          turns: { status: 'ok', value: [] },
          agents: { status: 'ok', value: MOCK_AGENTS },
          sessions: { status: 'ok', value: MOCK_SESSIONS },
          models: {
            status: 'ok',
            value: [
              { id: 'deepseek-v4-pro', provider: 'deepseek' },
              { id: 'opus', provider: 'claude' },
            ],
          },
        },
        ui: { activeSessionId: 's-audit-auth' },
        actions: { setSessionModel },
      }),
    );
    if (vm.status === 'ready') {
      expect(vm.models.map((m) => m.id)).toContain('deepseek-v4-pro');
      // Picking a model carries its provider so the session switches backend as a unit.
      vm.onPickModel('deepseek-v4-pro');
      expect(setSessionModel).toHaveBeenCalledWith('s-audit-auth', {
        model: 'deepseek-v4-pro',
        provider: 'deepseek',
      });
    }
  });

  it('exposes effort options + value for an effort-capable model, and picking one sets the session reasoning', () => {
    const setSessionModel = vi.fn();
    const vm = selectChatVm(
      makeState({
        data: {
          turns: { status: 'ok', value: [] },
          agents: { status: 'ok', value: MOCK_AGENTS },
          sessions: { status: 'ok', value: MOCK_SESSIONS },
          models: {
            status: 'ok',
            value: [
              {
                id: 'sonnet',
                provider: 'claude',
                supportsEffort: true,
                supportedEffortLevels: ['low', 'medium', 'high'],
              },
            ],
          },
        },
        ui: { activeSessionId: 's-audit-auth' },
        actions: { setSessionModel },
      }),
    );
    if (vm.status === 'ready') {
      expect(vm.effortOptions).toEqual([
        { value: 'off', label: 'No thinking' },
        { value: 'low', label: 'low' },
        { value: 'medium', label: 'medium' },
        { value: 'high', label: 'high' },
      ]);
      expect(vm.effortValue).toBe('off');
      vm.onPickEffort('high');
      expect(setSessionModel).toHaveBeenCalledWith('s-audit-auth', {
        reasoning: { mode: 'effort', effort: 'high' },
      });
    }
  });
});

describe('ChatSurface states-first', () => {
  const readyState = (turns: TurnFrame[], ui: Partial<ConsoleState['ui']> = {}) =>
    stateWith({ status: 'ok', value: turns }, ui);

  it('skeletons while loading', () => {
    const { container } = render(<ChatSurface state={stateWith({ status: 'loading' })} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows an error inline', () => {
    render(<ChatSurface state={stateWith({ status: 'error', message: 'daemon down' })} />);
    expect(screen.getByText('daemon down')).toBeTruthy();
  });

  it('empty state teaches the register: agent, model/effort/permission, and the key hints', () => {
    render(<ChatSurface state={readyState([])} />);
    // "{agent} is ready" — the reviewer session's agent.
    expect(screen.getByText(/is ready/i)).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === 'B' && el.textContent === 'reviewer')).toBeTruthy();
    // model · effort · permission line.
    expect(screen.getByText(/sonnet.*ask edits/)).toBeTruthy();
    // send / newline / commands hints.
    expect(screen.getByText('send')).toBeTruthy();
    expect(screen.getByText('newline')).toBeTruthy();
    expect(screen.getByText('commands')).toBeTruthy();
  });

  it('renders the transcript log when there are frames', () => {
    render(<ChatSurface state={readyState([{ id: '1', role: 'you', kind: 'text', text: 'hi' }])} />);
    expect(screen.getByRole('log')).toBeTruthy();
  });

  it('carries no duplicate session-switching chrome — the shell owns that now', () => {
    render(<ChatSurface state={readyState([{ id: '1', role: 'you', kind: 'text', text: 'hi' }])} />);
    // No pane title bar naming the surface "Chat" (the shell's tab strip already does).
    expect(screen.queryByText('Chat')).toBeNull();
    // No in-pane session switcher trigger.
    expect(screen.queryByRole('button', { name: 'Switch session' })).toBeNull();
    // No agent rail.
    expect(screen.queryByRole('group', { name: 'Agents' })).toBeNull();
    // The transcript + composer still render.
    expect(screen.getByRole('log')).toBeTruthy();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('renders the new composer (its model chip), not the old console-ui Combobox', () => {
    render(<ChatSurface state={readyState([])} />);
    // The new composer's model chip — a plain button, not a native combobox.
    expect(screen.getByRole('button', { name: 'sonnet' })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  // A session + agent whose configs diverge, so the derived drift banner shows.
  const DRIFT_AGENT = {
    ref: 'a/x',
    name: 'x',
    icon: 'bot' as const,
    color: 'slate' as const,
    scope: 'personal' as const,
    roles: ['swe'],
    packageIds: ['research'],
  };
  const driftState = (ui: Partial<ConsoleState['ui']> = {}, actions = {}) =>
    makeState({
      data: {
        turns: { status: 'ok', value: [] },
        agents: { status: 'ok', value: [DRIFT_AGENT] },
        sessions: {
          status: 'ok',
          value: [
            { id: 's1', agentRef: 'a/x', title: 't', updatedAt: NOW, provider: 'claude', model: 'opus', promptConfig: { roles: ['swe'] } },
          ],
        },
      },
      ui: { activeSessionId: 's1', ...ui },
      actions,
    });

  // `ChatSurface` computes `now` internally (no seam by design), so the banner tests pin
  // the wall clock to the fixture's `updatedAt` — otherwise the fixed timestamp drifts past
  // the provider cache TTL and a spurious idle cache banner joins every scenario. Only
  // `Date` is faked: userEvent awaits real setTimeout ticks.
  const pinClock = (): void => void vi.useFakeTimers({ now: new Date(NOW), toFake: ['Date'] });
  afterEach(() => vi.useRealTimers());

  it('derives the drift banner when the config diverges, offering recompile + dismiss', async () => {
    pinClock();
    const onBannerAction = vi.fn();
    const { container } = render(<ChatSurface state={driftState({}, { onBannerAction })} />);
    expect(screen.getByText(/agent configuration changed/i)).toBeTruthy();
    // Drift-only scenario: the session ran on this config just now, so no cache banner —
    // exactly one banner card renders.
    expect(screen.queryByText(/cold prompt cache/i)).toBeNull();
    expect(container.querySelectorAll('[data-tone="warning"]')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Recompile' }));
    expect(onBannerAction).toHaveBeenCalledWith('s1', 'drift', 'recompile');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onBannerAction).toHaveBeenCalledWith('s1', 'drift', 'dismiss');
  });

  it('picks a model through the composer model chip, re-pinning the session', async () => {
    const setSessionModel = vi.fn();
    const state = makeState({
      data: {
        turns: { status: 'ok', value: [] },
        agents: { status: 'ok', value: MOCK_AGENTS },
        sessions: { status: 'ok', value: MOCK_SESSIONS },
        models: {
          status: 'ok',
          value: [
            { id: 'sonnet', provider: 'claude' },
            { id: 'opus', provider: 'claude' },
          ],
        },
      },
      ui: { activeSessionId: 's-audit-auth' },
      actions: { setSessionModel },
    });
    render(<ChatSurface state={state} />);
    // The reviewer session's agent default (sonnet) seeds the chip.
    await userEvent.click(screen.getByRole('button', { name: 'Claude · sonnet' }));
    await userEvent.click(screen.getByRole('button', { name: 'Claude · opus' }));
    expect(setSessionModel).toHaveBeenCalledWith('s-audit-auth', { model: 'opus', provider: 'claude' });
  });

  it('derives a passive cache banner on a staged switch (no dismiss control)', () => {
    pinClock();
    render(
      <ChatSurface
        state={driftState({
          modelOverride: { s1: { provider: 'deepseek', model: 'deepseek-v4-pro' } },
        })}
      />,
    );
    const cacheReason = screen.getByText(/cold prompt cache/i);
    // Exactly the staged-switch reason — a pinned clock proves no idle-staleness reason
    // rides along (the session "ran" at NOW).
    expect(cacheReason.textContent).toContain('the backend changed');
    expect(cacheReason.textContent).not.toContain('idle');
    // The cache notice is informational — it has no close control (auto-clears on send/revert).
    const cacheCard = cacheReason.closest('[data-tone]');
    expect(cacheCard?.querySelector('[aria-label="Dismiss"]')).toBeNull();
  });

  it('the dedicated Stop control while running wires to interruptSession (SC-1, not an error affordance)', async () => {
    const interruptSession = vi.fn();
    const state = stateWith(
      { status: 'ok', value: [] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { interruptSession },
    );
    render(<ChatSurface state={state} />);
    const stop = screen.getByRole('button', { name: /stop/i });
    // The Stop control is a clean-stop affordance, not the danger tone an error surface would
    // use (SC-1: a user stop, never a governance block).
    expect(stop.className).not.toMatch(/danger/);
    await userEvent.click(stop);
    expect(interruptSession).toHaveBeenCalledExactlyOnceWith('s-audit-auth');
  });

  it('the barge-in button redirects the running turn via steerSession', async () => {
    const steerSession = vi.fn();
    const state = stateWith(
      { status: 'ok', value: [] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    render(<ChatSurface state={state} />);
    await userEvent.type(screen.getByRole('textbox'), 'go check the tests instead');
    await userEvent.click(screen.getByRole('button', { name: /barge in/i }));
    expect(steerSession).toHaveBeenCalledExactlyOnceWith('s-audit-auth', 'go check the tests instead');
  });

  it('Queue pins the message (no daemon steer) and releases it as a send when the turn ends', async () => {
    const steerSession = vi.fn();
    const sendMessage = vi.fn();
    const running = stateWith(
      { status: 'ok', value: [] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession, sendMessage },
    );
    const { rerender } = render(<ChatSurface state={running} />);
    await userEvent.type(screen.getByRole('textbox'), 'also add a test');
    await userEvent.click(screen.getByRole('button', { name: /queue/i }));
    // queued: pinned in the UI, not sent to the daemon yet
    expect(steerSession).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.getByText('also add a test')).toBeInTheDocument();
    // the turn ends → the session goes idle → the queued message is released as a normal send
    const idle = stateWith({ status: 'ok', value: [] }, {}, { steerSession, sendMessage });
    rerender(<ChatSurface state={idle} />);
    expect(sendMessage).toHaveBeenCalledWith('also add a test');
  });

  it('shows Send (not Queue/Barge/Stop) while idle', () => {
    render(<ChatSurface state={readyState([])} />);
    expect(screen.getByRole('button', { name: /send/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /queue/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /barge in/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /stop the running turn/i })).toBeNull();
  });

  it('Esc interrupts the active session while a turn is running', async () => {
    const interruptSession = vi.fn();
    const state = stateWith(
      { status: 'ok', value: [] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { interruptSession },
    );
    render(<ChatSurface state={state} />);
    await userEvent.type(screen.getByRole('textbox'), '{Escape}');
    expect(interruptSession).toHaveBeenCalledExactlyOnceWith('s-audit-auth');
  });

  describe('the docked pending approval', () => {
    const approvalStream: TurnFrame[] = [
      { id: '1', role: 'agent', kind: 'text', text: 'about to write' },
      { id: '2', kind: 'approval', requestId: 'r1', tool: 'write_file', summary: 'src/auth.ts' },
    ];

    it('never renders a pending-approval card in the transcript — the composer owns it', () => {
      render(<ChatSurface state={stateWith({ status: 'ok', value: approvalStream })} />);
      // The old transcript card used capitalized "Approve"/"Deny" buttons; those are gone.
      expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
      // The composer's merged gate is what's showing instead.
      expect(screen.getByRole('button', { name: /^approve:/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /^deny:/ })).toBeTruthy();
    });

    it('approving via the composer calls onRespond(requestId, "approve")', async () => {
      const respondApproval = vi.fn();
      const state = stateWith({ status: 'ok', value: approvalStream }, {}, { respondApproval });
      render(<ChatSurface state={state} />);
      await userEvent.click(screen.getByRole('button', { name: /^approve:/ }));
      expect(respondApproval).toHaveBeenCalledExactlyOnceWith('r1', 'approve');
    });

    it('denying via the composer calls onRespond(requestId, "deny")', async () => {
      const respondApproval = vi.fn();
      const state = stateWith({ status: 'ok', value: approvalStream }, {}, { respondApproval });
      render(<ChatSurface state={state} />);
      await userEvent.click(screen.getByRole('button', { name: /^deny:/ }));
      expect(respondApproval).toHaveBeenCalledExactlyOnceWith('r1', 'deny');
    });

    it('redirecting denies the request then sends the typed instruction in its place', async () => {
      const respondApproval = vi.fn();
      const sendMessage = vi.fn();
      const state = stateWith(
        { status: 'ok', value: approvalStream },
        {},
        { respondApproval, sendMessage },
      );
      render(<ChatSurface state={state} />);
      await userEvent.type(screen.getByRole('textbox'), 'do this instead{Enter}');
      expect(respondApproval).toHaveBeenCalledExactlyOnceWith('r1', 'deny');
      expect(sendMessage).toHaveBeenCalledExactlyOnceWith('do this instead');
    });
  });
});

describe('toGovernedFrame streaming', () => {
  it('carries the streaming flag onto the governed text frame', () => {
    const f = { id: 'a', role: 'agent', kind: 'text', text: 'hi', streaming: true } as TurnFrame;
    expect(toGovernedFrame(f)).toMatchObject({ kind: 'text', text: 'hi', streaming: true });
  });
  it('carries the streaming flag onto the governed thinking frame', () => {
    const f = { id: 'b', role: 'agent', kind: 'thinking', text: 'po', streaming: true } as TurnFrame;
    expect(toGovernedFrame(f)).toMatchObject({ kind: 'thinking', text: 'po', streaming: true });
  });
  it('omits streaming for a settled text frame', () => {
    const f = { id: 'c', role: 'agent', kind: 'text', text: 'hi' } as TurnFrame;
    expect((toGovernedFrame(f) as { streaming?: boolean }).streaming).toBeUndefined();
  });
});
