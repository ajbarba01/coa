import type {
  AgentSummary,
  CapState,
  Checkpoint,
  FeedView,
  ModelDescriptor,
  PackageSummary,
  RoleSummary,
  SessionSummary,
  TurnFrame,
} from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../../shared/settings.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';

/** A single async read's UI state — carries loading/error/value through the
 *  pure selectors so panels can render states-first. */
export type Remote<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: T };

/** The account list (each tagged with its provider) + the active account per provider. */
export interface AccountsInfo {
  accounts: { label: string; provider: string }[];
  /** provider → active account label (absent ⇒ that provider is ambient). */
  active: Record<string, string>;
}

/** The daemon reads the console has fetched. */
export interface ConsoleData {
  cap: Remote<CapState>;
  flags: Remote<FeedView>;
  timeline: Remote<Checkpoint[]>;
  accounts: Remote<AccountsInfo>;
  turns: Remote<TurnFrame[]>;
  /** Mock today (no listRoles / session-list verbs yet); swapped via the registry. */
  agents: Remote<AgentSummary[]>;
  sessions: Remote<SessionSummary[]>;
  /** The active account's available models + per-model reasoning capabilities (live, cached). */
  models: Remote<ModelDescriptor[]>;
  /** The agent-assembly catalogue the picker draws from (live: `listRoles`/`listPackages`). */
  roles: Remote<RoleSummary[]>;
  packages: Remote<PackageSummary[]>;
}

/** Local view state (not daemon data). */
export interface ConsoleUi {
  /** Which surface panel currently fills the nav-driven main region. */
  activeMainPanelId: string;
  settings: ConsoleSettings;
  /** When true the conversation renders the unfiltered loop (D85). */
  rawMode: boolean;
  /** Inert local record of mock approvals the operator resolved (SC-1: surfacing
   *  only — the daemon owns the real decision). */
  resolvedApprovals: Record<string, 'approved' | 'denied'>;
  /** The agent open in the Agents editor (not the chat's — that follows the session). */
  selectedAgentRef?: string;
  /** The conversation the chat pane shows; its agentRef drives the rail selection. */
  activeSessionId?: string;
}

/** App-owned callbacks panels invoke to drive the console. */
export interface ConsoleActions {
  setRoute: (panelId: string) => void;
  refresh: () => void;
  /** Select an account for its provider, or reset a provider to ambient (`label: 'ambient', provider`). */
  switchAccount: (label: string, provider?: string) => void;
  setSettings: (patch: Partial<ConsoleSettings>) => void;
  toggleRaw: () => void;
  respondApproval: (requestId: string, decision: 'approve' | 'deny') => void;
  /** Agents-surface editor selection + mock-inert writes (future writeRole funnel). */
  selectAgent: (ref: string) => void;
  createAgent: (scope: 'project' | 'personal') => void;
  updateAgent: (ref: string, patch: Partial<Omit<AgentSummary, 'ref'>>) => void;
  deleteAgent: (ref: string) => void;
  togglePinAgent: (ref: string) => void;
  /** Chat session axis — selection follows the session (its agent drives the rail). */
  selectSession: (id: string) => void;
  newSession: (agentRef: string) => void;
  deleteSession: (id: string) => void;
  /** Send a prompt to the active session's agent (starts a governed daemon session). */
  sendMessage: (text: string) => void;
}

/** The single object pushed into the engine via setDaemonState: data down,
 *  actions up. Every panel's pure selectVm reads only what it needs. */
export interface ConsoleState {
  data: ConsoleData;
  ui: ConsoleUi;
  actions: ConsoleActions;
}

/** The default main surface when nothing is persisted. */
export const DEFAULT_MAIN_PANEL_ID = 'cost';

export function initialState(actions: ConsoleActions): ConsoleState {
  return {
    data: {
      cap: { status: 'loading' },
      flags: { status: 'loading' },
      timeline: { status: 'loading' },
      accounts: { status: 'loading' },
      turns: { status: 'loading' },
      agents: { status: 'loading' },
      sessions: { status: 'loading' },
      models: { status: 'loading' },
      roles: { status: 'loading' },
      packages: { status: 'loading' },
    },
    ui: {
      activeMainPanelId: DEFAULT_MAIN_PANEL_ID,
      settings: DEFAULT_SETTINGS,
      rawMode: false,
      resolvedApprovals: {},
    },
    actions,
  };
}
