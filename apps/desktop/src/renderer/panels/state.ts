import type {
  AgentDiagnostic,
  AgentSummary,
  Attachment,
  CapState,
  Checkpoint,
  FeedView,
  ModelDescriptor,
  ModelMetadata,
  ModelSelection,
  PackageSummary,
  PermissionMode,
  RoleSummary,
  SessionSummary,
  SessionUsage,
  ToolClass,
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
  /** The daemon's registered agents (built-in ∪ personal ∪ project). */
  agents: Remote<AgentSummary[]>;
  /** Load problems the daemon's registry reported alongside the list (a duplicate
   *  ref, an invalid file) — surfaced so a broken agent file has a visible reason
   *  instead of the agent just not being there. Not `Remote`: it rides the SAME
   *  `listAgents` read as `agents` (there is no separate loading/error state for
   *  it), and it degrades to `[]` on any read failure, same as `agents` degrading
   *  to the empty list. */
  agentDiagnostics: AgentDiagnostic[];
  sessions: Remote<SessionSummary[]>;
  /** The active account's available models + per-model reasoning capabilities (live, cached). */
  models: Remote<ModelDescriptor[]>;
  /** The per-model info catalog (context window/pricing/modalities/reasoning) — the
   *  context ring, the model-picker hover card, and attach gating all read this.
   *  Absent fields on a row are genuine unknowns, never fabricated. */
  modelMetadata: Remote<ModelMetadata[]>;
  /** The agent-assembly catalogue the picker draws from (live: `listRoles`/`listPackages`). */
  roles: Remote<RoleSummary[]>;
  packages: Remote<PackageSummary[]>;
}

/** F2 — a still-pending approval request, as the live `approval` push (or the
 *  `sessionMode` reattach read) carries it. `toolClass` rides only the push (the
 *  reattach snapshot doesn't carry it — see the daemon's `PendingApprovalSnapshot`). */
export interface PendingApprovalItem {
  requestId: string;
  tool: string;
  summary: string;
  input?: Record<string, unknown>;
  toolClass?: ToolClass;
}

/** F2 — a session's live permission-mode reflection: the CONFIGURED `mode`, the
 *  `effectiveMode` actually enforced right now, and `degraded` (present only when
 *  they differ — SC-1 honesty: the backend has no approval seam, so enforcement
 *  fell back to bypass). Never decided by the console — always the daemon's `mode`
 *  push, or the `sessionMode` reattach read. */
export interface SessionModeState {
  mode: PermissionMode;
  effectiveMode: PermissionMode;
  degraded?: string;
}

/** Local view state (not daemon data). */
export interface ConsoleUi {
  settings: ConsoleSettings;
  /** When true the conversation renders the unfiltered loop (raw is always available). */
  rawMode: boolean;
  /** A local record of resolved approvals, keyed by requestId — overlays a `resolved`
   *  receipt onto a transcript-derived approval frame once answered (advisory: surfacing
   *  only, never the decision itself). Distinct from {@link pendingApprovalsBySession}:
   *  a LIVE F2 ask is never a transcript frame, so it never reads this map — it clears by
   *  being removed from the pending queue instead. */
  resolvedApprovals: Record<string, 'approved' | 'denied'>;
  /** The agent open in the Agents editor (not the chat's — that follows the session). */
  selectedAgentRef?: string;
  /** The conversation the chat pane shows; its agentRef drives the rail selection. */
  activeSessionId?: string;
  /** A per-session in-chat model/provider override the user set deliberately, keyed by
   *  sessionId. Wins over the session pin for the next send (which then persists it via
   *  the daemon), so switching a live conversation's backend is an explicit act. It also
   *  drives the predictive cache banner (staged pick vs. the session's pin). */
  modelOverride: Record<string, ModelSelection>;
  /** The config key the user dismissed the drift banner for, per session. The banner is
   *  derived (config-a-send-would-use vs. the running prompt's config), so dismissal is
   *  suppression state — it re-shows once the config changes to a new key. */
  dismissedDrift: Record<string, string>;
  /** The `cacheKey` the user dismissed the prompt-cache notice for, per session. Same
   *  shape and same reason as `dismissedDrift`: the notice is derived, so hiding it means
   *  remembering what it was raised about. It re-shows once the staged pick or the
   *  session's pin moves. */
  dismissedCache: Record<string, string>;
  /** Run status keyed by session so switching sessions shows the right pill and never
   *  leaks a running indicator across the switch. Set optimistically on send, then
   *  driven by the daemon's real `status` push: `running` (re)affirms it, `done`/`error`
   *  clear it. Turn frames no longer touch it — clearing on every push was the bug that
   *  flipped the pill back to idle on the first streamed frame. */
  runStatus: Record<string, { since: number }>;
  /** Bumped per session on every `sendMessage` — drives the transcript's snap-to-sent
   *  (`jumpNonce`), so a send re-pins the view to bottom even after a manual scroll-up. */
  sendNonce: Record<string, number>;
  /** Console-local "switched model" system notes per session, positioned by the count of
   *  turn-derived frames already appended when the note was recorded (`afterCount`) — the
   *  vm splices each note in after that many turns so it lands next to the send it
   *  describes. Never sent to the agent; a `ChatVm`/`interleaveNotes` concern, not the wire
   *  `TurnFrame` buffer. */
  notesBySession: Record<string, { afterCount: number; text: string }[]>;
  /** F2: this session's live permission-mode reflection, keyed by sessionId — the
   *  daemon's own `mode` push / `sessionMode` hydration read. Absent ⇒ not yet
   *  hydrated (the vm falls back to the active agent's configured default). */
  modeBySession: Record<string, SessionModeState>;
  /** F2: every approval request still awaiting a reply, per session, oldest first
   *  (FIFO — the longest-waiting ask is what's blocking the session). The
   *  daemon's own live `approval` push queue / `sessionMode` hydration read;
   *  never invented locally. */
  pendingApprovalsBySession: Record<string, PendingApprovalItem[]>;
  /** The last settled turn's usage per session — the daemon's `usage` push (the
   *  adapters' own settlement numbers; never invented locally). The context ring
   *  reads it against the active model's window. */
  usageBySession: Record<string, SessionUsage>;
}

/** App-owned callbacks panels invoke to drive the console. */
export interface ConsoleActions {
  setRoute: (panelId: string) => void;
  refresh: () => void;
  /** Select an account for its provider, or reset a provider to ambient (`label: 'ambient', provider`). */
  switchAccount: (label: string, provider?: string) => void;
  setSettings: (patch: Partial<ConsoleSettings>) => void;
  toggleRaw: () => void;
  /** F2: answer a pending ask docked to the composer for the active session — the
   *  real ask/response round trip (proxies the daemon `respondApproval`), never a
   *  local-only decision. */
  respondApproval: (requestId: string, decision: 'approve' | 'deny') => void;
  /** F2: live-switch a session's permission mode (proxies the daemon `setMode`).
   *  Visibility IS the guardrail — no confirmation gate on switching to a riskier
   *  mode. Fire-and-forget; the chip's own reflection updates from the daemon's
   *  `mode` push, not optimistically here. */
  setPermissionMode: (sessionId: string, mode: PermissionMode) => void;
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
  /** Send a prompt to the active session's agent (starts a governed daemon session).
   *  `attachments` ride the same send (images/text files, the shared wire shape);
   *  omitted/empty ⇒ byte-identical to a plain text send. */
  sendMessage: (text: string, attachments?: readonly Attachment[]) => void;
  /** Resolve a system banner action (e.g. the drift banner's `recompile`/`keep`).
   *  Always dismisses the banner; `recompile` also refreshes the running prompt. */
  onBannerAction: (sessionId: string, bannerId: string, actionId: string) => void;
  /** Deliberately switch a session's model/provider for its next turn (the in-chat
   *  control). The next send routes there and the daemon persists it as the new pin. */
  setSessionModel: (sessionId: string, selection: ModelSelection) => void;
  /** Reveal a touched file (a tool card's path/match link) in the editor/OS at an
   *  optional line, confined to the given session's worktree. Resolves an advisory
   *  result the caller toasts on failure — never blocks. */
  openPath: (
    path: string,
    line: number | undefined,
    sessionId: string | undefined,
  ) => Promise<{ ok: boolean; revealed?: 'editor' | 'folder'; reason?: string }>;
  /** Open a web URL (a tool card's WebSearch/WebFetch link) in the default browser.
   *  Validated to http(s) by main; resolves an advisory result the caller toasts on
   *  failure — never blocks. */
  openExternal: (url: string) => Promise<{ ok: boolean; reason?: string }>;
  /** The Stop/Esc affordance: cooperatively interrupts a session's running turn
   *  (advisory — a user stop, never a governance block). Fire-and-forget; the running
   *  pill clears from the daemon's own `'interrupted'` status Push. */
  interruptSession: (sessionId: string) => void;
  /** Steer: send a message that reaches a session's running turn at its next step, discarding
   *  nothing (advisory — a user redirect, never a block). Fire-and-forget; the transcript updates
   *  from the daemon's own turn Push. Queue-mode follow-ups are held console-side by the panel. */
  steerSession: (sessionId: string, text: string) => void;
}

/** The single object pushed into the engine via setDaemonState: data down,
 *  actions up. Every panel's pure selectVm reads only what it needs. */
export interface ConsoleState {
  data: ConsoleData;
  ui: ConsoleUi;
  actions: ConsoleActions;
}

export function initialState(actions: ConsoleActions): ConsoleState {
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
      models: { status: 'loading' },
      modelMetadata: { status: 'loading' },
      roles: { status: 'loading' },
      packages: { status: 'loading' },
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
    },
    actions,
  };
}
