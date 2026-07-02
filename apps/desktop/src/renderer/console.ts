import { createStaticEngine, parseDescriptor } from '@coa/console-layout';
import type {
  AgentSummary,
  CapState,
  Checkpoint,
  FeedView,
  SessionSummary,
} from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../shared/settings.js';
import {
  DEFAULT_SESSION_ID,
  MOCK_AGENTS,
  MOCK_SESSIONS,
  MOCK_SESSION_TURNS,
} from './panels/mockAgents.js';
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
  });
  // Seed the nav selection from the restored layout so the highlighted tab matches
  // the panel actually shown (a persisted layout may open on a non-default surface).
  state = {
    ...state,
    ui: { ...state.ui, settings, activeMainPanelId: getMainPanelId(descriptor) },
  };
  // The agent list, sessions, and turn streams are shell-owned mocks (their daemon
  // verbs are unbuilt); seed them ready so the chat + agents surfaces render on first
  // paint. Swapping each for its verb is a data-source change. The mutable copies
  // back the mock-inert writes (rename, recolor, pin) so the UX is fully exercisable.
  let agents: AgentSummary[] = [...MOCK_AGENTS];
  let sessions: SessionSummary[] = [...MOCK_SESSIONS];
  const sessionTurns = new Map(Object.entries(MOCK_SESSION_TURNS));
  const seedConversation = (sessionId: string): void => {
    state = {
      ...state,
      data: {
        ...state.data,
        agents: { status: 'ok', value: [...agents] },
        sessions: { status: 'ok', value: [...sessions] },
        turns: { status: 'ok', value: sessionTurns.get(sessionId) ?? [] },
      },
      ui: { ...state.ui, activeSessionId: sessionId },
    };
  };
  seedConversation(DEFAULT_SESSION_ID);
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

  const switchAccount = (label: string): void =>
    void (async () => {
      await bridge.useAccount({ label });
      await loadAccounts();
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

  // ---- Agents + sessions (mock-inert writes over the in-memory mock state; the
  // real writes ride the future writeRole funnel / conversation store) ----

  const pushAgentData = (): void => {
    state = {
      ...state,
      data: {
        ...state.data,
        agents: { status: 'ok', value: [...agents] },
        sessions: { status: 'ok', value: [...sessions] },
      },
    };
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
    pushAgentData();
  };

  const updateAgent = (ref: string, patch: Partial<Omit<AgentSummary, 'ref'>>): void => {
    agents = agents.map((a) => (a.ref === ref ? { ...a, ...patch } : a));
    pushAgentData();
  };

  const deleteAgent = (ref: string): void => {
    agents = agents.filter((a) => a.ref !== ref);
    sessions = sessions.filter((s) => s.agentRef !== ref);
    const ui = { ...state.ui };
    if (ui.selectedAgentRef === ref) delete ui.selectedAgentRef;
    // The deleted agent's sessions go with it; fall back to the newest remaining one.
    if (!sessions.some((s) => s.id === ui.activeSessionId)) {
      const fallback = [...sessions].sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      )[0];
      if (fallback) ui.activeSessionId = fallback.id;
      else delete ui.activeSessionId;
      state = {
        ...state,
        data: {
          ...state.data,
          turns: {
            status: 'ok',
            value: fallback ? (sessionTurns.get(fallback.id) ?? []) : [],
          },
        },
      };
    }
    state = { ...state, ui };
    pushAgentData();
  };

  const togglePinAgent = (ref: string): void => {
    const pinned = state.ui.settings.pinnedAgents;
    setSettings({
      pinnedAgents: pinned.includes(ref) ? pinned.filter((p) => p !== ref) : [...pinned, ref],
    });
  };

  function selectSession(id: string): void {
    state = {
      ...state,
      data: {
        ...state.data,
        turns: { status: 'ok', value: sessionTurns.get(id) ?? [] },
      },
      ui: { ...state.ui, activeSessionId: id },
    };
    push();
  }

  const deleteSession = (id: string): void => {
    sessions = sessions.filter((s) => s.id !== id);
    sessionTurns.delete(id);
    // If the deleted session was showing, fall back to the newest remaining one.
    if (state.ui.activeSessionId === id) {
      const fallback = [...sessions].sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      )[0];
      if (fallback) selectSession(fallback.id);
      else {
        const ui = { ...state.ui };
        delete ui.activeSessionId;
        state = {
          ...state,
          data: { ...state.data, turns: { status: 'ok', value: [] } },
          ui,
        };
      }
    }
    pushAgentData();
  };

  let newSessionSeq = 0;
  const newSession = (agentRef: string): void => {
    newSessionSeq += 1;
    const id = `s-new-${newSessionSeq}`;
    sessions = [
      { id, agentRef, title: 'new session', updatedAt: new Date().toISOString() },
      ...sessions,
    ];
    sessionTurns.set(id, []);
    selectSession(id);
    pushAgentData();
  };

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
    },
  };
  push();
  void loadAccounts();

  return { refresh, toggleRaw, dispose: () => handle.dispose() };
}
