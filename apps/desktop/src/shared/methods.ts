import {
  AccountsSchema,
  ActiveAccountSchema,
  AgentListSchema,
  AuthViewSchema,
  CapStateSchema,
  FeedViewSchema,
  ModelCatalogViewSchema,
  PackageSummaryListSchema,
  ReasoningProfileSchema,
  RoleSummaryListSchema,
  SessionListSchema,
  TimelineSchema,
  modelSelectionSchema,
  modelDescriptorSchema,
  persistedTurnsSchema,
} from '@coa/console-viewmodel';
import { z } from 'zod';
import { ConsoleSettingsSchema } from './settings.js';

/** Params/result for starting a governed session from the console (proxies the daemon `createSession`). */
export const StartSessionParamsSchema = z.object({
  input: z.string(),
  /** The persistent conversation this send belongs to (R-7); absent ⇒ an ephemeral one-shot. */
  conversationId: z.string().optional(),
  roles: z.array(z.string()).optional(),
  scope: z.string().optional(),
  model: modelSelectionSchema.optional(),
  /** Assembly selection: opt-in packages added / default packages excluded (role-gated). */
  packageIds: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});
export const StartSessionResultSchema = z.object({ sessionId: z.string(), worktree: z.string() });

/** Params for creating a persistent session record (R-7) — proxies the daemon `newSession`. */
export const NewSessionParamsSchema = z.object({
  agentRef: z.string(),
  scope: z.string().optional(),
});
export const NewSessionResultSchema = z.object({ id: z.string() });
const OkResultSchema = z.object({ ok: z.boolean() });

/** Reveal-in-editor (a tool card's path/match click). `sessionId` names whose worktree
 *  root the (worktree-relative) path resolves against; `line` jumps VS Code to the line.
 *  The result is advisory (SC-1 — surface, never block): `revealed` says how it opened
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
 *  to `http:`/`https:` only — any other scheme is refused. Advisory (SC-1 — surface, never
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

/** The one-way main→renderer event channel carrying the daemon's CON-PUSH stream. */
export const PUSH_CHANNEL = 'coa:push';

/**
 * Daemon lifecycle control (the title-bar Start/Stop/Restart). This is a
 * main-process/transport concern — NOT a daemon RPC read — so it lives outside
 * {@link METHODS} on its own channels, with status pushed one-way like {@link PUSH_CHANNEL}.
 */
export type DaemonStatus = 'stopped' | 'starting' | 'running' | 'error';
export const DaemonStatusSchema = z.enum(['stopped', 'starting', 'running', 'error']);
/** One-way main→renderer channel carrying {@link DaemonStatus} changes. */
export const DAEMON_STATUS_CHANNEL = 'coa:daemon-status';
/** Renderer→main invoke channels for the control actions. */
export const DAEMON_CONTROL = {
  status: 'coa:daemon:status',
  start: 'coa:daemon:start',
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
  | 'refresh'
  | 'startSession'
  | 'newSession'
  | 'listSessions'
  | 'reloadConversation'
  | 'renameSession'
  | 'deleteSession'
  | 'recompilePrompt'
  | 'interruptSession'
  | 'steerSession'
  | 'subscribeSession'
  | 'listModels'
  | 'modelCatalog'
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
  | 'editCommand'
  | 'getWorkspace'
  | 'getLayout'
  | 'saveLayout'
  | 'getSettings'
  | 'saveSettings'
  | 'listAgents'
  | 'writeAgents';

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
  removeProvider: { params: z.object({ providerId: z.string() }), result: AuthViewSchema },
  addCredential: {
    params: z.object({ providerId: z.string(), label: z.string(), secret: z.string() }),
    result: AuthViewSchema,
  },
  replaceSecret: { params: z.object({ id: z.string(), secret: z.string() }), result: AuthViewSchema },
  renameCredential: { params: z.object({ id: z.string(), label: z.string() }), result: AuthViewSchema },
  removeCredential: { params: z.object({ id: z.string() }), result: AuthViewSchema },
  setProviderEnabled: { params: z.object({ providerId: z.string(), on: z.boolean() }), result: AuthViewSchema },
  setCredentialDisabled: { params: z.object({ id: z.string(), disabled: z.boolean() }), result: AuthViewSchema },
  makeActive: { params: z.object({ id: z.string() }), result: AuthViewSchema },
  clearCooldown: { params: z.object({ id: z.string() }), result: AuthViewSchema },
  refresh: { result: AuthViewSchema },
  startSession: { params: StartSessionParamsSchema, result: StartSessionResultSchema },
  newSession: { params: NewSessionParamsSchema, result: NewSessionResultSchema },
  listSessions: { result: SessionListSchema },
  reloadConversation: { params: z.object({ id: z.string() }), result: persistedTurnsSchema },
  renameSession: {
    params: z.object({ id: z.string(), title: z.string() }),
    result: OkResultSchema,
  },
  deleteSession: { params: z.object({ id: z.string() }), result: OkResultSchema },
  recompilePrompt: {
    params: z.object({ sessionId: z.string() }),
    result: z.object({ recompiled: z.boolean() }),
  },
  /** The Stop control / Esc affordance — proxies the daemon's cooperative
   *  `interruptSession` (CHAT-10, H1). SC-1: a user stop, never a governance block. */
  interruptSession: {
    params: z.object({ id: z.string() }),
    result: z.object({ interrupted: z.boolean() }),
  },
  /** Send a message to a running turn — proxies the daemon's `steerSession` (CHAT-10). `barge-in`
   *  interrupts + redirects the in-flight turn; `queue` runs it as a follow-up. SC-1: steering is a
   *  user redirect, never a governance block. */
  steerSession: {
    params: z.object({ id: z.string(), text: z.string(), mode: z.enum(['queue', 'barge-in']) }),
    result: z.object({ steered: z.boolean() }),
  },
  /** Console reattach (G4) — proxies the daemon's `subscribeSession`. Called when a
   *  conversation becomes the active one; the daemon immediately hydrates this
   *  connection with the session's CURRENT run-status, so a reload mid-run reads
   *  `running` from the daemon snapshot, not from this renderer's own send-tracking. */
  subscribeSession: {
    params: z.object({ id: z.string() }),
    result: z.object({ subscribed: z.boolean() }),
  },
  listModels: { result: z.array(modelDescriptorSchema) },
  modelCatalog: { result: ModelCatalogViewSchema },
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
  removeModel: { params: z.object({ providerId: z.string(), id: z.string() }), result: ModelCatalogViewSchema },
  setModelHidden: {
    params: z.object({ providerId: z.string(), id: z.string(), hidden: z.boolean() }),
    result: ModelCatalogViewSchema,
  },
  listRoles: { result: RoleSummaryListSchema },
  listPackages: { result: PackageSummaryListSchema },
  openPath: { params: OpenPathParamsSchema, result: OpenPathResultSchema },
  openExternal: { params: OpenExternalParamsSchema, result: OpenExternalResultSchema },
  pickDirectory: { params: PickDirectoryParamsSchema, result: PickDirectoryResultSchema },
  editCommand: { params: EditCommandParamsSchema, result: z.void() },
  /** The open project (name + root), derived by main from the daemon's cwd —
   *  the renderer never guesses a workspace. */
  getWorkspace: { result: z.object({ name: z.string(), root: z.string() }) },
  getLayout: { result: z.unknown() },
  saveLayout: { params: z.unknown(), result: z.void() },
  getSettings: { result: ConsoleSettingsSchema },
  saveSettings: { params: ConsoleSettingsSchema, result: z.void() },
  listAgents: { result: AgentListSchema },
  writeAgents: { params: AgentListSchema, result: z.void() },
};

/** The ipcRenderer/ipcMain channel name for a verb. */
export function channel(m: MethodName): string {
  return `coa:${m}`;
}
