import {
  AccountsSchema,
  ActiveAccountSchema,
  agentFileSchema,
  approvalDecisionSchema,
  attachmentSchema,
  AuthViewSchema,
  CapStateSchema,
  FeedViewSchema,
  ListAgentsResultSchema,
  LoginSnapshotSchema,
  ModelCatalogViewSchema,
  ModelMetadataViewSchema,
  PackageSummaryListSchema,
  permissionModeSchema,
  ReasoningProfileSchema,
  RoleSummaryListSchema,
  SessionListSchema,
  TimelineSchema,
  modelSelectionSchema,
  modelDescriptorSchema,
  reloadedConversationSchema,
} from '@coa/console-viewmodel';
import { z } from 'zod';
import { ConsoleSettingsSchema } from './settings.js';
import { RecentProjectSchema } from './projects.js';

/** Params/result for starting a governed session from the console (proxies the daemon `createSession`). */
export const StartSessionParamsSchema = z.object({
  input: z.string(),
  /** The persistent conversation this send belongs to (persisted by the daemon); absent ⇒ an ephemeral one-shot. */
  conversationId: z.string().optional(),
  roles: z.array(z.string()).optional(),
  scope: z.string().optional(),
  model: modelSelectionSchema.optional(),
  /** Assembly selection: opt-in packages added / default packages excluded (role-gated). */
  packageIds: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  /** Attachments on this send's user message (the one shared wire shape). The daemon
   *  refuses them for a backend whose adapter has no seam — never a silent drop. */
  attachments: z.array(attachmentSchema).optional(),
});
export const StartSessionResultSchema = z.object({ sessionId: z.string(), worktree: z.string() });

/** Params for creating a persistent session record — proxies the daemon `newSession`. */
export const NewSessionParamsSchema = z.object({
  agentRef: z.string(),
  scope: z.string().optional(),
});
export const NewSessionResultSchema = z.object({ id: z.string() });
const OkResultSchema = z.object({ ok: z.boolean() });

/** Only `personal`/`project` are writable scopes — `builtin` definitions ship in
 *  code and are never a save/delete target. */
const WritableAgentScopeSchema = z.enum(['personal', 'project']);
export const SaveAgentParamsSchema = z.object({
  ref: z.string(),
  scope: WritableAgentScopeSchema,
  file: agentFileSchema,
});
export const DeleteAgentParamsSchema = z.object({
  ref: z.string(),
  scope: WritableAgentScopeSchema,
});
export const DeleteAgentResultSchema = z.object({ removed: z.boolean() });

/** Reveal-in-editor (a tool card's path/match click). `sessionId` names whose worktree
 *  root the (worktree-relative) path resolves against; `line` jumps VS Code to the line.
 *  The result is advisory (surface, never block): `revealed` says how it opened
 *  (`editor` via `code -g`, or the `folder` fallback when `code` is absent/failed), and
 *  `reason` carries a message the renderer toasts on failure. */
export const OpenPathParamsSchema = z.object({
  path: z.string(),
  line: z.number().int().positive().optional(),
  sessionId: z.string().optional(),
});
export const OpenPathResultSchema = z.object({
  ok: z.boolean(),
  revealed: z.enum(['editor', 'folder']).optional(),
  reason: z.string().optional(),
});

/** Open a web URL (a tool card's WebSearch/WebFetch link) in the default browser. Validated
 *  to `http:`/`https:` only — any other scheme is refused. Advisory (surface, never
 *  block): the result's `ok` says whether it opened, and `reason` carries a message the
 *  renderer toasts on failure. */
export const OpenExternalParamsSchema = z.object({ url: z.string() });
export const OpenExternalResultSchema = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
});

/** The edit menu's actions (cut/copy/paste/select-all): main drives Chromium's native
 *  editing commands on the focused element, so the renderer draws the menu in the kit's
 *  own skin without ever touching the clipboard itself. */
export const EditCommandParamsSchema = z.object({
  command: z.enum(['cut', 'copy', 'paste', 'selectAll']),
});

/** The native directory picker (a directory field's browse affordance). Main owns the
 *  dialog; the renderer only ever receives the CHOSEN path — cancelling returns no path
 *  at all, so a form can tell "picked nothing" from "picked the empty string". */
export const PickDirectoryParamsSchema = z.object({
  /** Where the dialog opens. A `~`-prefixed path is expanded by main. */
  defaultPath: z.string().optional(),
});
export const PickDirectoryResultSchema = z.object({ path: z.string().optional() });

/**
 * F11 — open (or switch to) a project. `target: 'new'` opens a fresh window;
 * `target: 'current'` swaps the CALLING window to `root` in place. Either way, if
 * `root` is ALREADY open in some window, that window is focused instead — coa
 * never runs two daemons over the same project (a concurrent-write hazard on its
 * `.coa/local/` state), so "already open" always wins over the requested target.
 *
 * The CALLER owns confirming with the user before calling this with
 * `target: 'current'` while its own project has a turn actively running — main
 * performs the swap unconditionally once called; it does not itself gate on
 * in-flight work (only the calling window knows whether one is running).
 */
export const OpenProjectParamsSchema = z.object({
  root: z.string(),
  target: z.enum(['current', 'new']),
});
export const OpenProjectResultSchema = z.object({
  /** What actually happened: a fresh window was opened, the CALLING window was
   *  rebound to this project, or a window ALREADY open on this exact project was
   *  focused instead (never a second window/daemon for the same project). */
  opened: z.enum(['new', 'current', 'focused-existing']),
  workspace: z.object({ name: z.string(), root: z.string() }),
});

/** The recent-projects list (the picker's MRU), each entry decorated with whether
 *  it's open in some window RIGHT NOW — computed live from the window registry,
 *  never persisted — so the picker can show an "already open" affordance instead
 *  of a redundant open control. */
export const RecentProjectViewSchema = RecentProjectSchema.extend({ open: z.boolean() });
export const ListRecentProjectsResultSchema = z.array(RecentProjectViewSchema);

/** F2 — a pending approval request as replayed by `sessionMode`'s snapshot read
 *  (the live `approval` push's own fields minus `sessionId`/`toolClass`, which the
 *  snapshot read does not carry — see the daemon's `PendingApprovalSnapshot`). */
const PendingApprovalSnapshotSchema = z.object({
  requestId: z.string(),
  tool: z.string(),
  summary: z.string(),
  input: z.record(z.string(), z.unknown()),
});

/** F2 — live-switch a session's permission mode, proxies the daemon `setMode`.
 *  `set: false` ⇒ unknown session id, nothing changed. */
export const SetModeParamsSchema = z.object({ id: z.string(), mode: permissionModeSchema });
export const SetModeResultSchema = z.object({ set: z.boolean() });

/** F2 — answer a pending ask, proxies the daemon `respondApproval`. `resolved: false`
 *  ⇒ unknown session id, or no pending request with that id (a harmless no-op, not
 *  an error — answering an already-answered/stale id twice never fails). */
export const RespondApprovalParamsSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  decision: approvalDecisionSchema,
});
export const RespondApprovalResultSchema = z.object({ resolved: z.boolean() });

/** F2 — a plain synchronous read of a session's current permission-mode state
 *  (mode, the mode actually enforced, and every ask still awaiting a reply),
 *  proxies the daemon `sessionMode`. Used to hydrate a reattach (e.g. a console
 *  reload while a manual-mode ask is still blocking the session) without waiting
 *  on the next live push. `found: false` ⇒ unknown session id. */
export const SessionModeResultSchema = z.union([
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    mode: permissionModeSchema,
    effectiveMode: permissionModeSchema,
    pending: z.array(PendingApprovalSnapshotSchema),
  }),
]);

/** The one-way main→renderer event channel carrying the daemon's CON-PUSH stream. */
export const PUSH_CHANNEL = 'coa:push';

/**
 * Daemon lifecycle control (the title-bar Start/Stop/Restart). This is a
 * main-process/transport concern — NOT a daemon RPC read — so it lives outside
 * {@link METHODS} on its own channels, with status pushed one-way like {@link PUSH_CHANNEL}.
 */
export type DaemonStatus = 'stopped' | 'starting' | 'running' | 'error';
export const DaemonStatusSchema = z.enum(['stopped', 'starting', 'running', 'error']);
/**
 * What main tells the renderer about the daemon: the state AND, when the state is a
 * failure, why. The status alone can only ever say "something went wrong" — which
 * leaves the gate telling the user a fact they cannot act on. `reason` is a plain
 * human-readable line (the daemon's own stderr where it said anything, otherwise the
 * error that ended the connect), absent whenever there is nothing to explain.
 */
export interface DaemonReport {
  status: DaemonStatus;
  reason?: string;
}
export const DaemonReportSchema = z.object({
  status: DaemonStatusSchema,
  reason: z.string().optional(),
});
/** One-way main→renderer channel carrying {@link DaemonReport} changes. */
export const DAEMON_STATUS_CHANNEL = 'coa:daemon-status';
/** Renderer→main invoke channels for the control actions. */
export const DAEMON_CONTROL = {
  status: 'coa:daemon:status',
  start: 'coa:daemon:start',
  /** Attach to a daemon that is already serving, never spawn one (see `DaemonManager.adopt`). */
  adopt: 'coa:daemon:adopt',
  stop: 'coa:daemon:stop',
  restart: 'coa:daemon:restart',
} as const;
export type DaemonControlName = keyof typeof DAEMON_CONTROL;

/**
 * Custom window controls (min/max/close). With the native title bar hidden, the
 * frame's buttons are drawn in the DOM (so they zoom with the content) and drive the
 * window over these channels — a transport concern owned by main, like the daemon
 * control above. The maximize state is pushed one-way so the middle button's glyph
 * (maximize ⇄ restore) tracks the real window state.
 */
export const WINDOW_CONTROL = {
  minimize: 'coa:window:minimize',
  toggleMaximize: 'coa:window:toggle-maximize',
  close: 'coa:window:close',
} as const;
export type WindowControlName = keyof typeof WINDOW_CONTROL;
/** One-way main→renderer channel carrying the window's maximized state (boolean). */
export const WINDOW_STATE_CHANNEL = 'coa:window-maximized';

/**
 * The single source of truth for the IPC bridge: each verb -> its params/result
 * Zod schemas, consumed by BOTH the preload/main validation and the renderer.
 * `capState` proxies the daemon read verb; `getLayout`/`saveLayout` are main-local
 * file ops. The layout descriptor is console-local and re-validated at the renderer
 * edge (parseDescriptor), so main persists it opaquely (z.unknown).
 */
export interface MethodSpec {
  params?: z.ZodType | undefined;
  result: z.ZodType;
}

export type MethodName =
  | 'capState'
  | 'flagsForUser'
  | 'listTimeline'
  | 'listAccounts'
  | 'currentAccount'
  | 'useAccount'
  | 'authView'
  | 'addProvider'
  | 'removeProvider'
  | 'addCredential'
  | 'replaceSecret'
  | 'renameCredential'
  | 'removeCredential'
  | 'setProviderEnabled'
  | 'setCredentialDisabled'
  | 'makeActive'
  | 'clearCooldown'
  | 'setIsolatedBrowserLogins'
  | 'setBrowserPath'
  | 'reclaimBrowserProfiles'
  | 'refresh'
  | 'startSession'
  | 'newSession'
  | 'listSessions'
  | 'reloadConversation'
  | 'deleteSession'
  | 'recompilePrompt'
  | 'interruptSession'
  | 'steerSession'
  | 'subscribeSession'
  | 'setMode'
  | 'respondApproval'
  | 'sessionMode'
  | 'listModels'
  | 'modelCatalog'
  | 'modelMetadata'
  | 'addModels'
  | 'addCustomModel'
  | 'editModel'
  | 'removeModel'
  | 'setModelHidden'
  | 'listRoles'
  | 'listPackages'
  | 'openPath'
  | 'openExternal'
  | 'pickDirectory'
  | 'openProject'
  | 'listRecentProjects'
  | 'editCommand'
  | 'getWorkspace'
  | 'getLayout'
  | 'saveLayout'
  | 'getSettings'
  | 'saveSettings'
  | 'listAgents'
  | 'saveAgent'
  | 'deleteAgent'
  | 'startLogin'
  | 'loginState'
  | 'submitLoginCode'
  | 'cancelLogin'
  | 'resolveLoginMismatch'
  | 'probeHealth'
  | 'reportAuthFailure';

export const METHODS: Record<MethodName, MethodSpec> = {
  capState: { result: CapStateSchema },
  flagsForUser: { result: FeedViewSchema },
  listTimeline: { result: TimelineSchema },
  listAccounts: { result: AccountsSchema },
  currentAccount: { result: ActiveAccountSchema },
  useAccount: {
    params: z.object({ label: z.string(), provider: z.string().optional() }),
    result: ActiveAccountSchema,
  },
  authView: { result: AuthViewSchema },
  addProvider: { params: z.object({ providerId: z.string() }), result: AuthViewSchema },
  removeProvider: {
    params: z.object({ providerId: z.string(), removeProfiles: z.boolean().optional() }),
    result: AuthViewSchema,
  },
  addCredential: {
    params: z.object({ providerId: z.string(), label: z.string(), secret: z.string() }),
    result: AuthViewSchema,
  },
  replaceSecret: {
    params: z.object({ id: z.string(), secret: z.string() }),
    result: AuthViewSchema,
  },
  renameCredential: {
    params: z.object({ id: z.string(), label: z.string() }),
    result: AuthViewSchema,
  },
  removeCredential: {
    params: z.object({ id: z.string(), removeProfile: z.boolean().optional() }),
    result: AuthViewSchema,
  },
  setProviderEnabled: {
    params: z.object({ providerId: z.string(), on: z.boolean() }),
    result: AuthViewSchema,
  },
  setCredentialDisabled: {
    params: z.object({ id: z.string(), disabled: z.boolean() }),
    result: AuthViewSchema,
  },
  makeActive: { params: z.object({ id: z.string() }), result: AuthViewSchema },
  clearCooldown: { params: z.object({ id: z.string() }), result: AuthViewSchema },
  setIsolatedBrowserLogins: { params: z.object({ on: z.boolean() }), result: AuthViewSchema },
  setBrowserPath: { params: z.object({ path: z.string() }), result: AuthViewSchema },
  reclaimBrowserProfiles: {
    params: z.object({ names: z.array(z.string()) }),
    result: AuthViewSchema,
  },
  refresh: { result: AuthViewSchema },
  startSession: { params: StartSessionParamsSchema, result: StartSessionResultSchema },
  newSession: { params: NewSessionParamsSchema, result: NewSessionResultSchema },
  listSessions: { result: SessionListSchema },
  reloadConversation: { params: z.object({ id: z.string() }), result: reloadedConversationSchema },
  deleteSession: { params: z.object({ id: z.string() }), result: OkResultSchema },
  recompilePrompt: {
    params: z.object({ sessionId: z.string() }),
    result: z.object({ recompiled: z.boolean() }),
  },
  /** The Stop control / Esc affordance — proxies the daemon's cooperative
   *  `interruptSession`. A user stop, never a governance block. */
  interruptSession: {
    params: z.object({ id: z.string() }),
    result: z.object({ interrupted: z.boolean() }),
  },
  /** Send a message to a running turn — proxies the daemon's `steerSession`. Delivered at the
   *  turn's next round trip, discarding nothing. steering is a user redirect, never a
   *  governance block. */
  steerSession: {
    params: z.object({ id: z.string(), text: z.string() }),
    result: z.object({ steered: z.boolean() }),
  },
  /** Console reattach — proxies the daemon's `subscribeSession`. Called when a
   *  conversation becomes the active one; the daemon immediately hydrates this
   *  connection with the session's CURRENT run-status, so a reload mid-run reads
   *  `running` from the daemon snapshot, not from this renderer's own send-tracking. */
  subscribeSession: {
    params: z.object({ id: z.string() }),
    result: z.object({ subscribed: z.boolean() }),
  },
  /** F2 — live-switch a session's permission mode. Proxies the daemon `setMode`;
   *  the chip's own reflection updates from the resulting `mode` push, not this
   *  response (see {@link SetModeResultSchema}). */
  setMode: { params: SetModeParamsSchema, result: SetModeResultSchema },
  /** F2 — answer a pending ask (the composer's docked approve/deny gate). Proxies
   *  the daemon `respondApproval`. */
  respondApproval: { params: RespondApprovalParamsSchema, result: RespondApprovalResultSchema },
  /** F2 — a session's current permission-mode snapshot (mode/effectiveMode/every
   *  pending ask), for reattach hydration. Proxies the daemon `sessionMode`. */
  sessionMode: { params: z.object({ id: z.string() }), result: SessionModeResultSchema },
  listModels: { result: z.array(modelDescriptorSchema) },
  modelCatalog: { result: ModelCatalogViewSchema },
  /** Per-model info (context window/pricing/modalities/reasoning) — the context
   *  ring, the model-picker hover card, and attach-control capability gating all
   *  read this. Proxies the daemon `modelMetadata`. */
  modelMetadata: {
    params: z.object({ provider: z.string().optional() }).optional(),
    result: ModelMetadataViewSchema,
  },
  addModels: {
    params: z.object({ providerId: z.string(), ids: z.array(z.string()) }),
    result: ModelCatalogViewSchema,
  },
  addCustomModel: {
    params: z.object({
      providerId: z.string(),
      id: z.string(),
      label: z.string().optional(),
      reasoning: ReasoningProfileSchema.optional(),
    }),
    result: ModelCatalogViewSchema,
  },
  editModel: {
    params: z.object({
      providerId: z.string(),
      id: z.string(),
      label: z.string().optional(),
      reasoning: ReasoningProfileSchema.optional(),
    }),
    result: ModelCatalogViewSchema,
  },
  removeModel: {
    params: z.object({ providerId: z.string(), id: z.string() }),
    result: ModelCatalogViewSchema,
  },
  setModelHidden: {
    params: z.object({ providerId: z.string(), id: z.string(), hidden: z.boolean() }),
    result: ModelCatalogViewSchema,
  },
  listRoles: { result: RoleSummaryListSchema },
  listPackages: { result: PackageSummaryListSchema },
  openPath: { params: OpenPathParamsSchema, result: OpenPathResultSchema },
  openExternal: { params: OpenExternalParamsSchema, result: OpenExternalResultSchema },
  pickDirectory: { params: PickDirectoryParamsSchema, result: PickDirectoryResultSchema },
  /** Open/switch/focus a project window — see {@link OpenProjectParamsSchema}. */
  openProject: { params: OpenProjectParamsSchema, result: OpenProjectResultSchema },
  /** The recent-projects MRU, each entry live-annotated with whether it's open. */
  listRecentProjects: { result: ListRecentProjectsResultSchema },
  editCommand: { params: EditCommandParamsSchema, result: z.void() },
  /** The CALLING window's open project (name + root), derived by main from which
   *  project that specific window is bound to (F11: one daemon/root per window,
   *  never one app-wide workspace) — the renderer never guesses a workspace. */
  getWorkspace: { result: z.object({ name: z.string(), root: z.string() }) },
  getLayout: { result: z.unknown() },
  saveLayout: { params: z.unknown(), result: z.void() },
  getSettings: { result: ConsoleSettingsSchema },
  saveSettings: { params: ConsoleSettingsSchema, result: z.void() },
  /** The daemon's registered agents (built-in ∪ personal ∪ project) PLUS any load
   *  diagnostics (duplicate ref, invalid file) — carried through to the renderer,
   *  which surfaces them in the Agents panel rather than letting a broken agent
   *  file just silently not show up. */
  listAgents: { result: ListAgentsResultSchema },
  /** Write one agent definition to `personal`/`project` — proxies the daemon
   *  `saveAgent`. A `builtin` scope is refused by the daemon's own params schema. */
  saveAgent: { params: SaveAgentParamsSchema, result: OkResultSchema },
  /** Remove one agent definition — proxies the daemon `deleteAgent`. `removed` is
   *  `false` ONLY when there was nothing there to remove (a double delete is not an
   *  error); a remove that actually failed comes back as an RPC error, not as a
   *  successful `removed: false`. */
  deleteAgent: { params: DeleteAgentParamsSchema, result: DeleteAgentResultSchema },
  startLogin: {
    params: z.object({ email: z.string(), credentialId: z.string().optional() }),
    result: LoginSnapshotSchema,
  },
  loginState: { result: LoginSnapshotSchema },
  submitLoginCode: { params: z.object({ code: z.string() }), result: LoginSnapshotSchema },
  cancelLogin: { result: LoginSnapshotSchema },
  resolveLoginMismatch: {
    params: z.object({ action: z.enum(['keep', 'retry']) }),
    result: LoginSnapshotSchema,
  },
  probeHealth: { result: AuthViewSchema },
  reportAuthFailure: { params: z.object({ credentialId: z.string() }), result: AuthViewSchema },
};

/** The ipcRenderer/ipcMain channel name for a verb. */
export function channel(m: MethodName): string {
  return `coa:${m}`;
}
