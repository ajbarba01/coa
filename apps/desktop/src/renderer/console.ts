import { createStaticEngine, parseDescriptor } from '@coa/console-layout';
import {
  pushSchema,
  pushToViewFrames,
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
import { MOCK_AGENTS } from './panels/mockAgents.js';
import { buildPanelRegistry, DEFAULT_DESCRIPTOR } from './panels/registry.js';
import { LAYOUT_EPOCH, getMainPanelId, setMainPanelId } from './panels/routing.js';
import { initialState, type ConsoleState, type Remote } from './panels/state.js';
import { applySettings } from './theme.js';

/** The subset of `window.coa` the controller needs (injected for testing). */
export interface ConsoleBridge {
  capState(): Promise<CapState>;
  flagsForUser(): Promise<FeedView>;
  listTimeline(): Promise<Checkpoint[]>;
  listAccounts(): Promise<{ accounts: { label: string }[] }>;
  currentAccount(): Promise<{ active: string }>;
  useAccount(params: { label: string }): Promise<{ active: string }>;
  startSession(params: {
    input: string;
    conversationId?: string;
    role?: string;
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
    const accounts = await settle(async () => {
      const [list, current] = await Promise.all([bridge.listAccounts(), bridge.currentAccount()]);
      return { accounts: list.accounts, active: current.active };
    });
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

  const switchAccount = (label: string): void =>
    void (async () => {
      await bridge.useAccount({ label });
      await loadAccounts();
      // Models + their reasoning levels are account-specific — refetch for the new login.
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
    const turns: Remote<TurnFrame[]> =
      loaded.status === 'ok' ? { status: 'ok', value: reloadToViewFrames(loaded.value) } : loaded;
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

  // ---- Live session: append streamed frames to the active transcript ----

  /** Append view frames to the active session's transcript and republish. */
  const appendTurns = (frames: TurnFrame[]): void => {
    if (frames.length === 0) return;
    const prev = state.data.turns.status === 'ok' ? state.data.turns.value : [];
    state = {
      ...state,
      data: { ...state.data, turns: { status: 'ok', value: [...prev, ...frames] } },
    };
    push();
  };

  // Forward every daemon push into the active conversation; a completed session
  // refreshes the rail so its auto-title + recency update.
  const unsubscribePush = bridge.onPush((payload) => {
    const parsed = pushSchema.safeParse(payload);
    if (!parsed.success) return;
    appendTurns(pushToViewFrames(parsed.data));
    if (parsed.data.kind === 'status' && parsed.data.state === 'done') void refreshSessionList();
  });

  let youSeq = 0;
  const sendMessage = (text: string): void => {
    const body = text.trim();
    const id = state.ui.activeSessionId;
    if (body === '' || id === undefined) return;
    youSeq += 1;
    appendTurns([{ id: `you:${youSeq}`, role: 'you', kind: 'text', text: body }]);
    const activeSession = sessions.find((s) => s.id === id);
    const agent = activeSession ? agents.find((a) => a.ref === activeSession.agentRef) : undefined;
    const model: ModelSelection = {
      ...(agent?.model ? { model: agent.model } : {}),
      ...(agent?.reasoning ? { reasoning: agent.reasoning } : {}),
    };
    void bridge
      .startSession({
        input: body,
        conversationId: id,
        // The registry role the agent is assembled as; absent ⇒ the permissive floor.
        ...(agent?.role ? { role: agent.role } : {}),
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
        appendTurns([
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
