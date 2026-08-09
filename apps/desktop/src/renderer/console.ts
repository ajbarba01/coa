import {
  parseAgentsResult,
  pushSchema,
  pushToViewFrames,
  reasoningValue,
  reconcileStreaming,
  reloadToViewFrames,
  type AgentFile,
  type AgentSummary,
  type ApprovalDecision,
  type AuthView,
  type CapState,
  type Checkpoint,
  type FeedView,
  type LoginSnapshot,
  type Attachment,
  type ModelCatalogView,
  type ModelDescriptor,
  type ModelMetadataView,
  type ModelSelection,
  type PackageSummary,
  type PermissionMode,
  type ReloadedConversationWire,
  type ReasoningProfile,
  type RoleSummary,
  type SessionSummary,
  type TurnFrame,
} from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../shared/settings.js';
import { modelLabel } from './panels/AgentsPanel.js';
import { resolveSelection } from './panels/selection.js';
import { nextAgentIdentity } from './panels/agentIdentity.js';
import { cacheKey, configKey } from './panels/banners.js';
import {
  initialState,
  type ConsoleState,
  type PendingApprovalItem,
  type Remote,
} from './panels/state.js';
import { reportFailure, reportNotice, surfaceWrite } from './shell/failures.js';
import { applySettings } from './theme.js';

/** F2 — the daemon's answer to the `sessionMode` reattach read: a session's current
 *  permission-mode state, or `{found:false}` for an unknown id. */
export type SessionModeSnapshot =
  | { found: false }
  | {
      found: true;
      mode: PermissionMode;
      effectiveMode: PermissionMode;
      pending: Array<{
        requestId: string;
        tool: string;
        summary: string;
        input: Record<string, unknown>;
      }>;
    };

/** F2 — the honest reason surfaced when a session's enforcement degrades to bypass
 *  (mirrors the daemon's own `LiveSession#modePush` wording, so the reattach-hydrated
 *  read and the live push read as one honest voice, never two). */
const NO_APPROVAL_SEAM_REASON =
  'the active backend has no approval seam — enforcement degrades to bypass';

/** Builds the "switched model" note text from an applied override, e.g.
 *  `switched to Opus 4.8 · high`. `models` resolves the friendly label when the
 *  descriptor is known; falls back to the raw model id otherwise. Effort is omitted
 *  when the override carries no reasoning (defensive — a bare model switch shouldn't
 *  claim an effort it didn't set). Exported for unit testing. */
export function modelSwitchNoteText(override: ModelSelection, models: ModelDescriptor[]): string {
  const descriptor = models.find((m) => m.id === override.model);
  const label = descriptor ? modelLabel(descriptor) : (override.model ?? 'default model');
  const effort = override.reasoning ? reasoningValue(override.reasoning) : undefined;
  return effort !== undefined && effort !== 'off'
    ? `switched to ${label} · ${effort}`
    : `switched to ${label}`;
}

/** The subset of `window.coa` the controller needs (injected for testing). */
export interface ConsoleBridge {
  capState(): Promise<CapState>;
  flagsForUser(): Promise<FeedView>;
  listTimeline(): Promise<Checkpoint[]>;
  listAccounts(): Promise<{
    accounts: { label: string; provider: string }[];
    active: Record<string, string>;
  }>;
  currentAccount(): Promise<{ active: Record<string, string> }>;
  useAccount(params: {
    label: string;
    provider?: string;
  }): Promise<{ active: Record<string, string> }>;
  startSession(params: {
    input: string;
    conversationId?: string;
    roles?: string[];
    model?: ModelSelection;
    packageIds?: string[];
    exclude?: string[];
  }): Promise<{ sessionId: string; worktree: string }>;
  listModels(): Promise<ModelDescriptor[]>;
  /** The per-model info catalog (context window/pricing/modalities/reasoning) —
   *  the context ring, the model-picker hover card, and attach gating read it. */
  modelMetadata(): Promise<ModelMetadataView>;
  // The agent-assembly catalogue for the role/package picker.
  listRoles(): Promise<RoleSummary[]>;
  listPackages(): Promise<PackageSummary[]>;
  // Agents — the daemon-owned registry (built-in ∪ personal ∪ project). Degrades to
  // an empty list when the read fails/is malformed.
  listAgents(): Promise<unknown>;
  saveAgent(params: { ref: string; scope: 'personal' | 'project'; file: AgentFile }): Promise<{
    ok: boolean;
  }>;
  /** `removed: false` means there was nothing there to remove — the benign case. A
   *  remove that actually failed REJECTS instead, so the two are never confused. */
  deleteAgent(params: { ref: string; scope: 'personal' | 'project' }): Promise<{
    removed: boolean;
  }>;
  // Persistent sessions: the rail list + per-session transcript reload.
  listSessions(): Promise<SessionSummary[]>;
  newSession(params: { agentRef: string }): Promise<{ id: string }>;
  reloadConversation(params: { id: string }): Promise<ReloadedConversationWire>;
  deleteSession(params: { id: string }): Promise<{ ok: boolean }>;
  /** Drop a session's frozen prompt + resume token so the next send recompiles (the drift banner's recompile). */
  recompilePrompt(params: { sessionId: string }): Promise<{ recompiled: boolean }>;
  /** The Stop/Esc affordance — proxies the daemon's cooperative `interruptSession`.
   *  Advisory (advisory — a user stop, never a governance block): the pill clears via the
   *  daemon's own `'interrupted'` status Push, not this call's result. */
  interruptSession(params: { id: string }): Promise<{ interrupted: boolean }>;
  /** Steer a running turn — proxies the daemon's `steerSession`. Delivered at the turn's next
   *  round trip, discarding nothing (advisory — a user redirect, never a block). Queue-mode
   *  follow-ups never reach this call; they stay held console-side until the turn ends. */
  steerSession(params: { id: string; text: string }): Promise<{ steered: boolean }>;
  /** Console reattach — proxies the daemon's `subscribeSession`. Called when a
   *  conversation becomes active; the daemon immediately hydrates this connection with
   *  the session's CURRENT run-status, so a reload mid-run reads `running` from the
   *  daemon snapshot rather than from this renderer's own send-tracking (the daemon, not the renderer, owns the live session). */
  subscribeSession(params: { id: string }): Promise<{ subscribed: boolean }>;
  /** F2 — live-switch a session's permission mode; proxies the daemon `setMode`. Takes
   *  effect starting with the NEXT tool call. The chip's own reflection updates from the
   *  resulting `mode` push, not this response (`set` is only whether the id was known). */
  setMode(params: { id: string; mode: PermissionMode }): Promise<{ set: boolean }>;
  /** F2 — answer a pending ask (the composer's docked approve/deny gate); proxies the
   *  daemon `respondApproval`. `resolved: false` ⇒ unknown session id, or no pending
   *  request with that id (a harmless no-op, not an error). */
  respondApproval(params: {
    id: string;
    requestId: string;
    decision: ApprovalDecision;
  }): Promise<{ resolved: boolean }>;
  /** F2 — a session's current permission-mode snapshot; proxies the daemon `sessionMode`.
   *  Used to hydrate a reattach (e.g. a reload while a manual-mode ask still blocks the
   *  session) without waiting on the next live push. */
  sessionMode(params: { id: string }): Promise<SessionModeSnapshot>;
  /** Reveal a touched file in the editor/OS at an optional line (confined to the session's
   *  worktree by main). Advisory — resolves a result; never blocks. */
  openPath(params: { path: string; line?: number; sessionId?: string }): Promise<{
    ok: boolean;
    revealed?: 'editor' | 'folder';
    reason?: string;
  }>;
  /** Open a web URL in the default browser (validated to http(s) by main). Advisory —
   *  resolves a result; never blocks. */
  openExternal(params: { url: string }): Promise<{ ok: boolean; reason?: string }>;
  /** Subscribe to the daemon push stream; returns an unsubscribe. */
  onPush(listener: (payload: unknown) => void): () => void;
  getSettings(): Promise<ConsoleSettings>;
  saveSettings(settings: ConsoleSettings): Promise<void>;
}

/**
 * The auth surface's RPC callers. Unlike the rest of this module, these don't flow through
 * `startConsole`'s injected `ConsoleBridge` — the auth store (`panels/authStore.ts`) is a
 * standalone zustand store (shared by the auth surface, the usage surface, and the nav HUD),
 * not part of the single `ConsoleState` pipeline, so it reaches the preload bridge directly.
 * Exported (rather than inlined in the store) so a test can `vi.mock` this module and hand
 * the store a fake — the store itself never talks to `window.coa`.
 */
export const rpcAuthView = (): Promise<AuthView> => window.coa.authView();
export const rpcAddProvider = (providerId: string): Promise<AuthView> =>
  window.coa.addProvider({ providerId });
export const rpcRemoveProvider = (
  providerId: string,
  removeProfiles?: boolean,
): Promise<AuthView> =>
  window.coa.removeProvider({
    providerId,
    ...(removeProfiles !== undefined ? { removeProfiles } : {}),
  });
export const rpcAddCredential = (
  providerId: string,
  label: string,
  secret: string,
): Promise<AuthView> => window.coa.addCredential({ providerId, label, secret });
export const rpcReplaceSecret = (id: string, secret: string): Promise<AuthView> =>
  window.coa.replaceSecret({ id, secret });
export const rpcRenameCredential = (id: string, label: string): Promise<AuthView> =>
  window.coa.renameCredential({ id, label });
export const rpcRemoveCredential = (id: string, removeProfile?: boolean): Promise<AuthView> =>
  window.coa.removeCredential({ id, ...(removeProfile !== undefined ? { removeProfile } : {}) });
export const rpcSetIsolatedBrowserLogins = (on: boolean): Promise<AuthView> =>
  window.coa.setIsolatedBrowserLogins({ on });
export const rpcSetBrowserPath = (path: string): Promise<AuthView> =>
  window.coa.setBrowserPath({ path });
export const rpcReclaimBrowserProfiles = (names: string[]): Promise<AuthView> =>
  window.coa.reclaimBrowserProfiles({ names });
export const rpcSetProviderEnabled = (providerId: string, on: boolean): Promise<AuthView> =>
  window.coa.setProviderEnabled({ providerId, on });
export const rpcSetCredentialDisabled = (id: string, disabled: boolean): Promise<AuthView> =>
  window.coa.setCredentialDisabled({ id, disabled });
export const rpcMakeActive = (id: string): Promise<AuthView> => window.coa.makeActive({ id });
export const rpcClearCooldown = (id: string): Promise<AuthView> => window.coa.clearCooldown({ id });
/** Named distinctly from `ConsoleController.refresh` (a different read entirely) — this
 *  re-reads every pointer locator (identity, expiry, limits) for the auth surface's ⟳. */
export const rpcRefreshAuth = (): Promise<AuthView> => window.coa.refresh();

/**
 * The driven-login flow's RPC callers, mirroring the block above — the `loginStore`
 * (`panels/loginStore.ts`) reaches the preload bridge only through these.
 */
export const rpcStartLogin = (params: {
  email: string;
  credentialId?: string;
}): Promise<LoginSnapshot> => window.coa.startLogin(params);
export const rpcLoginState = (): Promise<LoginSnapshot> => window.coa.loginState();
export const rpcSubmitLoginCode = (code: string): Promise<LoginSnapshot> =>
  window.coa.submitLoginCode({ code });
export const rpcCancelLogin = (): Promise<LoginSnapshot> => window.coa.cancelLogin();
export const rpcResolveLoginMismatch = (action: 'keep' | 'retry'): Promise<LoginSnapshot> =>
  window.coa.resolveLoginMismatch({ action });
export const rpcProbeHealth = (): Promise<AuthView> => window.coa.probeHealth();
export const rpcReportAuthFailure = (credentialId: string): Promise<AuthView> =>
  window.coa.reportAuthFailure({ credentialId });

/**
 * The model catalog surface's RPC callers, mirroring the `rpcAuthView` block above — the
 * `modelsStore` (`panels/modelsStore.ts`) reaches the preload bridge only through these.
 */
export const rpcModelCatalog = (): Promise<ModelCatalogView> => window.coa.modelCatalog();
export const rpcAddModels = (p: { providerId: string; ids: string[] }): Promise<ModelCatalogView> =>
  window.coa.addModels(p);
export const rpcAddCustomModel = (p: {
  providerId: string;
  id: string;
  label?: string;
  reasoning?: ReasoningProfile;
}): Promise<ModelCatalogView> => window.coa.addCustomModel(p);
export const rpcEditModel = (p: {
  providerId: string;
  id: string;
  label?: string;
  reasoning?: ReasoningProfile;
}): Promise<ModelCatalogView> => window.coa.editModel(p);
export const rpcRemoveModel = (p: { providerId: string; id: string }): Promise<ModelCatalogView> =>
  window.coa.removeModel(p);
export const rpcSetModelHidden = (p: {
  providerId: string;
  id: string;
  hidden: boolean;
}): Promise<ModelCatalogView> => window.coa.setModelHidden(p);

/** What an auth-shaped failure LOOKS like in an error frame. Advisory on purpose:
 *  a false hit costs an amber dot the next probe clears, never a block — so the net is
 *  wide (401s, OAuth, login wording) but only ever reads ERROR frames, never chat. */
const AUTH_FAILURE = /auth|401|unauthorized|oauth|logged? ?in|login/i;

/** Pure: whether a batch of pushed frames carries an auth failure. Exported for tests. */
export function detectAuthFailure(frames: TurnFrame[]): boolean {
  return frames.some((f) => f.kind === 'error' && AUTH_FAILURE.test(f.message));
}

/** The auth-failure hook, mirroring `onModelsChanged` below: the bootstrap registers the
 *  store-side reporter (loginStore's — it owns the auth-store reach) so the push consumer
 *  can flag the active login WITHOUT importing the auth store, which imports this module's
 *  rpc wrappers — a static cycle the dependency ruleset forbids. */
let authFailureSink: () => void = () => {};
export const onAuthFailure = (fn: () => void): void => {
  authFailureSink = fn;
};

/** The models-changed hook: the controller registers its `loadModels` here so a
 *  catalog edit refreshes the chip/agent-picker feed in the same breath. */
let modelsChanged: () => Promise<void> = () => Promise.resolve();
export const onModelsChanged = (fn: () => Promise<void>): void => {
  modelsChanged = fn;
};
export const notifyModelsChanged = (): Promise<void> => modelsChanged();

export interface ConsoleController {
  refresh(): Promise<void>;
  /** Re-run the one-shot boot loads. Recovers a cold boot where the daemon wasn't up yet
   *  when `startConsole` fired them (they settled into error Remotes and nothing else
   *  ever retries them) — call this when the daemon transitions to `running`. */
  hydrate(): Promise<void>;
  /** Forget every session this renderer believes is running — call it on the same daemon
   *  transition as `hydrate`, and before it. A fresh daemon connection cannot be running a
   *  turn this renderer started, so anything still in the map is a leftover claim. */
  clearRunState(): void;
  toggleRaw(): void;
  dispose(): void;
}

/** Run a read, mapping success/failure into a Remote (never throws). */
async function settle<T>(read: () => Promise<T>): Promise<Remote<T>> {
  try {
    return { status: 'ok', value: await read() };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Cheap structural equality for a `Remote`. `cap`/`flags`/`timeline` are plain JSON
 *  (no functions, Dates, or cycles — see `@coa/console-viewmodel`'s Zod-inferred
 *  types), so stringifying is a fine substitute for a real deep-equal here. Used to
 *  stop the ~2s poll (`App.tsx`) from replacing `ConsoleState` — and republishing to
 *  every `(s) => s` subscriber — when a tick returns exactly what the last one did. */
function remoteEqual<T>(a: Remote<T>, b: Remote<T>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What a failed agent write puts back. Every agent mutation renders its edit
 *  optimistically before the daemon has written anything, so a rejected write has to
 *  restore the list — otherwise the row stays on screen claiming a save that never
 *  landed. `selection` is carried only by the mutations that moved the editor
 *  selection: `claimed` is what they set it to, and the undo fires only while that is
 *  still the selection, so a user who clicked another agent mid-write isn't yanked
 *  back to this one. */
interface AgentUndo {
  agents: AgentSummary[];
  selection?: { claimed: string | undefined; previous: string | undefined };
}

export async function startConsole(
  bridge: ConsoleBridge,
  sinks: { publish: (s: ConsoleState) => void; navigate: (surface: string) => void },
): Promise<ConsoleController> {
  const settings = await bridge.getSettings();
  applySettings(settings);

  // Mount with placeholder actions; the real actions (which capture the outer closure) are
  // installed just below and pushed before any interaction.
  let state: ConsoleState = initialState({
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
  });
  state = { ...state, ui: { ...state.ui, settings } };
  // Agents are daemon-owned (built-in ∪ personal ∪ project). On bootstrap the
  // in-memory copy is hydrated from `listAgents`; a failed/malformed read degrades
  // to the "No agents yet" empty state — never to a mock. Sessions + their turns are
  // REAL: loaded from the daemon's conversation store below (`initSessions`). The mutable
  // copy backs the now-durable agent edits (rename, recolor, pin, description) that
  // persist per-agent via `saveAgent`/`deleteAgent`.
  let agents: AgentSummary[] = [];
  let sessions: SessionSummary[] = [];

  const push = (): void => sinks.publish(state);

  const setRoute = (panelId: string): void => sinks.navigate(panelId);

  async function refresh(): Promise<void> {
    const [cap, flags, timeline] = await Promise.all([
      settle(() => bridge.capState()),
      settle(() => bridge.flagsForUser()),
      settle(() => bridge.listTimeline()),
    ]);
    // Most 2s poll ticks return exactly what the last one did — skip the replace
    // (and the publish it would trigger) when nothing actually changed.
    if (
      remoteEqual(cap, state.data.cap) &&
      remoteEqual(flags, state.data.flags) &&
      remoteEqual(timeline, state.data.timeline)
    ) {
      return;
    }
    state = { ...state, data: { ...state.data, cap, flags, timeline } };
    push();
  }

  async function loadAccounts(): Promise<void> {
    // listAccounts now carries the per-provider active map too, so one read suffices.
    const accounts = await settle(() => bridge.listAccounts());
    state = { ...state, data: { ...state.data, accounts } };
    push();
  }

  async function loadModels(): Promise<void> {
    const models = await settle(() => bridge.listModels());
    state = { ...state, data: { ...state.data, models } };
    push();
  }

  async function loadModelMetadata(): Promise<void> {
    const modelMetadata = await settle(async () => (await bridge.modelMetadata()).entries);
    state = { ...state, data: { ...state.data, modelMetadata } };
    push();
  }

  async function loadCatalogue(): Promise<void> {
    const [roles, packages] = await Promise.all([
      settle(() => bridge.listRoles()),
      settle(() => bridge.listPackages()),
    ]);
    state = { ...state, data: { ...state.data, roles, packages } };
    push();
  }

  const switchAccount = (label: string, provider?: string): void =>
    void (async () => {
      const switched = await surfaceWrite(
        'switch accounts',
        bridge.useAccount({ label, ...(provider !== undefined ? { provider } : {}) }),
      );
      // The switch was refused and said so — the daemon is still on the old account, so
      // there is nothing new to read.
      if (switched === undefined) return;
      await loadAccounts();
      // The merged model list is per-account (that provider's models change) — refetch.
      await loadModels();
    })();

  const setSettings = (patch: Partial<ConsoleSettings>): void => {
    const next = { ...state.ui.settings, ...patch };
    applySettings(next);
    state = { ...state, ui: { ...state.ui, settings: next } };
    push();
    // Defer the disk write until the renderer has painted the change (two frames) —
    // persisting is bookkeeping, never on the interaction path.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void surfaceWrite('save that setting', bridge.saveSettings(next));
      }),
    );
  };

  const toggleRaw = (): void => {
    state = { ...state, ui: { ...state.ui, rawMode: !state.ui.rawMode } };
    push();
  };

  /** F2: answer a pending ask. `requestId` may name either kind of approval the
   *  composer can dock: a transcript-derived one (dev/test data only — the wire
   *  never emits this in production) resolves purely locally via the
   *  `resolvedApprovals` overlay, exactly as before; a genuinely LIVE one (present
   *  in the active session's `pendingApprovalsBySession`) is removed from the
   *  pending queue optimistically and answered for real over `respondApproval` —
   *  the actual F2 ask/response round trip. Both branches can fire for the same
   *  call without conflict: a live requestId is a daemon-minted UUID, so it can
   *  never collide with a hand-authored mock/test id. */
  const respondApproval = (requestId: string, decision: ApprovalDecision): void => {
    const resolved = decision === 'approve' ? 'approved' : 'denied';
    state = {
      ...state,
      ui: {
        ...state.ui,
        resolvedApprovals: { ...state.ui.resolvedApprovals, [requestId]: resolved },
      },
    };
    push();

    const id = state.ui.activeSessionId;
    if (id === undefined) return;
    const pending = state.ui.pendingApprovalsBySession[id] ?? [];
    if (!pending.some((p) => p.requestId === requestId)) return;
    state = {
      ...state,
      ui: {
        ...state.ui,
        pendingApprovalsBySession: {
          ...state.ui.pendingApprovalsBySession,
          [id]: pending.filter((p) => p.requestId !== requestId),
        },
      },
    };
    push();
    void surfaceWrite(
      'respond to that request',
      bridge.respondApproval({ id, requestId, decision }),
    );
  };

  /** F2: live-switch the given session's permission mode (visibility IS the
   *  guardrail — no confirmation gate on switching to a riskier mode). Fire-and-
   *  forget: the chip's own reflection updates from the daemon's `mode` push,
   *  which always follows a successful switch (including back to this caller),
   *  not from an optimistic local write here. */
  const setPermissionMode = (sessionId: string, mode: PermissionMode): void => {
    void surfaceWrite('change the permission mode', bridge.setMode({ id: sessionId, mode }));
  };

  /** F2: hydrate a session's permission-mode state from the daemon's own snapshot
   *  (mode/effectiveMode/every still-pending ask) — called on open/reattach so a
   *  fresh mount (e.g. a reload mid-manual-ask) shows the true current state
   *  instead of the client-side floor. REPLACES rather than merges: the snapshot
   *  is authoritative, so a request resolved while this console was disconnected
   *  must not linger. Ignored if the user has already moved to a different
   *  session by the time it resolves (a stale response). */
  async function hydrateMode(id: string): Promise<void> {
    const snap = await bridge.sessionMode({ id }).catch(() => ({ found: false as const }));
    if (!snap.found || state.ui.activeSessionId !== id) return;
    const degraded = snap.mode !== snap.effectiveMode ? { degraded: NO_APPROVAL_SEAM_REASON } : {};
    const pendingItems: PendingApprovalItem[] = snap.pending.map((p) => ({
      requestId: p.requestId,
      tool: p.tool,
      summary: p.summary,
      input: p.input,
    }));
    state = {
      ...state,
      ui: {
        ...state.ui,
        modeBySession: {
          ...state.ui.modeBySession,
          [id]: { mode: snap.mode, effectiveMode: snap.effectiveMode, ...degraded },
        },
        pendingApprovalsBySession: { ...state.ui.pendingApprovalsBySession, [id]: pendingItems },
      },
    };
    push();
  }

  // ---- Agents — the daemon-owned registry (built-in ∪ personal ∪ project, project
  // winning). Hydrated from `listAgents` on startup; every edit writes THROUGH to
  // the daemon via `saveAgent`/`deleteAgent` (one file per agent — there is no
  // whole-list write anymore). A `builtin` agent ships in code: it is never a
  // save/delete target, so `updateAgent`/`deleteAgent` refuse it (defense in depth —
  // the panel also renders it read-only). ----

  const NEW_AGENT_DESCRIPTION = 'What this agent is for.';

  /** The on-disk shape (`AgentFile`) a summary carries once `ref`/`scope` are
   *  stripped back off — the inverse of what `listAgents` hands back. */
  function toAgentFile(a: AgentSummary): AgentFile {
    const { ref: _ref, scope: _scope, ...file } = a;
    return file;
  }

  /** Publish the in-memory agent list (optimistic UI over the durable per-agent write). */
  const pushAgents = (): void => {
    state = { ...state, data: { ...state.data, agents: { status: 'ok', value: [...agents] } } };
    push();
  };

  /** Re-read the daemon's registry after a mutation settles — the authoritative
   *  reconcile over the optimistic local edit `pushAgents` already rendered. This is
   *  also the ONLY path load diagnostics travel: a save/delete can itself introduce
   *  a duplicate ref (another window/process wrote the same file concurrently), so
   *  re-fetching rather than trusting the optimistic copy is what keeps
   *  `agentDiagnostics` honest. Failures are swallowed here — the optimistic state
   *  already rendered, and the next successful read/mount reconciles it. */
  async function refreshAgents(): Promise<void> {
    const loaded = await settle(async () => parseAgentsResult(await bridge.listAgents()));
    if (loaded.status !== 'ok') return;
    agents = loaded.value.agents;
    state = {
      ...state,
      data: { ...state.data, agentDiagnostics: loaded.value.diagnostics },
    };
    pushAgents();
  }

  /** Drive an agent write whose edit is already on screen: reconcile on SETTLE — not
   *  only on success — and restore the pre-edit list when the write failed, so what is
   *  rendered matches what is on disk. Without the restore a rejected write leaves the
   *  row looking saved, which is the console lying about durable state. Advisory
   *  throughout: the failure ALSO surfaces as the list snapping back, never as a throw and
   *  never as a block. The reconcile runs either way and wins whenever the daemon read
   *  succeeds, since disk is the authority over both the optimistic edit and the undo.
   *
   *  `action` names what the user asked for, because the rollback alone is a poor signal:
   *  a row quietly reverting looks a lot like a row that was never edited. */
  function commitAgentWrite(write: Promise<unknown>, undo: AgentUndo, action: string): void {
    void write
      .catch((error: unknown) => {
        reportFailure(action, error);
        agents = undo.agents;
        const selection = undo.selection;
        if (selection !== undefined && state.ui.selectedAgentRef === selection.claimed) {
          const ui = { ...state.ui };
          if (selection.previous === undefined) delete ui.selectedAgentRef;
          else ui.selectedAgentRef = selection.previous;
          state = { ...state, ui };
        }
        pushAgents();
      })
      .then(() => refreshAgents());
  }

  const selectAgent = (ref: string): void => {
    state = { ...state, ui: { ...state.ui, selectedAgentRef: ref } };
    push();
  };

  const createAgent = (scope: 'project' | 'personal'): void => {
    const { ref, name } = nextAgentIdentity(agents);
    const file: AgentFile = {
      name,
      description: NEW_AGENT_DESCRIPTION,
      icon: 'bot',
      color: 'slate',
    };
    const undo: AgentUndo = {
      agents,
      selection: { claimed: ref, previous: state.ui.selectedAgentRef },
    };
    agents = [...agents, { ...file, ref, scope }];
    state = { ...state, ui: { ...state.ui, selectedAgentRef: ref } };
    pushAgents();
    commitAgentWrite(bridge.saveAgent({ ref, scope, file }), undo, 'create that agent');
  };

  const updateAgent = (ref: string, patch: Partial<Omit<AgentSummary, 'ref'>>): void => {
    const current = agents.find((a) => a.ref === ref);
    if (current === undefined || current.scope === 'builtin') return;
    const prevScope = current.scope;
    const next = { ...current, ...patch };
    // A patched `scope` only ever arrives as 'personal'/'project' (the editor's move
    // action) — anything else (or none) keeps the agent where it already lives.
    const nextScope: 'personal' | 'project' =
      next.scope === 'personal' || next.scope === 'project' ? next.scope : prevScope;
    const undo: AgentUndo = { agents };
    agents = agents.map((a) => (a.ref === ref ? { ...next, scope: nextScope } : a));
    pushAgents();
    const file = toAgentFile({ ...next, scope: nextScope });
    // A scope move WRITES THE NEW COPY FIRST and removes the old one only once that
    // save resolved. Removing first is what turns a half-finished move into data loss:
    // if the save then fails the agent's file is gone from both scopes and there is
    // nothing left to recover it from. In this order the worst outcome is a copy left
    // behind in the old scope — the file still exists, and the reconcile below re-reads
    // the daemon so the list shows where the agent actually resolves from. Be honest
    // about the cost: the daemon treats the same ref in two scopes as an intentional
    // override, not a diagnostic, so that leftover is silent. Silent and recoverable is
    // still strictly better than gone.
    const saved = bridge.saveAgent({ ref, scope: nextScope, file });
    if (nextScope === prevScope) {
      commitAgentWrite(saved, undo, 'save that agent');
      return;
    }
    // A move is TWO writes, so it needs its own report: the generic "couldn't save that
    // agent" names the wrong operation when the copy landed and only the removal of the
    // old file failed (its YAML open in an editor is the everyday cause). Say which half
    // broke — the user is looking at an agent that really is in the new scope, with a
    // stale twin left behind in the old one. Reported and swallowed, not rethrown: the
    // reconcile below re-reads the daemon, so the list still ends up showing the truth,
    // and rolling the edit back would claim the copy never happened. A `removed: false`
    // here stays silent — the old file being gone already IS the finished move.
    const written = saved.then(async () => {
      try {
        await bridge.deleteAgent({ ref, scope: prevScope });
      } catch (error: unknown) {
        const cause = error instanceof Error ? error.message : String(error);
        reportFailure(
          'finish moving that agent',
          `it was copied to ${nextScope}, but the old ${prevScope} copy could not be removed — ${cause}`,
        );
      }
    });
    commitAgentWrite(written, undo, 'save that agent');
  };

  const deleteAgent = (ref: string): void => {
    const current = agents.find((a) => a.ref === ref);
    if (current === undefined || current.scope === 'builtin') return;
    const undo: AgentUndo = {
      agents,
      selection: { claimed: undefined, previous: state.ui.selectedAgentRef },
    };
    agents = agents.filter((a) => a.ref !== ref);
    const ui = { ...state.ui };
    if (ui.selectedAgentRef === ref) delete ui.selectedAgentRef;
    state = { ...state, ui };
    pushAgents();
    // `removed: false` is the answer that used to disappear: the daemon found no file
    // for this agent, so the delete was a no-op. The row goes either way, but the user
    // asked for a removal and nothing was removed — usually because the file had already
    // gone from under the console — and that is worth a word rather than silence.
    const removal = bridge.deleteAgent({ ref, scope: current.scope }).then((result) => {
      if (!result.removed) {
        reportNotice('Nothing to delete', 'that agent had no file left to remove.');
      }
    });
    commitAgentWrite(removal, undo, 'delete that agent');
  };

  const togglePinAgent = (ref: string): void => {
    const pinned = state.ui.settings.pinnedAgents;
    setSettings({
      pinnedAgents: pinned.includes(ref) ? pinned.filter((p) => p !== ref) : [...pinned, ref],
    });
  };

  // ---- Persistent sessions: list + per-session transcript, all daemon-backed ----

  /** Refresh the rail's session list (title/recency) without touching the transcript. */
  async function refreshSessionList(): Promise<void> {
    const loaded = await settle(() => bridge.listSessions());
    if (loaded.status === 'ok') sessions = loaded.value;
    state = { ...state, data: { ...state.data, sessions: loaded } };
    push();
  }

  /** Drop a session's run entry — it is not running, whatever this renderer last thought.
   *  The pill, the steer-mode composer and the queued-message release all hang off this
   *  map, so a stale entry does not merely look wrong: it holds queued follow-ups forever. */
  function clearRunStatus(sessionId: string): void {
    if (state.ui.runStatus[sessionId] === undefined) return;
    const runStatus = { ...state.ui.runStatus };
    delete runStatus[sessionId];
    state = { ...state, ui: { ...state.ui, runStatus } };
    push();
  }

  /** Open a session cache-first: the active id flips SYNCHRONOUSLY — a warm
   *  `turnsBySession` entry renders this same frame; a cold one shows the loading
   *  state — and the persisted-transcript reload reconciles in the background,
   *  ignored if the user has already moved on (stale response). Also
   *  (re)subscribes to the daemon's live session (reattach — the session exists independent of any viewer) so a fresh mount —
   *  e.g. a reload mid-run — hydrates `runStatus` from the daemon's own snapshot
   *  instead of reconstructing it from this renderer's send-tracking (the daemon, not the renderer, owns the live session).
   *  The pill is driven by the resulting status Push (the existing `onPush` handler
   *  below) — with ONE exception, below: a refused subscribe pushes nothing at all. */
  async function openSession(id: string): Promise<void> {
    const cached = turnsBySession.get(id);
    state = {
      ...state,
      data: {
        ...state.data,
        turns: cached !== undefined ? { status: 'ok', value: cached } : { status: 'loading' },
      },
      ui: { ...state.ui, activeSessionId: id },
    };
    push();
    // A reattach the daemon REFUSES is the reattach that matters: `subscribed: false`
    // means it holds no live session for this conversation, so nothing can be running and
    // no hydrating status push is coming. Ignoring that answer is what left a session
    // spinning forever after the daemon died mid-turn — the renderer's own map was the
    // only thing still claiming a turn. The daemon is the authority on liveness in both
    // directions, not just when it says yes.
    //
    // Read the send counter first and only act if it hasn't moved: a send issued while
    // this round trip was in flight is newer news than the answer coming back.
    const sendsAtSubscribe = state.ui.sendNonce[id];
    void bridge
      .subscribeSession({ id })
      .then((result) => {
        if (result.subscribed) return;
        if (state.ui.sendNonce[id] !== sendsAtSubscribe) return;
        clearRunStatus(id);
      })
      .catch(() => {
        // A failed reattach says nothing about liveness — the daemon being unreachable is
        // already the gate's story, and guessing here would be the same lie inverted.
      });
    // F2: hydrate this session's permission-mode state (mode/effectiveMode/every
    // pending ask) the same way the run-status pill hydrates above — a fresh mount
    // must show the daemon's own current state, never a client-side guess.
    void hydrateMode(id);

    const loaded = await settle(() => bridge.reloadConversation({ id }));
    if (loaded.status === 'ok') turnsBySession.set(id, reloadToViewFrames(loaded.value));
    if (state.ui.activeSessionId !== id) return;
    // On a failed refresh a warm cache keeps showing (best-effort reconcile);
    // only a cold open surfaces the error.
    const turns: Remote<TurnFrame[]> =
      loaded.status === 'ok'
        ? { status: 'ok', value: turnsBySession.get(id) ?? [] }
        : cached !== undefined
          ? { status: 'ok', value: cached }
          : loaded;
    state = { ...state, data: { ...state.data, turns } };
    push();
  }

  /** Clear the active selection when no session remains. */
  function clearActiveSession(): void {
    const ui = { ...state.ui };
    delete ui.activeSessionId;
    state = { ...state, data: { ...state.data, turns: { status: 'ok', value: [] } }, ui };
    push();
  }

  const selectSession = (id: string): void => void openSession(id);

  const newSession = (agentRef: string): void =>
    void (async () => {
      const created = await surfaceWrite(
        'start that conversation',
        bridge.newSession({ agentRef }),
      );
      if (created === undefined) return;
      await refreshSessionList();
      await openSession(created.id);
    })();

  const deleteSession = (id: string): void =>
    void (async () => {
      const deleted = await surfaceWrite('delete that conversation', bridge.deleteSession({ id }));
      // Nothing was removed and the user has been told — the rail still shows the truth.
      if (deleted === undefined) return;
      const wasActive = state.ui.activeSessionId === id;
      await refreshSessionList();
      if (wasActive) {
        const newest = sessions[0];
        if (newest) await openSession(newest.id);
        else clearActiveSession();
      }
    })();

  // ---- Live session: route streamed frames to their owning session's buffer ----

  // Per-session live buffers so a background session's streamed frames are retained,
  // not misfiled into whatever transcript is active.
  const turnsBySession = new Map<string, TurnFrame[]>();

  // Frames arriving between animation frames are coalesced (Piece B): token streaming emits
  // many `text-delta` pushes per second, and applying each synchronously (reconcile the whole
  // conversation + a full transcript re-render, per token) saturates the renderer — the
  // transcript and even the elapsed-seconds timer fall behind. Instead we buffer incoming
  // frames per session and flush once per `requestAnimationFrame`, so the transcript repaints
  // at the display's refresh rate (smooth) no matter how fast the tokens arrive.
  const pendingTurns = new Map<string, TurnFrame[]>();
  let flushHandle: number | undefined;

  /** Reconcile every session's buffered frames in one batch and push the active one's
   *  transcript once. Runs on the animation frame, or synchronously when a terminal status
   *  needs the final frames landed first (also the guard against a throttled rAF). */
  const flushTurns = (): void => {
    if (flushHandle !== undefined) {
      cancelAnimationFrame(flushHandle);
      flushHandle = undefined;
    }
    if (pendingTurns.size === 0) return;
    let activeValue: TurnFrame[] | undefined;
    for (const [sessionId, frames] of pendingTurns) {
      const prev = turnsBySession.get(sessionId) ?? [];
      // A `text-delta`/`thinking-delta` accumulates into the live block, then the settled
      // frame replaces it — no double-render (delta frames are delivery-only; the final complete frame is authoritative).
      const next = reconcileStreaming(prev, frames);
      turnsBySession.set(sessionId, next);
      if (sessionId === state.ui.activeSessionId) activeValue = next;
    }
    pendingTurns.clear();
    if (activeValue !== undefined) {
      state = { ...state, data: { ...state.data, turns: { status: 'ok', value: activeValue } } };
      push();
    }
  };

  /** Buffer frames for a session and schedule the coalesced flush. */
  const appendTurns = (sessionId: string, frames: TurnFrame[]): void => {
    if (frames.length === 0) return;
    const q = pendingTurns.get(sessionId);
    if (q !== undefined) q.push(...frames);
    else pendingTurns.set(sessionId, [...frames]);
    if (flushHandle === undefined) flushHandle = requestAnimationFrame(flushTurns);
  };

  // The drift/cache notices are DERIVED live in the chat vm (predictive: computed from
  // the pending pick + the running prompt's config the daemon reports), so the console
  // only holds the bits of notice STATE the derivation reads: the model override and the
  // per-session drift and cache dismissals. A notice action mutates that state.
  const onBannerAction = (sessionId: string, bannerId: string, actionId: string): void => {
    if (bannerId === 'cache' && actionId === 'dismiss') {
      // Nothing to fix — an idle cache cannot be un-cooled — so dismissal is the only
      // control, and it has to remember WHAT it dismissed or the derivation re-raises the
      // notice on the very next render.
      const session = sessions.find((s) => s.id === sessionId);
      const override = state.ui.modelOverride[sessionId];
      const key = cacheKey({
        ...(override !== undefined ? { override } : {}),
        ...(session !== undefined
          ? {
              pinned: {
                ...(session.provider !== undefined ? { provider: session.provider } : {}),
                ...(session.model !== undefined ? { model: session.model } : {}),
              },
            }
          : {}),
      });
      state = {
        ...state,
        ui: { ...state.ui, dismissedCache: { ...state.ui.dismissedCache, [sessionId]: key } },
      };
      push();
      return;
    }
    if (bannerId === 'drift' && actionId === 'recompile') {
      // Drop the frozen prompt server-side, then refresh so the session's promptConfig
      // clears — the drift derivation then reads "no running prompt" ⇒ no banner.
      //
      // The suppression is dropped only AFTER the daemon confirms. Clearing it up front
      // made a failed recompile invisible in the worst way: the frozen prompt was still
      // there, so the derivation re-raised the same banner, and the button read as a
      // control that did nothing at all. Now a refusal says so and the banner is honestly
      // still describing a prompt that never recompiled.
      void surfaceWrite('recompile that prompt', bridge.recompilePrompt({ sessionId })).then(
        async (result) => {
          if (result === undefined) return;
          if (!result.recompiled) {
            reportNotice(
              'Nothing to recompile',
              'this conversation has no compiled prompt to drop.',
            );
            return;
          }
          const dismissedDrift = { ...state.ui.dismissedDrift };
          delete dismissedDrift[sessionId];
          state = { ...state, ui: { ...state.ui, dismissedDrift } };
          push();
          await refreshSessionList();
        },
      );
      return;
    }
    if (bannerId === 'drift' && actionId === 'dismiss') {
      // Suppress the drift banner for the config it currently reflects; a further config
      // change is a new key, so it re-shows. Keyed off the active agent's config.
      const session = sessions.find((s) => s.id === sessionId);
      const agent = session ? agents.find((a) => a.ref === session.agentRef) : undefined;
      const key = configKey({
        roles: agent?.roles,
        packageIds: agent?.packageIds,
        exclude: agent?.exclude,
      });
      state = {
        ...state,
        ui: { ...state.ui, dismissedDrift: { ...state.ui.dismissedDrift, [sessionId]: key } },
      };
      push();
    }
  };

  /** Reveal a file (a tool card's path/match click) in the editor/OS at an optional line.
   *  Delegates to main, which owns the session→worktree mapping + confinement. Advisory:
   *  resolves the structured result; never throws (a rejected IPC becomes a failed result
   *  the caller can toast). */
  const openPath = (
    path: string,
    line: number | undefined,
    sessionId: string | undefined,
  ): Promise<{ ok: boolean; revealed?: 'editor' | 'folder'; reason?: string }> =>
    bridge
      .openPath({
        path,
        ...(line !== undefined ? { line } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
      })
      .catch((e: unknown) => ({
        ok: false,
        reason: e instanceof Error ? e.message : String(e),
      }));

  /** Open a web URL (a tool card's WebSearch/WebFetch link) in the default browser.
   *  Delegates to main, which validates the scheme (http(s) only) + opens it. Advisory:
   *  resolves the structured result; never throws (a rejected IPC becomes a failed result
   *  the caller can toast). */
  const openExternal = (url: string): Promise<{ ok: boolean; reason?: string }> =>
    bridge.openExternal({ url }).catch((e: unknown) => ({
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    }));

  // Monotonic id for locally-rendered `you` turns (a send AND an optimistically-shown steer),
  // so their React keys never collide.
  let youSeq = 0;

  /** The Stop/Esc affordance — a user-initiated stop (never a governance block).
   *  On a real stop the running pill clears from the daemon's own `'interrupted'` status
   *  Push (the existing `onPush` handler above), not from this call's result.
   *
   *  `interrupted: false` is the case that used to disappear: the daemon has no running
   *  turn to stop, so no push is coming and Stop reads as a dead button. That answer is
   *  authoritative — nothing is running — so the pill clears here and the console says
   *  what happened rather than leaving the user pressing a control that does nothing. */
  const interruptSession = (sessionId: string): void => {
    void surfaceWrite('stop that turn', bridge.interruptSession({ id: sessionId })).then(
      (result) => {
        if (result === undefined || result.interrupted) return;
        clearRunStatus(sessionId);
        reportNotice('Nothing to stop', 'that turn had already finished.');
      },
    );
  };

  /** Steer: reach the running turn at its next step, discarding nothing (a user
   *  redirect, never a block). The daemon writes the transcript line when the model actually
   *  RECEIVES the text (a steer is recorded only when the model receives it), which is seconds later — so `ChatPanel` shows the
   *  message pinned at the bottom of the transcript meanwhile and drops the pin when the real
   *  frame arrives. Queue-mode follow-ups stay held console-side until the turn ends.
   *
   *  `steered: false` is the case that used to disappear: the daemon has no live turn to
   *  reach, so the text was DROPPED and no frame is ever coming for it. Left unsaid, the
   *  pin just gets swept a moment later and the user watches what they typed vanish with
   *  no account of where it went. Advisory, as ever — nothing is blocked and nothing is
   *  retried, the console simply says the message did not land. */
  const steerSession = (sessionId: string, text: string): void => {
    const body = text.trim();
    if (body === '') return;
    void surfaceWrite('send that steer', bridge.steerSession({ id: sessionId, text: body })).then(
      (result) => {
        if (result === undefined || result.steered) return;
        reportNotice('Nothing to steer', 'that turn is no longer running, so nothing received it.');
      },
    );
  };

  /** Set a session's in-chat model override; the next send routes there (and the
   *  daemon persists it as the new pin). Republishes so the picker + cache banner update.
   *
   *  MERGES the incoming partial into any existing override rather than replacing it: the
   *  two composer controls each emit a partial (`onPickModel` → `{model, provider}`,
   *  `onPickEffort` → `{reasoning}`). Replacing meant a later effort pick wiped the model
   *  out of the override, so the send fell back to the agent's default model — the reported
   *  "set a reasoning level and it silently drops to Claude" bug. Accumulating keeps the
   *  selection a coherent `{provider, model, reasoning}` unit. */
  const setSessionModel = (sessionId: string, selection: ModelSelection): void => {
    const prev = state.ui.modelOverride[sessionId];
    state = {
      ...state,
      ui: {
        ...state.ui,
        modelOverride: { ...state.ui.modelOverride, [sessionId]: { ...prev, ...selection } },
      },
    };
    push();
  };

  /** Whether a session's own backend is claude — a session's PIN wins (it already ran
   *  there); an unpinned session falls back to its agent's provider; no provider recorded
   *  anywhere ⇒ the default backend, which is claude. Used to scope the live auth-failure
   *  signal so a deepseek (or any non-claude) session's auth error never lights the
   *  claude login badge. */
  const sessionUsesClaude = (sessionId: string): boolean => {
    const session = sessions.find((s) => s.id === sessionId);
    const agent = session ? agents.find((a) => a.ref === session.agentRef) : undefined;
    const provider = session?.provider ?? agent?.provider;
    return provider === undefined || provider === 'claude';
  };

  // Forward every daemon push to its owning session (never the active one blindly); a
  // completed session refreshes the rail so its auto-title + recency update.
  // (Drift/cache banners are derived client-side, not pushed.)
  const unsubscribePush = bridge.onPush((payload) => {
    const parsed = pushSchema.safeParse(payload);
    if (!parsed.success) return;
    const data = parsed.data;
    if (data.kind === 'status') {
      // Land any buffered stream frames before a terminal status renders (so the last text
      // is present when the pill clears), and guarantee the flush even if rAF is throttled.
      flushTurns();
      const runStatus = { ...state.ui.runStatus };
      if (
        data.state === 'running' ||
        data.state === 'blocked-approval' ||
        data.state === 'blocked-tool'
      ) {
        // F2: `blocked-approval`/`blocked-tool` are a live annotation on top of a
        // turn that is still genuinely in flight underneath (LiveSession.state
        // itself never leaves 'running' for the duration of an ask — see
        // requestApproval/resolveApproval) — NOT a "not running" signal. Every
        // Stop/interrupt affordance (Composer's Stop button, the global Esc
        // handler, the palette's "Interrupt Running Turn") hangs off this same
        // map, so treating a pending ask as idle silently strands the user with
        // only approve/deny/redirect and no way to abort the turn outright.
        // `??=` preserves an already-recorded `since` rather than resetting the
        // elapsed-time pill's clock when the ask lands mid-turn.
        runStatus[data.sessionId] ??= { since: Date.now() };
      } else {
        delete runStatus[data.sessionId];
      }
      // A terminal status carries NO transcript content: the daemon settles the in-flight turn's
      // partial blocks and records the `interrupted` marker as real, persisted frames, which
      // arrive on this same push stream. Closing blocks or synthesizing a marker here would
      // diverge from what a reload folds out of the log — the live-vs-reload mismatch.
      state = { ...state, ui: { ...state.ui, runStatus } };
      // F2: a turn that just ended — however it ended — leaves no in-flight tool call
      // still waiting on an answer; a pending ask belongs to the turn that raised it,
      // and that turn is now over. The daemon fail-safe-denies its own copy on exactly
      // this transition (`SessionService.interrupt`/`LiveSession.close`), but that alone
      // never tells THIS console to drop the card it's still showing — without this, Stop
      // mid-ask left the composer gate-locked on a request nothing could ever answer.
      if (
        (data.state === 'done' || data.state === 'error' || data.state === 'interrupted') &&
        (state.ui.pendingApprovalsBySession[data.sessionId]?.length ?? 0) > 0
      ) {
        const pendingApprovalsBySession = { ...state.ui.pendingApprovalsBySession };
        delete pendingApprovalsBySession[data.sessionId];
        state = { ...state, ui: { ...state.ui, pendingApprovalsBySession } };
      }
      if (data.state === 'done') void refreshSessionList();
      push();
      return;
    }
    // The per-turn usage mirror (the adapters' own settlement numbers) — the context
    // ring reads the LAST settled turn's figures, so each push replaces rather than
    // accumulates (the settled tokensIn already includes the whole context handed over).
    if (data.kind === 'usage') {
      state = {
        ...state,
        ui: {
          ...state.ui,
          usageBySession: {
            ...state.ui.usageBySession,
            [data.sessionId]: {
              tokensIn: data.tokensIn,
              tokensOut: data.tokensOut,
              ...(data.cacheReadTokens !== undefined
                ? { cacheReadTokens: data.cacheReadTokens }
                : {}),
            },
          },
        },
      };
      push();
      return;
    }
    // F2: the mode-reflection push — the daemon is the ONE authority over a session's
    // permission mode; the console only ever mirrors it. `degraded` rides straight
    // through unchanged (the daemon's own honest wording — SC-1).
    if (data.kind === 'mode') {
      state = {
        ...state,
        ui: {
          ...state.ui,
          modeBySession: {
            ...state.ui.modeBySession,
            [data.sessionId]: {
              mode: data.mode,
              effectiveMode: data.effectiveMode,
              ...(data.degraded !== undefined ? { degraded: data.degraded } : {}),
            },
          },
        },
      };
      push();
      return;
    }
    // F2: a live ask — queued FIFO (oldest first: the longest-waiting request is what's
    // actually blocking the session), so a rare concurrent-call case never loses one to
    // the other overwriting it.
    if (data.kind === 'approval') {
      const prior = state.ui.pendingApprovalsBySession[data.sessionId] ?? [];
      const item: PendingApprovalItem = {
        requestId: data.requestId,
        tool: data.tool ?? '',
        summary: data.summary,
        ...(data.input !== undefined ? { input: data.input } : {}),
        ...(data.toolClass !== undefined ? { toolClass: data.toolClass } : {}),
      };
      state = {
        ...state,
        ui: {
          ...state.ui,
          pendingApprovalsBySession: {
            ...state.ui.pendingApprovalsBySession,
            [data.sessionId]: [...prior, item],
          },
        },
      };
      push();
      return;
    }
    if ('sessionId' in data) {
      const frames = pushToViewFrames(data);
      // The live-failure hook: an auth-shaped error frame flags the active claude login
      // (advisory — the badge lights; nothing blocks, nothing switches). Scoped to the
      // pushing session's own backend — a deepseek/other-provider auth error has nothing
      // to do with the claude login and must not light that badge. No provider recorded
      // (session unpinned, agent unset) means the default backend, which is claude.
      if (detectAuthFailure(frames) && sessionUsesClaude(data.sessionId)) authFailureSink();
      appendTurns(data.sessionId, frames);
    }
  });

  const sendMessage = (text: string, attachments?: readonly Attachment[]): void => {
    const body = text.trim();
    const id = state.ui.activeSessionId;
    if (body === '' || id === undefined) return;
    youSeq += 1;
    state = {
      ...state,
      ui: {
        ...state.ui,
        runStatus: { ...state.ui.runStatus, [id]: { since: Date.now() } },
        sendNonce: { ...state.ui.sendNonce, [id]: (state.ui.sendNonce[id] ?? 0) + 1 },
      },
    };
    const activeSession = sessions.find((s) => s.id === id);
    const agent = activeSession ? agents.find((a) => a.ref === activeSession.agentRef) : undefined;
    // Resolve the selection as a COHERENT UNIT: the override is a partial patch over
    // the resolved selection (session pin or agent config) — not a whole replacement.
    // onPickEffort sends only {reasoning}, so treating the override as the full
    // model selection silently drops the provider + model and falls back to Claude
    // (the session.ts default). Resolving field-by-field was the haiku→deepseek crash
    // (a pinned model + a since-switched agent provider); merging the override on top
    // of the resolved selection avoids the same category of error.
    const resolved = resolveSelection(activeSession, agent);
    const override = state.ui.modelOverride[id];
    const model: ModelSelection = override ? { ...resolved, ...override } : resolved;
    // A model/effort override applied on this send drops a console-local "switched
    // model" note into the transcript — BEFORE the user turn, so it reads as the
    // context the send ran under. Never sent to the agent (a synthetic UI frame, not a
    // wire TurnFrame) and omitted in `coa raw` (raw is the verbatim loop only).
    if (override !== undefined) {
      const models = state.data.models.status === 'ok' ? state.data.models.value : [];
      const afterCount = turnsBySession.get(id)?.length ?? 0;
      const noteText = modelSwitchNoteText(override, models);
      state = {
        ...state,
        ui: {
          ...state.ui,
          notesBySession: {
            ...state.ui.notesBySession,
            [id]: [...(state.ui.notesBySession[id] ?? []), { afterCount, text: noteText }],
          },
        },
      };
    }
    // Attachments leave a console-local note beside the send (same mechanism as the
    // "switched model" note): the persisted transcript carries only the text, so
    // without this the live view would show no trace an attachment ever went along.
    if (attachments !== undefined && attachments.length > 0) {
      const names = attachments.map((a) => a.name ?? (a.kind === 'image' ? 'image' : 'text file'));
      const afterCount = turnsBySession.get(id)?.length ?? 0;
      state = {
        ...state,
        ui: {
          ...state.ui,
          notesBySession: {
            ...state.ui.notesBySession,
            [id]: [
              ...(state.ui.notesBySession[id] ?? []),
              { afterCount, text: `attached ${names.join(', ')}` },
            ],
          },
        },
      };
    }
    appendTurns(id, [{ id: `you:${youSeq}`, role: 'you', kind: 'text', text: body }]);
    // The pending pick is being applied now: clear the override and optimistically pin
    // it locally, so the predictive cache banner clears on send (the daemon persists the
    // same pin, which a later refresh confirms).
    if (override !== undefined) {
      sessions = sessions.map((s) =>
        s.id === id
          ? {
              ...s,
              updatedAt: new Date().toISOString(),
              ...(override.provider !== undefined ? { provider: override.provider } : {}),
              ...(override.model !== undefined ? { model: override.model } : {}),
              ...(override.reasoning !== undefined ? { reasoning: override.reasoning } : {}),
            }
          : s,
      );
      const modelOverride = { ...state.ui.modelOverride };
      delete modelOverride[id];
      state = {
        ...state,
        data: { ...state.data, sessions: { status: 'ok', value: [...sessions] } },
        ui: { ...state.ui, modelOverride },
      };
      push();
    }
    void bridge
      .startSession({
        input: body,
        conversationId: id,
        // The registry roles the agent is assembled as; absent/empty ⇒ the permissive floor.
        ...(agent?.roles && agent.roles.length > 0 ? { roles: agent.roles } : {}),
        // Assembly selection (only applied when a role is set — see the resolver's floor).
        ...(agent?.packageIds && agent.packageIds.length > 0
          ? { packageIds: agent.packageIds }
          : {}),
        ...(agent?.exclude && agent.exclude.length > 0 ? { exclude: agent.exclude } : {}),
        ...(Object.keys(model).length > 0 ? { model } : {}),
        ...(attachments !== undefined && attachments.length > 0
          ? { attachments: [...attachments] }
          : {}),
      })
      // The first send auto-titles the session server-side; reflect it in the rail.
      .then(() => refreshSessionList())
      .catch((e: unknown) => {
        // A failed dispatch never streams a turn back — clear the pill here so it
        // doesn't run forever.
        const runStatus = { ...state.ui.runStatus };
        delete runStatus[id];
        state = { ...state, ui: { ...state.ui, runStatus } };
        push();
        appendTurns(id, [
          {
            id: `err:${youSeq}`,
            role: 'agent',
            kind: 'text',
            text: `⚠ ${e instanceof Error ? e.message : String(e)}`,
          },
        ]);
      });
  };

  /** On launch, hydrate the in-memory agent list (and its load diagnostics) from
   *  the daemon's registry via the `listAgents` IPC verb; a failed/malformed read
   *  degrades both to their empty floor — the "No agents yet" empty state, never a
   *  mock, and no phantom diagnostics. */
  async function initAgents(): Promise<void> {
    const loaded = await settle(async () => parseAgentsResult(await bridge.listAgents()));
    if (loaded.status === 'ok') {
      agents = loaded.value.agents;
      state = { ...state, data: { ...state.data, agentDiagnostics: loaded.value.diagnostics } };
    }
    pushAgents();
  }

  /** On launch, load the project's sessions and open the most recent one. */
  async function initSessions(): Promise<void> {
    await refreshSessionList();
    const newest = sessions[0];
    if (newest) await openSession(newest.id);
    else clearActiveSession();
  }

  state = {
    ...state,
    actions: {
      setRoute,
      refresh: () => void refresh(),
      switchAccount,
      setSettings,
      toggleRaw,
      respondApproval,
      setPermissionMode,
      selectAgent,
      createAgent,
      updateAgent,
      deleteAgent,
      togglePinAgent,
      selectSession,
      newSession,
      deleteSession,
      sendMessage,
      onBannerAction,
      setSessionModel,
      openPath,
      openExternal,
      interruptSession,
      steerSession,
    },
  };
  push();
  // Fire-and-forget as a group, but TRACKED: on an ordinary launch (daemon already up)
  // the daemon-status handler fires `cameUp` at startup too, so an untracked `hydrate()`
  // could run its guard before the boot-time `initSessions()` settles and kick off a
  // second, concurrent one (double listSessions/reloadConversation/subscribe on every
  // normal launch). `allSettled` (not `all`) because a failed read must not short-circuit
  // the others — each settles into its own error Remote for hydrate to recover.
  // The modelsStore's writes reproject the daemon's edited catalog into its own state, but
  // the chip/agent-picker feed lives on `state.data.models` — poke `loadModels` too, in the
  // same breath, so both surfaces agree the moment an edit lands.
  onModelsChanged(loadModels);

  const bootLoads = Promise.allSettled([
    loadAccounts(),
    loadModels(),
    loadModelMetadata(),
    loadCatalogue(),
    initAgents(),
    initSessions(),
  ]).then(() => undefined);

  /** Recover the one-shot boot loads (cold-boot rehydrate gap): a `cameUp` daemon-status
   *  transition fires on BOTH a cold boot (autostart racing the console mount — the initial
   *  loads fired before the daemon existed and settled into error Remotes, never retried)
   *  and a daemon RESTART mid-use. `loadAccounts`/`loadModels`/`loadCatalogue` are idempotent
   *  reads, safe to re-run unconditionally either way. `initSessions` is NOT idempotent — it
   *  jumps the view to the newest session — so it's guarded: only re-run it when the sessions
   *  read isn't `ok` or nothing is active yet (the cold-boot case); a mid-use restart with a
   *  healthy, already-active session must not yank the user to a different conversation.
   *
   *  Awaits `bootLoads` first: an ordinary launch (daemon already up) fires `cameUp` at
   *  startup too, and reading the guard mid-boot would see not-yet-ok sessions and start a
   *  second, concurrent `initSessions()`. Settled boot loads make the guard's read honest:
   *  normal launch ⇒ ok+active ⇒ no re-run; cold boot ⇒ settled failures ⇒ recover.
   */
  /**
   * Forget every session this renderer believes is running. Called when a daemon
   * connection comes up: a turn is owned by the daemon process that is driving it, so a
   * connection that has only just been established cannot be running a turn this renderer
   * started. Whatever is genuinely live re-announces itself through the reattach in
   * `openSession` and the daemon's own pushes.
   *
   * This is the blanket half of the reconcile — `openSession` only ever speaks for the
   * session it opens, and the map can hold background sessions the user never returns to.
   * Only run state is cleared: the active conversation, its transcript and the rail are
   * untouched, so a mid-use restart never moves the user somewhere else.
   */
  function clearRunState(): void {
    if (Object.keys(state.ui.runStatus).length === 0) return;
    state = { ...state, ui: { ...state.ui, runStatus: {} } };
    push();
  }

  async function hydrate(): Promise<void> {
    await bootLoads;
    await Promise.all([
      loadAccounts(),
      loadModels(),
      loadModelMetadata(),
      loadCatalogue(),
      initAgents(),
    ]);
    if (state.data.sessions.status !== 'ok' || state.ui.activeSessionId === undefined) {
      await initSessions();
    }
  }

  return {
    refresh,
    hydrate,
    clearRunState,
    toggleRaw,
    dispose: () => {
      unsubscribePush();
    },
  };
}
