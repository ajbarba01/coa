import { createStaticEngine, parseDescriptor } from '@coa/console-layout';
import type { CapState, Checkpoint, FeedView } from '@coa/console-viewmodel';
import { buildPanelRegistry, DEFAULT_DESCRIPTOR } from './panels/registry.js';
import { LAYOUT_EPOCH, setMainPanelId } from './panels/routing.js';
import { initialState, type ConsoleState, type Remote } from './panels/state.js';

/** The subset of `window.coa` the controller needs (injected for testing). */
export interface ConsoleBridge {
  capState(): Promise<CapState>;
  flagsForUser(): Promise<FeedView>;
  listTimeline(): Promise<Checkpoint[]>;
  getLayout(): Promise<unknown>;
  saveLayout(descriptor: unknown): Promise<void>;
}

export interface ConsoleController {
  refresh(): Promise<void>;
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
  const engine = createStaticEngine();
  const persist = (d: unknown): void =>
    void bridge.saveLayout({ epoch: LAYOUT_EPOCH, descriptor: d });

  // Mount with placeholder actions; the real actions (which capture `handle`) are
  // installed just below and pushed before any interaction.
  let state: ConsoleState = initialState({ setRoute: () => {}, refresh: () => {} });
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
    handle.applyDescriptor(next); // sizes live in the descriptor, so they survive
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

  state = { ...state, actions: { setRoute, refresh: () => void refresh() } };
  push();

  return { refresh, dispose: () => handle.dispose() };
}
