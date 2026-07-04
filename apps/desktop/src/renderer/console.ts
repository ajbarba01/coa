import { createStaticEngine, parseDescriptor } from '@coa/console-layout';
import {
  pushSchema,
  pushToViewFrames,
  reasoningValue,
  reloadToViewFrames,
  type AgentSummary,
  type CapState,
  type Checkpoint,
  type FeedView,
  type ModelDescriptor,
  type ModelSelection,
  type PackageSummary,
  type PersistedTurnWire,
  type RoleSummary,
  type SessionSummary,
  type TurnFrame,
} from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../shared/settings.js';
import { modelLabel } from './panels/AgentsPanel.js';
import { MOCK_AGENTS } from './panels/mockAgents.js';
import { buildPanelRegistry, DEFAULT_DESCRIPTOR } from './panels/registry.js';
import { resolveSelection } from './panels/selection.js';
import { configKey } from './panels/banners.js';
import { LAYOUT_EPOCH, getMainPanelId, setMainPanelId } from './panels/routing.js';
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
  return effort !== undefined && effort !== 'off' ? `switched to ${label} · ${effort}` : `switched to ${label}`;
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
  // Persistent sessions (R-7): the rail list + per-session transcript reload.
  listSessions(): Promise<SessionSummary[]>;
  newSession(params: { agentRef: string }): Promise<{ id: string }>;
  reloadConversation(params: { id: string }): Promise<PersistedTurnWire[]>;
  deleteSession(params: { id: string }): Promise<{ ok: boolean }>;
  /** Drop a session's frozen prompt + resume token so the next send recompiles (the drift banner's recompile). */
  recompilePrompt(params: { sessionId: string }): Promise<{ recompiled: boolean }>;
  /** Subscribe to the daemon push stream; returns an unsubscribe. */
  onPush(listener: (payload: unknown) => void): () => void;
  getLayout(): Promise<unknown>;
  saveLayout(descriptor: unknown): Promise<void>;
  getSettings(): Promise<ConsoleSettings>;
  saveSettings(settings: ConsoleSettings): Promise<void>;
}

export interface ConsoleController {
  refresh(): Promise<void>;
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

/** Persisted layout is wrapped with the arrangement epoch so a stale arrangement
 *  (e.g. a pre-inspector layout) is ignored rather than pinning the old shape. */
function readPersistedDescriptor(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    (raw as { epoch?: unknown }).epoch === LAYOUT_EPOCH
  ) {
    return (raw as { descriptor?: unknown }).descriptor;
  }
  return undefined;
}

export async function startConsole(
  container: HTMLElement,
  bridge: ConsoleBridge,
): Promise<ConsoleController> {
  const registry = buildPanelRegistry();
  const descriptor = parseDescriptor(
    readPersistedDescriptor(await bridge.getLayout()),
    registry,
    DEFAULT_DESCRIPTOR,
  );
  const settings = await bridge.getSettings();
  applySettings(settings);

  const engine = createStaticEngine();
  const persist = (d: unknown): void =>
    void bridge.saveLayout({ epoch: LAYOUT_EPOCH, descriptor: d });

  // Mount with placeholder actions; the real actions (which capture `handle`) are
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
  });
  // Seed the nav selection from the restored layout so the highlighted tab matches
  // the panel actually shown (a persisted layout may open on a non-default surface).
  state = {
    ...state,
    ui: { ...state.ui, settings, activeMainPanelId: getMainPanelId(descriptor) },
  };
  // Agents remain shell-owned mocks (their Role verbs are unbuilt); seed them ready
  // so the rail renders on first paint. Sessions + their turns are REAL: loaded from
  // the daemon's R-7 store below (`initSessions`). The mutable copy backs the
  // mock-inert agent writes (rename, recolor, pin).
  let agents: AgentSummary[] = [...MOCK_AGENTS];
  let sessions: SessionSummary[] = [];
  state = {
    ...state,
    data: { ...state.data, agents: { status: 'ok', value: [...agents] } },
  };
  const handle = engine.mount({
    container,
    descriptor,
    registry,
    daemonState: state,
    onChange: (d) => persist(d),
  });

  const push = (): void => handle.setDaemonState(state);

  const setRoute = (panelId: string): void => {
    const next = setMainPanelId(handle.serialize(), panelId);
    // A route only swaps one leaf's panelId — the tree shape is identical, so skip the
    // group remount (which would tear down and rebuild the whole window → flicker).
    handle.applyDescriptor(next, false); // sizes live in the descriptor, so they survive
    persist(next);
    state = { ...state, ui: { ...state.ui, activeMainPanelId: panelId } };
    push();
  };

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

  // ---- Agents (mock-inert writes over the in-memory mock state; the real writes
  // ride the future writeRole funnel) ----

  const pushAgents = (): void => {
    state = { ...state, data: { ...state.data, agents: { status: 'ok', value: [...agents] } } };
    push();
  };

  const selectAgent = (ref: string): void => {
    state = { ...state, ui: { ...state.ui, selectedAgentRef: ref } };
    push();
  };

  const createAgent = (scope: 'project' | 'personal'): void => {
    const taken = new Set(agents.map((a) => a.name));
    let name = 'untitled-agent';
    for (let n = 2; taken.has(name); n += 1) name = `untitled-agent-${n}`;
    const ref = `${scope === 'project' ? 'roles' : 'personal'}/${name}`;
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

  /** Open a session: reload its persisted transcript and make it active. */
  async function openSession(id: string): Promise<void> {
    const loaded = await settle(() => bridge.reloadConversation({ id }));
    if (loaded.status === 'ok') turnsBySession.set(id, reloadToViewFrames(loaded.value));
    const turns: Remote<TurnFrame[]> =
      loaded.status === 'ok' ? { status: 'ok', value: turnsBySession.get(id) ?? [] } : loaded;
    state = { ...state, data: { ...state.data, turns }, ui: { ...state.ui, activeSessionId: id } };
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

  /** Append frames to a session's buffer; publish to the visible transcript only when
   *  that session is the active one. */
  const appendTurns = (sessionId: string, frames: TurnFrame[]): void => {
    if (frames.length === 0) return;
    const prev = turnsBySession.get(sessionId) ?? [];
    const next = [...prev, ...frames];
    turnsBySession.set(sessionId, next);
    if (sessionId === state.ui.activeSessionId) {
      state = { ...state, data: { ...state.data, turns: { status: 'ok', value: next } } };
      push();
    }
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

  /** Set a session's in-chat model override; the next send routes there (and the
   *  daemon persists it as the new pin). Republishes so the picker + cache banner update. */
  const setSessionModel = (sessionId: string, selection: ModelSelection): void => {
    state = {
      ...state,
      ui: {
        ...state.ui,
        modelOverride: { ...state.ui.modelOverride, [sessionId]: selection },
      },
    };
    push();
  };

  // Forward every daemon push to its owning session (never the active one blindly); a
  // completed session refreshes the rail so its auto-title + recency update.
  // (Drift/cache banners are derived client-side, not pushed.)
  const unsubscribePush = bridge.onPush((payload) => {
    const parsed = pushSchema.safeParse(payload);
    if (!parsed.success) return;
    const data = parsed.data;
    if (data.kind === 'status') {
      const runStatus = { ...state.ui.runStatus };
      if (data.state === 'running') runStatus[data.sessionId] ??= { since: Date.now() };
      else delete runStatus[data.sessionId];
      state = { ...state, ui: { ...state.ui, runStatus } };
      if (data.state === 'done') void refreshSessionList();
      push();
      return;
    }
    if ('sessionId' in data) appendTurns(data.sessionId, pushToViewFrames(data));
  });

  let youSeq = 0;
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
    },
  };
  push();
  void loadAccounts();
  void loadModels();
  void loadCatalogue();
  void initSessions();

  return {
    refresh,
    toggleRaw,
    dispose: () => {
      unsubscribePush();
      handle.dispose();
    },
  };
}
