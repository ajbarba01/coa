import {
  parseAgents,
  pushSchema,
  pushToViewFrames,
  reasoningValue,
  reconcileStreaming,
  reloadToViewFrames,
  type AgentSummary,
  type AuthView,
  type CapState,
  type Checkpoint,
  type FeedView,
  type LoginSnapshot,
  type ModelCatalogView,
  type ModelDescriptor,
  type ModelSelection,
  type PackageSummary,
  type PersistedTurnWire,
  type ReasoningProfile,
  type RoleSummary,
  type SessionSummary,
  type TurnFrame,
} from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../shared/settings.js';
import { modelLabel } from './panels/AgentsPanel.js';
import { resolveSelection } from './panels/selection.js';
import { nextAgentIdentity } from './panels/agentIdentity.js';
import { configKey } from './panels/banners.js';
import { initialState, type ConsoleState, type Remote } from './panels/state.js';
import { applySettings } from './theme.js';

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
  // The agent-assembly catalogue for the role/package picker.
  listRoles(): Promise<RoleSummary[]>;
  listPackages(): Promise<PackageSummary[]>;
  // Agents — console-local identity + launch selection, persisted to the
  // per-user `agents.json`. Degrades to empty list when missing/corrupt.
  listAgents(): Promise<unknown>;
  writeAgents(agents: unknown): Promise<void>;
  // Persistent sessions (R-7): the rail list + per-session transcript reload.
  listSessions(): Promise<SessionSummary[]>;
  newSession(params: { agentRef: string }): Promise<{ id: string }>;
  reloadConversation(params: { id: string }): Promise<PersistedTurnWire[]>;
  deleteSession(params: { id: string }): Promise<{ ok: boolean }>;
  /** Drop a session's frozen prompt + resume token so the next send recompiles (the drift banner's recompile). */
  recompilePrompt(params: { sessionId: string }): Promise<{ recompiled: boolean }>;
  /** The Stop/Esc affordance — proxies the daemon's cooperative `interruptSession`.
   *  Advisory (SC-1 — a user stop, never a governance block): the pill clears via the
   *  daemon's own `'interrupted'` status Push, not this call's result. */
  interruptSession(params: { id: string }): Promise<{ interrupted: boolean }>;
  /** Send a message to a running turn — proxies the daemon's `steerSession`. `barge-in` redirects
   *  the in-flight turn; `queue` runs it as a follow-up (SC-1 — a user redirect, never a block). */
  steerSession(params: {
    id: string;
    text: string;
    mode: 'queue' | 'barge-in';
  }): Promise<{ steered: boolean }>;
  /** Console reattach (G4) — proxies the daemon's `subscribeSession`. Called when a
   *  conversation becomes active; the daemon immediately hydrates this connection with
   *  the session's CURRENT run-status, so a reload mid-run reads `running` from the
   *  daemon snapshot rather than from this renderer's own send-tracking (docs/adr/0011). */
  subscribeSession(params: { id: string }): Promise<{ subscribed: boolean }>;
  /** Reveal a touched file in the editor/OS at an optional line (confined to the session's
   *  worktree by main). Advisory — resolves a result; never blocks (SC-1). */
  openPath(params: { path: string; line?: number; sessionId?: string }): Promise<{
    ok: boolean;
    revealed?: 'editor' | 'folder';
    reason?: string;
  }>;
  /** Open a web URL in the default browser (validated to http(s) by main). Advisory —
   *  resolves a result; never blocks (SC-1). */
  openExternal(params: { url: string }): Promise<{ ok: boolean; reason?: string }>;
  /** Subscribe to the daemon push stream; returns an unsubscribe. */
  onPush(listener: (payload: unknown) => void): () => void;
  getSettings(): Promise<ConsoleSettings>;
  saveSettings(settings: ConsoleSettings): Promise<void>;
}

/**
 * The auth surface's RPC callers. Unlike the rest of this module, these don't flow through
 * `startConsole`'s injected `ConsoleBridge` — the auth store (`panels/mockAuth.ts`) is a
 * standalone zustand store (shared by the auth surface, the usage surface, and the nav HUD),
 * not part of the single `ConsoleState` pipeline, so it reaches the preload bridge directly.
 * Exported (rather than inlined in the store) so a test can `vi.mock` this module and hand
 * the store a fake — the store itself never talks to `window.coa`.
 */
export const rpcAuthView = (): Promise<AuthView> => window.coa.authView();
export const rpcAddProvider = (providerId: string): Promise<AuthView> =>
  window.coa.addProvider({ providerId });
export const rpcRemoveProvider = (providerId: string, removeProfiles?: boolean): Promise<AuthView> =>
  window.coa.removeProvider({ providerId, ...(removeProfiles !== undefined ? { removeProfiles } : {}) });
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
export const rpcSetProviderEnabled = (providerId: string, on: boolean): Promise<AuthView> =>
  window.coa.setProviderEnabled({ providerId, on });
export const rpcSetCredentialDisabled = (id: string, disabled: boolean): Promise<AuthView> =>
  window.coa.setCredentialDisabled({ id, disabled });
export const rpcMakeActive = (id: string): Promise<AuthView> => window.coa.makeActive({ id });
export const rpcClearCooldown = (id: string): Promise<AuthView> =>
  window.coa.clearCooldown({ id });
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

/** What an auth-shaped failure LOOKS like in an error frame. Advisory on purpose (SC-1):
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
  // Agents are persisted. On bootstrap the in-memory copy is hydrated
  // from the per-user `agents.json` via listAgents; an empty/missing file degrades
  // to the "No agents yet" empty state — never to a mock. Sessions + their turns are
  // REAL: loaded from the daemon's R-7 store below (`initSessions`). The mutable
  // copy backs the now-durable agent edits (rename, recolor, pin) that persist
  // via writeAgents.
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
      await bridge.useAccount({ label, ...(provider !== undefined ? { provider } : {}) });
      await loadAccounts();
      // The merged model list is per-account (that provider's models change) — refetch.
      await loadModels();
    })();

  const setSettings = (patch: Partial<ConsoleSettings>): void => {
    const next = { ...state.ui.settings, ...patch };
    applySettings(next);
    state = { ...state, ui: { ...state.ui, settings: next } };
    push();
    // Persisting also recolors the native window chrome (main's saveSettings handler).
    // Defer it until the renderer has painted the new theme (two frames), so the
    // OS-drawn caption controls follow the window instead of flipping ahead of it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void bridge.saveSettings(next);
      }),
    );
  };

  const toggleRaw = (): void => {
    state = { ...state, ui: { ...state.ui, rawMode: !state.ui.rawMode } };
    push();
  };

  const respondApproval = (requestId: string, decision: 'approve' | 'deny'): void => {
    const resolved = decision === 'approve' ? 'approved' : 'denied';
    state = {
      ...state,
      ui: {
        ...state.ui,
        resolvedApprovals: { ...state.ui.resolvedApprovals, [requestId]: resolved },
      },
    };
    push();
  };

  // ---- Agents — console-local identity + launch selection, persisted
  // to the per-user `agents.json` via listAgents on startup / writeAgents after every
  // mutation. Empty/missing file degrades to the "No agents yet" empty state. ----

  /** Publish the in-memory agent list + persist it (optimistic UI + durable write). */
  const pushAgents = (persist = true): void => {
    state = { ...state, data: { ...state.data, agents: { status: 'ok', value: [...agents] } } };
    push();
    if (persist) void bridge.writeAgents(agents);
  };

  const selectAgent = (ref: string): void => {
    state = { ...state, ui: { ...state.ui, selectedAgentRef: ref } };
    push();
  };

  const createAgent = (scope: 'project' | 'personal'): void => {
    const { ref, name } = nextAgentIdentity(agents, scope);
    agents = [...agents, { ref, name, icon: 'bot', color: 'slate', scope }];
    state = { ...state, ui: { ...state.ui, selectedAgentRef: ref } };
    pushAgents();
  };

  const updateAgent = (ref: string, patch: Partial<Omit<AgentSummary, 'ref'>>): void => {
    agents = agents.map((a) => (a.ref === ref ? { ...a, ...patch } : a));
    pushAgents();
  };

  const deleteAgent = (ref: string): void => {
    agents = agents.filter((a) => a.ref !== ref);
    const ui = { ...state.ui };
    if (ui.selectedAgentRef === ref) delete ui.selectedAgentRef;
    state = { ...state, ui };
    pushAgents();
  };

  const togglePinAgent = (ref: string): void => {
    const pinned = state.ui.settings.pinnedAgents;
    setSettings({
      pinnedAgents: pinned.includes(ref) ? pinned.filter((p) => p !== ref) : [...pinned, ref],
    });
  };

  // ---- Persistent sessions (R-7): list + per-session transcript, all daemon-backed ----

  /** Refresh the rail's session list (title/recency) without touching the transcript. */
  async function refreshSessionList(): Promise<void> {
    const loaded = await settle(() => bridge.listSessions());
    if (loaded.status === 'ok') sessions = loaded.value;
    state = { ...state, data: { ...state.data, sessions: loaded } };
    push();
  }

  /** Open a session cache-first: the active id flips SYNCHRONOUSLY — a warm
   *  `turnsBySession` entry renders this same frame; a cold one shows the loading
   *  state — and the persisted-transcript reload reconciles in the background,
   *  ignored if the user has already moved on (stale response). Also
   *  (re)subscribes to the daemon's live session (G4 reattach) so a fresh mount —
   *  e.g. a reload mid-run — hydrates `runStatus` from the daemon's own snapshot
   *  instead of reconstructing it from this renderer's send-tracking (docs/adr/0011).
   *  Fire-and-forget like `interruptSession`: the pill is driven by the resulting
   *  status Push (the existing `onPush` handler below), not by this call's result. */
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
    void bridge.subscribeSession({ id }).catch(() => {});

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
      const created = await settle(() => bridge.newSession({ agentRef }));
      if (created.status !== 'ok') return;
      await refreshSessionList();
      await openSession(created.value.id);
    })();

  const deleteSession = (id: string): void =>
    void (async () => {
      await bridge.deleteSession({ id });
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
      // frame replaces it — no double-render (docs/adr/0013).
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

  // The drift/cache banners are DERIVED live in the chat vm (predictive: computed from
  // the pending pick + the running prompt's config the daemon reports), so the console
  // only holds the two bits of banner STATE the derivation reads: the model override
  // and the per-session drift dismissal. A banner action mutates that state.
  const onBannerAction = (sessionId: string, bannerId: string, actionId: string): void => {
    if (bannerId === 'drift' && actionId === 'recompile') {
      // Drop the frozen prompt server-side, then refresh so the session's promptConfig
      // clears — the drift derivation then reads "no running prompt" ⇒ no banner.
      void bridge.recompilePrompt({ sessionId }).then(() => refreshSessionList());
      const dismissedDrift = { ...state.ui.dismissedDrift };
      delete dismissedDrift[sessionId];
      state = { ...state, ui: { ...state.ui, dismissedDrift } };
      push();
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

  /** The Stop/Esc affordance — a user-initiated stop (SC-1: never a governance block).
   *  Fire-and-forget: the running pill clears from the daemon's own `'interrupted'`
   *  status Push (the existing `onPush` handler above), not from this call's result. */
  const interruptSession = (sessionId: string): void => {
    void bridge.interruptSession({ id: sessionId }).catch(() => {});
  };

  /** Barge-in: redirect the running turn with a message (SC-1: a user redirect, never a block).
   *  Does NOT render optimistically — the daemon is the single source of truth and pushes the
   *  FRAMED steer (the exact text the model saw) as a live user turn, which a later reload folds
   *  from the same append-only frame (docs/adr/0010, docs/adr/0012). Rendering it here too would
   *  double it (raw typed text live, framed text on reload). Queue-mode follow-ups are held
   *  console-side by `ChatPanel` until the turn ends, so only `barge-in` reaches the daemon here. */
  const steerSession = (sessionId: string, text: string): void => {
    const body = text.trim();
    if (body === '') return;
    void bridge.steerSession({ id: sessionId, text: body, mode: 'barge-in' }).catch(() => {});
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
      if (data.state === 'running') runStatus[data.sessionId] ??= { since: Date.now() };
      else delete runStatus[data.sessionId];
      // A terminal status carries NO transcript content: the daemon settles the in-flight turn's
      // partial blocks and records the `interrupted` marker as real, persisted frames, which
      // arrive on this same push stream. Closing blocks or synthesizing a marker here would
      // diverge from what a reload folds out of the log — the live-vs-reload mismatch.
      state = { ...state, ui: { ...state.ui, runStatus } };
      if (data.state === 'done') void refreshSessionList();
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

  const sendMessage = (text: string): void => {
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
    // wire TurnFrame) and omitted in `coa raw` (D85: raw is the verbatim loop only).
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

  /** On launch, hydrate the in-memory agent list from the persisted `agents.json`
   *  via the `listAgents` IPC verb; an empty/missing/corrupt file degrades to the
   *  "No agents yet" empty state (never to a mock). */
  async function initAgents(): Promise<void> {
    const loaded = await settle(async () => parseAgents(await bridge.listAgents()));
    if (loaded.status === 'ok') agents = loaded.value;
    pushAgents(false);
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
  async function hydrate(): Promise<void> {
    await bootLoads;
    await Promise.all([loadAccounts(), loadModels(), loadCatalogue()]);
    if (state.data.sessions.status !== 'ok' || state.ui.activeSessionId === undefined) {
      await initSessions();
    }
  }

  return {
    refresh,
    hydrate,
    toggleRaw,
    dispose: () => {
      unsubscribePush();
    },
  };
}
