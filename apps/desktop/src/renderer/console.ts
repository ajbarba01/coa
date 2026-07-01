import { createStaticEngine, parseDescriptor } from '@coa/console-layout';
import type { CapState, Checkpoint, FeedView } from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../shared/settings.js';
import { MOCK_TURNS } from './panels/mockConversation.js';
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
  });
  // Seed the nav selection from the restored layout so the highlighted tab matches
  // the panel actually shown (a persisted layout may open on a non-default surface).
  state = {
    ...state,
    ui: { ...state.ui, settings, activeMainPanelId: getMainPanelId(descriptor) },
  };
  // The conversation stream is a shell-owned mock (its daemon verb is unbuilt); seed
  // it ready so the dock chat renders on first paint. Swapping this for the verb is a
  // one-line data-source change.
  state = { ...state, data: { ...state.data, turns: { status: 'ok', value: MOCK_TURNS } } };
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
    void bridge.saveSettings(next);
    state = { ...state, ui: { ...state.ui, settings: next } };
    push();
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

  state = {
    ...state,
    actions: {
      setRoute,
      refresh: () => void refresh(),
      switchAccount,
      setSettings,
      toggleRaw,
      respondApproval,
    },
  };
  push();
  void loadAccounts();

  return { refresh, toggleRaw, dispose: () => handle.dispose() };
}
