import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import type { ConsoleActions, ConsoleState } from '../panels/state.js';
import { installActions } from '../store/actions.js';
import { resetDaemonData, useDaemonData } from '../store/data.js';
import { resetSessions, useSessions } from '../store/sessions.js';
import { resetTranscripts, useTranscripts } from '../store/transcripts.js';
import { resetConsoleUi, useConsoleUi } from '../store/ui.js';

/** Inert actions for test states; spread and override the ones under test. */
export const NOOP_ACTIONS: ConsoleActions = {
  setRoute: () => {},
  refresh: () => {},
  switchAccount: () => {},
  setSettings: () => {},
  toggleRaw: () => {},
  respondApproval: () => {},
  setPermissionMode: () => {},
  selectAgent: () => {},
  createAgent: () => {},
  updateAgent: () => {},
  deleteAgent: () => {},
  togglePinAgent: () => {},
  selectSession: () => {},
  newSession: () => {},
  deleteSession: () => {},
  sendMessage: () => {},
  onBannerAction: () => {},
  setSessionModel: () => {},
  openPath: () => Promise.resolve({ ok: false }),
  openExternal: () => Promise.resolve({ ok: false }),
  interruptSession: () => {},
  steerSession: () => {},
  reapWorktree: () => {},
};

export interface StateOverrides {
  data?: Partial<ConsoleState['data']>;
  ui?: Partial<ConsoleState['ui']>;
  actions?: Partial<ConsoleActions>;
}

/** A ConsoleState for tests: everything loading + defaults, with deep overrides.
 *  Lives beside the panels (not in a .test file) so every panel test shares one
 *  builder instead of re-hand-rolling the state shape. At runtime this shape is
 *  assembled per-surface from the slice stores; tests build the whole thing so a
 *  fixture satisfies every surface's `Pick`ed subset structurally. */
export function makeState(overrides: StateOverrides = {}): ConsoleState {
  return {
    data: {
      cap: { status: 'loading' },
      flags: { status: 'loading' },
      timeline: { status: 'loading' },
      accounts: { status: 'loading' },
      turns: { status: 'loading' },
      agents: { status: 'loading' },
      agentDiagnostics: [],
      sessions: { status: 'loading' },
      worktrees: { status: 'loading' },
      models: { status: 'loading' },
      modelMetadata: { status: 'loading' },
      roles: { status: 'loading' },
      packages: { status: 'loading' },
      ...overrides.data,
    },
    ui: {
      settings: DEFAULT_SETTINGS,
      rawMode: false,
      resolvedApprovals: {},
      modelOverride: {},
      dismissedDrift: {},
      dismissedCache: {},
      runStatus: {},
      sendNonce: {},
      notesBySession: {},
      modeBySession: {},
      pendingApprovalsBySession: {},
      usageBySession: {},
      subagentStatus: {},
      ...overrides.ui,
    },
    actions: { ...NOOP_ACTIONS, ...overrides.actions },
  };
}

/** Reset every slice store and re-install inert actions — component tests call this in
 *  `beforeEach` so no test inherits its predecessor's state or spies. */
export function resetStores(): void {
  resetTranscripts();
  resetSessions();
  resetDaemonData();
  resetConsoleUi();
  installActions(NOOP_ACTIONS);
}

/** Seed the slice stores from a ConsoleState-shaped fixture — the component-test analog
 *  of the old whole-state publish. `data.turns` lands as the ACTIVE session's transcript
 *  entry (there is no single turns slot anymore); everything else maps onto its owning
 *  slice; the fixture's actions install on the module action surface. */
export function seedStores(overrides: StateOverrides = {}): ConsoleState {
  return seedState(makeState(overrides));
}

/** `seedStores` for a state a test has already built by hand — the surfaces that take a
 *  whole `ConsoleState` (agent fixtures, key-binding scenarios) compose one up front and
 *  seed it as a unit rather than passing an overrides bag. */
export function seedState(s: ConsoleState): ConsoleState {
  useDaemonData.setState({
    cap: s.data.cap,
    flags: s.data.flags,
    timeline: s.data.timeline,
    accounts: s.data.accounts,
    models: s.data.models,
    modelMetadata: s.data.modelMetadata,
    roles: s.data.roles,
    packages: s.data.packages,
    worktrees: s.data.worktrees,
    agents: s.data.agents,
    agentDiagnostics: s.data.agentDiagnostics,
  });
  useSessions.setState({
    list: s.data.sessions,
    activeSessionId: s.ui.activeSessionId,
    runStatus: s.ui.runStatus,
    sendNonce: s.ui.sendNonce,
    modeBySession: s.ui.modeBySession,
    pendingApprovalsBySession: s.ui.pendingApprovalsBySession,
    usageBySession: s.ui.usageBySession,
    subagentStatus: s.ui.subagentStatus,
  });
  const active = s.ui.activeSessionId;
  if (active !== undefined) {
    useTranscripts.setState((t) => ({ bySession: { ...t.bySession, [active]: s.data.turns } }));
  }
  useConsoleUi.setState({
    settings: s.ui.settings,
    rawMode: s.ui.rawMode,
    resolvedApprovals: s.ui.resolvedApprovals,
    selectedAgentRef: s.ui.selectedAgentRef,
    modelOverride: s.ui.modelOverride,
    dismissedDrift: s.ui.dismissedDrift,
    dismissedCache: s.ui.dismissedCache,
    notesBySession: s.ui.notesBySession,
  });
  installActions(s.actions);
  return s;
}
