// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptFrame } from '@coa/console-transcript';
import { pushSchema, pushToViewFrames, type TurnFrame } from '@coa/console-viewmodel';
import {
  ChatSurface,
  composerMeasure,
  formatElapsed,
  frameToRawLine,
  interleaveNotes,
  relativeTime,
  selectChatVm,
  toGovernedFrame,
} from './ChatPanel.js';
import { useShell } from '../shell/store.js';
import { setActiveSession } from '../store/sessions.js';
import { appendFrames, useTranscripts } from '../store/transcripts.js';
import { makeState, resetStores, seedState, type StateOverrides } from '../testing/fixtures.js';
import { MOCK_AGENTS, MOCK_SESSIONS } from '../testing/mockAgents.js';
import type { ConsoleState } from './state.js';

const NOW = '2026-07-01T16:00:00Z';

// The open-tab list derives from the shell store, and every mounted tab draws from the
// transcript slice — reset both per test so one test's tabs never leave extra (hidden)
// transcripts mounted in the next.
const initialShell = useShell.getState();
beforeEach(() => {
  useShell.setState(initialShell, true);
  resetStores();
});

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

  it('maps a system-role text turn (e.g. a child-ended notice) to the quiet note presentation, never a chat bubble', () => {
    const f: TurnFrame = {
      id: '9',
      role: 'system',
      kind: 'text',
      text: 'subagent roles/reviewer (child-1) finished. Read its transcript for the result.',
    };
    expect(toGovernedFrame(f)).toEqual({
      id: '9',
      kind: 'note',
      text: 'subagent roles/reviewer (child-1) finished. Read its transcript for the result.',
    });
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
    expect(
      toGovernedFrame({ id: '2', role: 'agent', kind: 'thinking', text: 'hmm' }),
    ).toMatchObject({ kind: 'thinking', text: 'hmm' });
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
    const vm = selectChatVm(stateWith({ status: 'ok', value: [] }, {}, { interruptSession }));
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
        {
          notesBySession: {
            's-audit-auth': [{ afterCount: 1, text: 'switched to Opus 4.8 · high' }],
          },
        },
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
          notesBySession: {
            's-audit-auth': [{ afterCount: 0, text: 'switched to Opus 4.8 · high' }],
          },
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
      ref: 'a/x',
      name: 'x',
      icon: 'bot' as const,
      color: 'slate' as const,
      scope: 'personal' as const,
      roles: ['swe'],
      packageIds: ['research'],
    };
    const vm = selectChatVm(
      makeState({
        data: {
          turns: { status: 'ok', value: [] },
          agents: { status: 'ok', value: [agent] },
          sessions: {
            status: 'ok',
            value: [
              {
                id: 's1',
                agentRef: 'a/x',
                title: 't',
                updatedAt: NOW,
                promptConfig: { roles: ['swe'] },
              },
            ],
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
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ]);
      expect(vm.effortValue).toBe('off');
      vm.onPickEffort('high');
      expect(setSessionModel).toHaveBeenCalledWith('s-audit-auth', {
        reasoning: { mode: 'effort', effort: 'high' },
      });
    }
  });
});

describe('F2 — live permission mode + pending approval', () => {
  it('surfaces a LIVE pending approval (a real daemon push) as vm.approval', () => {
    const vm = selectChatVm(
      stateWith(
        { status: 'ok', value: [] },
        {
          pendingApprovalsBySession: {
            's-audit-auth': [{ requestId: 'live-1', tool: 'apply_patch', summary: 'src/auth.ts' }],
          },
        },
      ),
    );
    if (vm.status === 'ready') {
      expect(vm.approval).toEqual({ id: 'live-1', tool: 'apply_patch', summary: 'src/auth.ts' });
    }
  });

  it('the live source wins over any transcript-frame-derived approval', () => {
    const frameStream: TurnFrame[] = [
      {
        id: '1',
        kind: 'approval',
        requestId: 'frame-1',
        tool: 'write_file',
        summary: 'from a frame',
      },
    ];
    const vm = selectChatVm(
      stateWith(
        { status: 'ok', value: frameStream },
        {
          pendingApprovalsBySession: {
            's-audit-auth': [{ requestId: 'live-1', tool: 'bash', summary: 'a live ask' }],
          },
        },
      ),
    );
    if (vm.status === 'ready') {
      expect(vm.approval).toMatchObject({ id: 'live-1' });
    }
  });

  it('docks the OLDEST pending live approval (FIFO — the longest-waiting ask is what blocks the session)', () => {
    const vm = selectChatVm(
      stateWith(
        { status: 'ok', value: [] },
        {
          pendingApprovalsBySession: {
            's-audit-auth': [
              { requestId: 'first', tool: 'write_file', summary: 'a' },
              { requestId: 'second', tool: 'bash', summary: 'b' },
            ],
          },
        },
      ),
    );
    if (vm.status === 'ready') {
      expect(vm.approval).toMatchObject({ id: 'first' });
    }
  });

  it('never surfaces a live pending approval in raw mode (raw stays untouched)', () => {
    const vm = selectChatVm(
      stateWith(
        { status: 'ok', value: [] },
        {
          rawMode: true,
          pendingApprovalsBySession: {
            's-audit-auth': [{ requestId: 'live-1', tool: 'bash', summary: 's' }],
          },
        },
      ),
    );
    if (vm.status === 'ready') expect(vm.approval).toBeUndefined();
  });

  it("falls back to the active agent's configured default mode before the daemon hydrates", () => {
    // roles/reviewer (s-audit-auth's agent) sets no defaultMode — the system floor, manual.
    const vm = selectChatVm(stateWith({ status: 'ok', value: [] }));
    if (vm.status === 'ready') {
      expect(vm.mode).toBe('manual');
      expect(vm.effectiveMode).toBe('manual');
      expect(vm.modeDegraded).toBeUndefined();
    }
  });

  it('reflects the daemon-pushed/hydrated permission mode once known', () => {
    const vm = selectChatVm(
      stateWith(
        { status: 'ok', value: [] },
        { modeBySession: { 's-audit-auth': { mode: 'edits', effectiveMode: 'edits' } } },
      ),
    );
    if (vm.status === 'ready') {
      expect(vm.mode).toBe('edits');
      expect(vm.effectiveMode).toBe('edits');
    }
  });

  it('honestly reflects a degraded mode: effectiveMode (not the merely-configured mode) is what the vm carries, with the reason', () => {
    const vm = selectChatVm(
      stateWith(
        { status: 'ok', value: [] },
        {
          modeBySession: {
            's-audit-auth': {
              mode: 'plan',
              effectiveMode: 'bypass',
              degraded: 'the active backend has no approval seam — enforcement degrades to bypass',
            },
          },
        },
      ),
    );
    if (vm.status === 'ready') {
      expect(vm.mode).toBe('plan');
      expect(vm.effectiveMode).toBe('bypass');
      expect(vm.modeDegraded).toBe(
        'the active backend has no approval seam — enforcement degrades to bypass',
      );
    }
  });

  it('onSetMode proxies setPermissionMode for the active session', () => {
    const setPermissionMode = vi.fn();
    const vm = selectChatVm(stateWith({ status: 'ok', value: [] }, {}, { setPermissionMode }));
    if (vm.status === 'ready') {
      vm.onSetMode('bypass');
      expect(setPermissionMode).toHaveBeenCalledExactlyOnceWith('s-audit-auth', 'bypass');
    }
  });

  describe('the docked pending approval — a LIVE daemon push (the real F2 round trip)', () => {
    it('renders the composer gate from a live pending approval', () => {
      const state = stateWith(
        { status: 'ok', value: [] },
        {
          pendingApprovalsBySession: {
            's-audit-auth': [{ requestId: 'live-1', tool: 'apply_patch', summary: 'src/auth.ts' }],
          },
        },
      );
      seedState(state);
      render(<ChatSurface />);
      expect(screen.getByRole('button', { name: /^approve:/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /^deny:/i })).toBeTruthy();
    });

    it('approving calls respondApproval(requestId, "approve")', async () => {
      const respondApproval = vi.fn();
      const state = stateWith(
        { status: 'ok', value: [] },
        {
          pendingApprovalsBySession: {
            's-audit-auth': [{ requestId: 'live-1', tool: 'apply_patch', summary: 'src/auth.ts' }],
          },
        },
        { respondApproval },
      );
      seedState(state);
      render(<ChatSurface />);
      await userEvent.click(screen.getByRole('button', { name: /^approve:/i }));
      expect(respondApproval).toHaveBeenCalledExactlyOnceWith('live-1', 'approve');
    });

    it('denying calls respondApproval(requestId, "deny")', async () => {
      const respondApproval = vi.fn();
      const state = stateWith(
        { status: 'ok', value: [] },
        {
          pendingApprovalsBySession: {
            's-audit-auth': [{ requestId: 'live-1', tool: 'bash', summary: 'rm the temp dir' }],
          },
        },
        { respondApproval },
      );
      seedState(state);
      render(<ChatSurface />);
      await userEvent.click(screen.getByRole('button', { name: /^deny:/i }));
      expect(respondApproval).toHaveBeenCalledExactlyOnceWith('live-1', 'deny');
    });
  });

  describe('the composer permission-mode chip', () => {
    it("renders the session's effective mode, honestly, even when degraded", () => {
      const state = stateWith(
        { status: 'ok', value: [] },
        {
          modeBySession: {
            's-audit-auth': {
              mode: 'plan',
              effectiveMode: 'bypass',
              degraded: 'the active backend has no approval seam — enforcement degrades to bypass',
            },
          },
        },
      );
      seedState(state);
      render(<ChatSurface />);
      expect(screen.getByRole('button', { name: 'Bypass' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull();
    });

    it('switching mode via the chip calls setPermissionMode for the active session', async () => {
      const setPermissionMode = vi.fn();
      const state = stateWith({ status: 'ok', value: [] }, {}, { setPermissionMode });
      seedState(state);
      render(<ChatSurface />);
      // s-audit-auth's agent (roles/reviewer) sets no default — the trigger starts on manual.
      await userEvent.click(screen.getByRole('button', { name: 'Manual' }));
      await userEvent.click(screen.getByText('Plan'));
      expect(setPermissionMode).toHaveBeenCalledExactlyOnceWith('s-audit-auth', 'plan');
    });
  });
});

describe('composerMeasure', () => {
  it('keeps the last real measure through a hidden (zero-height) pass', () => {
    // display:none passes report 0 — accepting them collapses the transcript's
    // reserve spacer, and its return re-pins the view (the visible jump on
    // exiting search).
    expect(composerMeasure(120, 0)).toBe(120);
    expect(composerMeasure(120, 96)).toBe(96);
    expect(composerMeasure(0, 84)).toBe(84);
  });
});

describe('ChatSurface materialized tabs', () => {
  const turn = (id: string, text: string): TurnFrame => ({
    id,
    role: 'agent',
    kind: 'text',
    text,
  });

  /** Two open tabs, each with its own materialized transcript. */
  const twoOpenTabs = (): void => {
    useShell.setState({ tabs: ['s-audit-auth', 's-auth-refactor'] });
    seedState(stateWith({ status: 'ok', value: [turn('t1', 'alpha-transcript')] }));
    useTranscripts.setState((t) => ({
      bySession: {
        ...t.bySession,
        's-auth-refactor': { status: 'ok', value: [turn('t2', 'beta-transcript')] },
      },
    }));
  };

  it('mounts every open tab, so the hidden one is real DOM rather than a snapshot', () => {
    twoOpenTabs();
    render(<ChatSurface />);
    expect(screen.getByText('alpha-transcript')).toBeInTheDocument();
    expect(screen.getByText('beta-transcript')).toBeInTheDocument();
  });

  it('switching to an already-materialized tab paints it with nothing awaited', () => {
    twoOpenTabs();
    render(<ChatSurface />);
    const alphaHost = screen.getByText('alpha-transcript').closest('div.h-full');
    expect(alphaHost).not.toBeNull();

    // The only thing a switch does: flip the active id. No reload, no await — the tab it
    // moves to is already drawn, so this is a display swap (the instant-navigation rule).
    act(() => setActiveSession('s-auth-refactor'));

    expect(screen.getByText('beta-transcript').closest('div.h-full')).not.toBeNull();
    expect(screen.getByText('alpha-transcript').closest('div.hidden')).not.toBeNull();
  });

  it('a hidden tab keeps streaming: output for a background session lands in ITS host', async () => {
    twoOpenTabs();
    render(<ChatSurface />);
    await act(async () => {
      appendFrames('s-auth-refactor', [turn('t3', 'beta-kept-streaming')]);
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    const beta = screen.getByText('beta-kept-streaming');
    expect(beta).toBeInTheDocument();
    expect(beta.closest('div.hidden')).not.toBeNull();
  });
});

describe('ChatSurface states-first', () => {
  const readyState = (turns: TurnFrame[], ui: Partial<ConsoleState['ui']> = {}) =>
    stateWith({ status: 'ok', value: turns }, ui);

  it('shows the loading circle while the transcript loads cold', () => {
    seedState(stateWith({ status: 'loading' }));
    render(<ChatSurface />);
    expect(screen.getByRole('status', { name: /^loading conversation$/i })).toBeTruthy();
  });

  it('shows an error inline', () => {
    seedState(stateWith({ status: 'error', message: 'daemon down' }));
    render(<ChatSurface />);
    expect(screen.getByText('daemon down')).toBeTruthy();
  });

  it('empty state teaches the register: agent, model/effort, and the key hints', () => {
    seedState(readyState([]));
    render(<ChatSurface />);
    // "{agent} is ready" — the reviewer session's agent.
    expect(screen.getByText(/is ready/i)).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.tagName === 'B' && el.textContent === 'reviewer'),
    ).toBeTruthy();
    // model · effort line.
    expect(screen.getByText(/sonnet · /)).toBeTruthy();
    // send / newline / commands hints.
    expect(screen.getByText('send')).toBeTruthy();
    expect(screen.getByText('newline')).toBeTruthy();
    expect(screen.getByText('commands')).toBeTruthy();
  });

  it('renders the transcript log when there are frames', () => {
    seedState(readyState([{ id: '1', role: 'you', kind: 'text', text: 'hi' }]));
    render(<ChatSurface />);
    expect(screen.getByRole('log')).toBeTruthy();
  });

  it('carries no duplicate session-switching chrome — the shell owns that now', () => {
    seedState(readyState([{ id: '1', role: 'you', kind: 'text', text: 'hi' }]));
    render(<ChatSurface />);
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

  it('renders the shared model picker, not the retired console-ui select', () => {
    seedState(readyState([]));
    render(<ChatSurface />);
    // The composer now wears the SAME picker as the agent editor: the kit's combobox
    // trigger, filterable, rather than the flat menu it used to grow.
    const picker = screen.getByRole('combobox', { name: 'Model' });
    expect(picker).toHaveAttribute('aria-haspopup', 'listbox');
    expect(picker).toHaveTextContent('sonnet');
    // The retired kit's control was a native select; nothing renders one now.
    expect(document.querySelector('select')).toBeNull();
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
            {
              id: 's1',
              agentRef: 'a/x',
              title: 't',
              updatedAt: NOW,
              provider: 'claude',
              model: 'opus',
              promptConfig: { roles: ['swe'] },
            },
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

  it('derives the drift notice when the config diverges, offering recompile + dismiss', async () => {
    pinClock();
    const onBannerAction = vi.fn();
    seedState(driftState({}, { onBannerAction }));
    render(<ChatSurface />);
    expect(screen.getByText('Configuration drift')).toBeTruthy();
    // Drift-only scenario: the session ran on this config just now, so no cache notice —
    // exactly one notice line renders.
    expect(screen.queryByText('Prompt cache')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Recompile' }));
    expect(onBannerAction).toHaveBeenCalledWith('s1', 'drift', 'recompile');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onBannerAction).toHaveBeenCalledWith('s1', 'drift', 'dismiss');
  });

  it('picks a model through the composer picker, re-pinning the session', async () => {
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
    seedState(state);
    render(<ChatSurface />);
    // The reviewer session's agent default (sonnet) seeds the trigger.
    await userEvent.click(screen.getByRole('combobox', { name: 'Model' }));
    await userEvent.click(screen.getByRole('option', { name: /opus/ }));
    expect(setSessionModel).toHaveBeenCalledWith('s-audit-auth', {
      model: 'opus',
      provider: 'claude',
    });
  });

  it('derives a passive cache notice on a staged switch, dismissable but with no fix', () => {
    pinClock();
    seedState(
      driftState({
        modelOverride: { s1: { provider: 'deepseek', model: 'deepseek-v4-pro' } },
      }),
    );
    const { container } = render(<ChatSurface />);
    // The cache notice is informational: there is nothing to recompile, because an idle
    // cache cannot be un-cooled. Dismiss is therefore its ONLY control — unlike the drift
    // notice riding alongside it, which also offers Recompile.
    const cacheRow = container.querySelector('[data-notice-kind="cache"]');
    expect(cacheRow).not.toBeNull();
    expect(cacheRow?.querySelector('[aria-label="Dismiss"]')).not.toBeNull();
    expect(within(cacheRow as HTMLElement).queryByRole('button', { name: 'Recompile' })).toBeNull();
    const driftRow = container.querySelector('[data-notice-kind="drift"]') as HTMLElement;
    expect(within(driftRow).getByRole('button', { name: 'Recompile' })).toBeInTheDocument();
  });

  it('the dedicated Stop control while running wires to interruptSession (a user stop, not an error affordance)', async () => {
    const interruptSession = vi.fn();
    const state = stateWith(
      { status: 'ok', value: [] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { interruptSession },
    );
    seedState(state);
    render(<ChatSurface />);
    const stop = screen.getByRole('button', { name: /stop/i });
    // The Stop control is a clean-stop affordance, not the danger tone an error surface would
    // use (a user stop, never a governance block).
    expect(stop.className).not.toMatch(/danger/);
    await userEvent.click(stop);
    expect(interruptSession).toHaveBeenCalledExactlyOnceWith('s-audit-auth');
  });

  it('labels the running-turn action Steer and routes it to steerSession, since a steer never abandons the running turn', async () => {
    const steerSession = vi.fn();
    const state = stateWith(
      { status: 'ok', value: [] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(state);
    render(<ChatSurface />);
    await userEvent.type(screen.getByRole('textbox'), 'go check the tests instead');
    expect(screen.queryByRole('button', { name: /barge/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));
    expect(steerSession).toHaveBeenCalledExactlyOnceWith(
      's-audit-auth',
      'go check the tests instead',
    );
  });

  const agentTextFrame = (text: string, id = 'a1'): TurnFrame => ({
    id,
    role: 'agent',
    kind: 'text',
    text,
  });
  const youTextFrame = (text: string, id = 'y1'): TurnFrame => ({
    id,
    role: 'you',
    kind: 'text',
    text,
  });
  // The last mounted row's text — asserts POSITION, not just presence, since a pending
  // steer belongs at the bottom (it hasn't happened yet, so it can't sit above what has).
  const lastRowText = (): string | null => {
    const rows = screen.getByRole('log').querySelectorAll('[data-row-index]');
    return rows.length > 0 ? (rows[rows.length - 1]?.textContent ?? null) : null;
  };

  it('pins a sent steer at the transcript bottom and drops the pin when the real frame lands', async () => {
    const steerSession = vi.fn();
    const running = stateWith(
      { status: 'ok', value: [agentTextFrame('working…')] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(running);
    const { rerender } = render(<ChatSurface />);
    await userEvent.type(screen.getByRole('textbox'), 'use the JSON one');
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));

    // Pinned, and LAST — it has not happened yet, so it cannot sit above what has.
    const pinned = screen.getByText('use the JSON one');
    expect(pinned.closest('[data-pending="true"]')).not.toBeNull();
    expect(lastRowText()).toContain('use the JSON one');

    // The daemon's real line arrives at pickup; the pin must go, or the message doubles.
    const delivered = stateWith(
      { status: 'ok', value: [agentTextFrame('working…'), youTextFrame('use the JSON one')] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(delivered);
    rerender(<ChatSurface />);
    expect(screen.getAllByText('use the JSON one')).toHaveLength(1);
    expect(document.querySelector('[data-pending="true"]')).toBeNull();
  });

  it('clears a pin when the session goes idle, so it can never wedge', async () => {
    const steerSession = vi.fn();
    const running = stateWith(
      { status: 'ok', value: [] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(running);
    const { rerender } = render(<ChatSurface />);
    await userEvent.type(screen.getByRole('textbox'), 'never delivered');
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));
    expect(screen.getByText('never delivered')).toBeInTheDocument();

    const idle = stateWith({ status: 'ok', value: [] }, {}, { steerSession });
    seedState(idle);
    rerender(<ChatSurface />);
    expect(screen.queryByText('never delivered')).toBeNull();
  });

  it('does not let an earlier turn with identical text clear a steer pinned later', async () => {
    const steerSession = vi.fn();
    // The session's history ALREADY contains a 'you' turn with the exact text the steer
    // will use — reconciliation must not treat that pre-existing turn as the steer's own
    // delivery.
    const running = stateWith(
      { status: 'ok', value: [youTextFrame('wait', 'y1'), agentTextFrame('on it')] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(running);
    const { rerender } = render(<ChatSurface />);
    await userEvent.type(screen.getByRole('textbox'), 'wait');
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));
    expect(document.querySelector('[data-pending="true"]')).not.toBeNull();

    // An unrelated re-render (e.g. the agent's reply streaming further) must not clear it —
    // only the delivery of THIS steer's own line may.
    const midStream = stateWith(
      {
        status: 'ok',
        value: [youTextFrame('wait', 'y1'), agentTextFrame('on it, thinking further')],
      },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(midStream);
    rerender(<ChatSurface />);
    expect(document.querySelector('[data-pending="true"]')).not.toBeNull();

    // The real delivery lands (a SECOND 'wait' turn, after the pin was created) — now it clears.
    const delivered = stateWith(
      {
        status: 'ok',
        value: [
          youTextFrame('wait', 'y1'),
          agentTextFrame('on it, thinking further'),
          youTextFrame('wait', 'y2'),
        ],
      },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(delivered);
    rerender(<ChatSurface />);
    expect(document.querySelector('[data-pending="true"]')).toBeNull();
  });

  it('clears both pins when two identical steers are both delivered in one transition', async () => {
    const steerSession = vi.fn();
    const running = stateWith(
      { status: 'ok', value: [agentTextFrame('on it')] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(running);
    const { rerender } = render(<ChatSurface />);
    await userEvent.type(screen.getByRole('textbox'), 'retry');
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));
    await userEvent.type(screen.getByRole('textbox'), 'retry');
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));
    expect(screen.getAllByText('retry')).toHaveLength(2);
    expect(document.querySelectorAll('[data-pending="true"]')).toHaveLength(2);

    // Both real deliveries land together (e.g. a backgrounded tab catching up in one push).
    const delivered = stateWith(
      {
        status: 'ok',
        value: [agentTextFrame('on it'), youTextFrame('retry', 'y1'), youTextFrame('retry', 'y2')],
      },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(delivered);
    rerender(<ChatSurface />);
    expect(screen.getAllByText('retry')).toHaveLength(2);
    expect(document.querySelectorAll('[data-pending="true"]')).toHaveLength(0);
  });

  it("keeps a surviving pin's row identity when an earlier pin clears (no spurious remount)", async () => {
    const steerSession = vi.fn();
    const running = stateWith(
      { status: 'ok', value: [agentTextFrame('working…')] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(running);
    const { rerender } = render(<ChatSurface />);
    await userEvent.type(screen.getByRole('textbox'), 'first pin');
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));
    await userEvent.type(screen.getByRole('textbox'), 'second pin');
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));
    const secondNode = screen.getByText('second pin');

    // The first pin's delivery lands; the first pin clears, but the second must keep its
    // OWN row (same DOM node) rather than shifting into the freed array slot and remounting.
    const delivered = stateWith(
      { status: 'ok', value: [agentTextFrame('working…'), youTextFrame('first pin', 'y1')] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(delivered);
    rerender(<ChatSurface />);
    expect(screen.getByText('second pin')).toBe(secondNode);
  });

  it('keeps a pin pinned across a mid-run conversation reload (wholesale frame-array replacement), then clears on the real delivery', async () => {
    const steerSession = vi.fn();
    // Several fine-grained live-streamed frames — the shape a push can have before the
    // daemon's persisted view (what a reload fetches) consolidates them.
    const running = stateWith(
      {
        status: 'ok',
        value: [
          agentTextFrame('thinking…', 'a1'),
          agentTextFrame('still thinking', 'a2'),
          agentTextFrame('working…', 'a3'),
        ],
      },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(running);
    const { rerender } = render(<ChatSurface />);
    await userEvent.type(screen.getByRole('textbox'), 'use the JSON one');
    await userEvent.click(screen.getByRole('button', { name: 'Steer' }));
    expect(document.querySelector('[data-pending="true"]')).not.toBeNull();

    // A mid-run reattach folds the durable log back in, handing the surface a frame array
    // of a different identity AND, here, a different (shorter, consolidated) length — with
    // no matching delivery yet. The pin must survive this untouched.
    const reloaded = stateWith(
      { status: 'ok', value: [agentTextFrame('working…', 'a3')] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(reloaded);
    rerender(<ChatSurface />);
    expect(document.querySelector('[data-pending="true"]')).not.toBeNull();

    // The real delivery lands in the RELOADED (shorter) array — an index tied to the
    // pre-reload array's length would never see it. The pin must still clear.
    const delivered = stateWith(
      {
        status: 'ok',
        value: [agentTextFrame('working…', 'a3'), youTextFrame('use the JSON one', 'y1')],
      },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession },
    );
    seedState(delivered);
    rerender(<ChatSurface />);
    expect(document.querySelector('[data-pending="true"]')).toBeNull();
  });

  it('Queue pins the message (no daemon steer) and releases it as a send when the turn ends', async () => {
    const steerSession = vi.fn();
    const sendMessage = vi.fn();
    const running = stateWith(
      { status: 'ok', value: [] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { steerSession, sendMessage },
    );
    seedState(running);
    const { rerender } = render(<ChatSurface />);
    await userEvent.type(screen.getByRole('textbox'), 'also add a test');
    await userEvent.click(screen.getByRole('button', { name: /queue/i }));
    // queued: pinned in the UI, not sent to the daemon yet
    expect(steerSession).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.getByText('also add a test')).toBeInTheDocument();
    // the turn ends → the session goes idle → the queued message is released as a normal send
    const idle = stateWith({ status: 'ok', value: [] }, {}, { steerSession, sendMessage });
    seedState(idle);
    rerender(<ChatSurface />);
    // The action delegate forwards all three positions, so a plain send carries the two
    // absent ones explicitly (the daemon call itself omits them — pinned store-side).
    expect(sendMessage).toHaveBeenCalledWith('also add a test', undefined, undefined);
  });

  it('shows Send (not Queue/Steer/Stop) while idle', () => {
    seedState(readyState([]));
    render(<ChatSurface />);
    expect(screen.getByRole('button', { name: /send/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /queue/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Steer' })).toBeNull();
    expect(screen.queryByRole('button', { name: /stop the running turn/i })).toBeNull();
  });

  it('Esc interrupts the active session while a turn is running', async () => {
    const interruptSession = vi.fn();
    const state = stateWith(
      { status: 'ok', value: [] },
      { runStatus: { 's-audit-auth': { since: 1000 } } },
      { interruptSession },
    );
    seedState(state);
    render(<ChatSurface />);
    await userEvent.type(screen.getByRole('textbox'), '{Escape}');
    expect(interruptSession).toHaveBeenCalledExactlyOnceWith('s-audit-auth');
  });

  describe('the docked pending approval', () => {
    const approvalStream: TurnFrame[] = [
      { id: '1', role: 'agent', kind: 'text', text: 'about to write' },
      { id: '2', kind: 'approval', requestId: 'r1', tool: 'write_file', summary: 'src/auth.ts' },
    ];

    it('never renders a pending-approval card in the transcript — the composer owns it', () => {
      seedState(stateWith({ status: 'ok', value: approvalStream }));
      render(<ChatSurface />);
      // The old transcript card used capitalized "Approve"/"Deny" buttons; those are gone.
      expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
      // The composer's merged gate is what's showing instead.
      expect(screen.getByRole('button', { name: /^approve:/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /^deny:/i })).toBeTruthy();
    });

    it('approving via the composer calls onRespond(requestId, "approve")', async () => {
      const respondApproval = vi.fn();
      const state = stateWith({ status: 'ok', value: approvalStream }, {}, { respondApproval });
      seedState(state);
      render(<ChatSurface />);
      await userEvent.click(screen.getByRole('button', { name: /^approve:/i }));
      expect(respondApproval).toHaveBeenCalledExactlyOnceWith('r1', 'approve');
    });

    it('denying via the composer calls onRespond(requestId, "deny")', async () => {
      const respondApproval = vi.fn();
      const state = stateWith({ status: 'ok', value: approvalStream }, {}, { respondApproval });
      seedState(state);
      render(<ChatSurface />);
      await userEvent.click(screen.getByRole('button', { name: /^deny:/i }));
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
      seedState(state);
      render(<ChatSurface />);
      await userEvent.type(screen.getByRole('textbox'), 'do this instead{Enter}');
      expect(respondApproval).toHaveBeenCalledExactlyOnceWith('r1', 'deny');
      expect(sendMessage).toHaveBeenCalledExactlyOnceWith('do this instead', undefined, undefined);
    });
  });
});

describe('toGovernedFrame streaming', () => {
  it('carries the streaming flag onto the governed text frame', () => {
    const f = { id: 'a', role: 'agent', kind: 'text', text: 'hi', streaming: true } as TurnFrame;
    expect(toGovernedFrame(f)).toMatchObject({ kind: 'text', text: 'hi', streaming: true });
  });
  it('carries the streaming flag onto the governed thinking frame', () => {
    const f = {
      id: 'b',
      role: 'agent',
      kind: 'thinking',
      text: 'po',
      streaming: true,
    } as TurnFrame;
    expect(toGovernedFrame(f)).toMatchObject({ kind: 'thinking', text: 'po', streaming: true });
  });
  it('omits streaming for a settled text frame', () => {
    const f = { id: 'c', role: 'agent', kind: 'text', text: 'hi' } as TurnFrame;
    expect((toGovernedFrame(f) as { streaming?: boolean }).streaming).toBeUndefined();
  });
});

describe('selectChatVm — per-model info (the ring, the attach gate, the hover-card feed)', () => {
  const V4_META = {
    id: 'v4',
    provider: 'deepseek',
    contextWindow: 128_000,
    modalities: { input: ['text', 'image'], output: ['text'] },
  };

  /** The active session pinned to a vision-capable DeepSeek model, catalog loaded. */
  const infoState = (ui: Partial<ConsoleState['ui']> = {}): ConsoleState =>
    makeState({
      data: {
        turns: { status: 'ok', value: [] },
        agents: { status: 'ok', value: MOCK_AGENTS },
        sessions: {
          status: 'ok',
          value: [
            { ...MOCK_SESSIONS[1]!, model: 'v4', provider: 'deepseek' },
            ...MOCK_SESSIONS.filter((s) => s.id !== 's-audit-auth'),
          ],
        },
        models: { status: 'ok', value: [{ id: 'v4', provider: 'deepseek' }] },
        modelMetadata: { status: 'ok', value: [V4_META] },
      },
      ui: { activeSessionId: 's-audit-auth', ...ui },
    });

  it('resolves the ACTIVE model row, a verified-vision attach gate, and the session usage', () => {
    const vm = selectChatVm(
      infoState({ usageBySession: { 's-audit-auth': { tokensIn: 10_000, tokensOut: 500 } } }),
    );
    if (vm.status !== 'ready') throw new Error('vm not ready');
    expect(vm.activeModelMetadata).toEqual(V4_META);
    expect(vm.attach.image).toEqual({ enabled: true });
    expect(vm.attach.text).toEqual({ enabled: true });
    expect(vm.ringUsage).toEqual({ tokensIn: 10_000, tokensOut: 500 });
    // The whole entry list rides too — the picker's hover card resolves ANY row from it.
    expect(vm.modelMetadata).toEqual([V4_META]);
  });

  it('a claude-default session disables attachments with the backend reason (no seam yet)', () => {
    // The plain mock session carries no provider — the claude default, whose
    // adapter has no attachment seam (docs/adr/0036).
    const vm = selectChatVm(stateWith({ status: 'ok', value: [] }));
    if (vm.status !== 'ready') throw new Error('vm not ready');
    expect(vm.attach.image.enabled).toBe(false);
    expect(vm.attach.text.enabled).toBe(false);
    expect(vm.attach.image.reason).toBe('This backend cannot carry attachments yet');
  });

  it('a metadata read still loading degrades to honest unknowns, never a fabricated row', () => {
    const state = infoState();
    const vm = selectChatVm({
      ...state,
      data: { ...state.data, modelMetadata: { status: 'loading' } },
    });
    if (vm.status !== 'ready') throw new Error('vm not ready');
    expect(vm.activeModelMetadata).toBeUndefined();
    expect(vm.modelMetadata).toEqual([]);
    // Backend carries attachments (deepseek), but vision is UNVERIFIED — the image
    // gate stays closed with the distinct unverified reason.
    expect(vm.attach.image.enabled).toBe(false);
    expect(vm.attach.image.reason).toBe('Image support is unverified for this model');
    expect(vm.attach.text.enabled).toBe(true);
  });
});

describe('subagent announcement cards — producer→renderer round trip', () => {
  /** Validate a raw wire push exactly as the live console edge does, then map it
   *  through the same two translations the shipped path uses (wire → view →
   *  transcript frame) before rendering. Any drift between the daemon's schema
   *  and the renderer's expectations fails HERE, not in production. */
  const viewFramesFromWire = (rawPush: unknown): TurnFrame[] =>
    pushToViewFrames(pushSchema.parse(rawPush));

  const turnPush = (frame: unknown, seq = 0): unknown => ({
    kind: 'turn',
    sessionId: 's-audit-auth',
    worktree: '/repo',
    seq,
    frame,
  });

  it('round-trips a subagent-spawn push to a rendered card with identity color + jump', async () => {
    const frames = viewFramesFromWire(
      turnPush({
        t: 'subagent-spawn',
        childSessionId: 's-ledger-tests',
        childWorktree: '/repo/.coa/worktrees/s-ledger-tests',
        agentRef: 'roles/reviewer',
        description: 'review the ledger diff',
        isolate: true,
      }),
    );
    const selectSession = vi.fn();
    seedState(stateWith({ status: 'ok', value: frames }, {}, { selectSession }));
    const { container } = render(<ChatSurface />);
    expect(screen.getByText('review the ledger diff')).toBeInTheDocument();
    expect(screen.getByText('Spawned')).toBeInTheDocument();
    // The identity color overlay resolves roles/reviewer → teal from the agents list.
    expect(container.querySelector('.text-agent-teal')?.textContent).toBe('roles/reviewer');
    await userEvent.click(screen.getByRole('button', { name: /open thread/i }));
    expect(selectSession).toHaveBeenCalledWith('s-ledger-tests');
  });

  it('round-trips a subagent-completion push quoting the child’s own result verbatim', () => {
    const frames = viewFramesFromWire(
      turnPush({
        t: 'subagent-completion',
        childSessionId: 's-ledger-tests',
        childWorktree: '/repo/.coa/worktrees/s-ledger-tests',
        agentRef: 'roles/reviewer',
        reason: 'completed',
        result: 'Two findings, both minor.',
      }),
    );
    seedState(stateWith({ status: 'ok', value: frames }));
    render(<ChatSurface />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Two findings, both minor.')).toBeInTheDocument();
  });

  it('an errored completion wears its own pill and the detail line', () => {
    const frames = viewFramesFromWire(
      turnPush({
        t: 'subagent-completion',
        childSessionId: 's-ledger-tests',
        childWorktree: 'wt',
        agentRef: 'roles/reviewer',
        reason: 'errored',
        detail: 'rate limited',
      }),
    );
    seedState(stateWith({ status: 'ok', value: frames }));
    render(<ChatSurface />);
    expect(screen.getByText('Errored')).toBeInTheDocument();
    expect(screen.getByText('rate limited')).toBeInTheDocument();
  });

  it('round-trips a subagent-message push, resolving both session titles and jumping to the counterparty', async () => {
    const frames = viewFramesFromWire(
      turnPush({
        t: 'subagent-message',
        messageId: 'm1',
        threadId: 'm1',
        from: 's-audit-auth',
        to: 's-ledger-tests',
        direction: 'sent',
        body: 'symbol map attached',
      }),
    );
    const selectSession = vi.fn();
    seedState(stateWith({ status: 'ok', value: frames }, {}, { selectSession }));
    render(<ChatSurface />);
    // The label overlay resolves both session ids to their rail titles.
    expect(screen.getByText('audit auth flow')).toBeInTheDocument();
    expect(screen.getByText('harden ledger tests')).toBeInTheDocument();
    expect(screen.getByText('symbol map attached')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    // Sent ⇒ the counterparty is the recipient.
    await userEvent.click(screen.getByRole('button', { name: /open thread/i }));
    expect(selectSession).toHaveBeenCalledWith('s-ledger-tests');
  });

  it('raw mode projects all three announcement kinds as verbatim control lines', () => {
    expect(
      frameToRawLine({
        id: '1',
        kind: 'subagent-spawn',
        childSessionId: 'c1',
        childWorktree: 'wt',
        agentRef: 'reviewer',
        description: 'review',
        isolate: false,
      }),
    ).toBe('> control: subagent spawn reviewer (c1) review');
    expect(
      frameToRawLine({
        id: '2',
        kind: 'subagent-completion',
        childSessionId: 'c1',
        childWorktree: 'wt',
        agentRef: 'reviewer',
        reason: 'completed',
        result: 'ok',
      }),
    ).toBe('> control: subagent completed reviewer (c1) ok');
    expect(
      frameToRawLine({
        id: '3',
        kind: 'subagent-message',
        messageId: 'm1',
        threadId: 'm1',
        from: 'a',
        to: 'b',
        direction: 'sent',
        body: 'hello',
      }),
    ).toBe('> control: message sent a -> b hello');
  });
});
