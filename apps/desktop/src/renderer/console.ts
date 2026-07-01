import { createStaticEngine, parseDescriptor, type LayoutHandle } from '@coa/console-layout';
import type { CapState } from '@coa/console-viewmodel';
import { buildPanelRegistry, DEFAULT_DESCRIPTOR } from './panels/registry.js';
import { INITIAL_STATE, type DaemonState } from './panels/state.js';

/** The subset of `window.coa` the controller needs (injected for testing). */
export interface ConsoleBridge {
  capState(): Promise<CapState>;
  getLayout(): Promise<unknown>;
  saveLayout(descriptor: unknown): Promise<void>;
}

export interface ConsoleController {
  /** Poll the daemon once and push the result into the mounted panels. */
  refresh(): Promise<void>;
  dispose(): void;
}

/** Mount the layout engine into `container`, restore the persisted layout (falling
 *  back to the default on any corruption), and return a controller that polls the
 *  daemon and persists layout changes. */
export async function startConsole(
  container: HTMLElement,
  bridge: ConsoleBridge,
): Promise<ConsoleController> {
  const registry = buildPanelRegistry();
  const raw = await bridge.getLayout();
  const descriptor = parseDescriptor(raw, registry, DEFAULT_DESCRIPTOR);
  let state: DaemonState = INITIAL_STATE;
  const engine = createStaticEngine();
  const handle: LayoutHandle = engine.mount({
    container,
    descriptor,
    registry,
    daemonState: state,
    onChange: (d) => {
      void bridge.saveLayout(d);
    },
  });
  async function refresh(): Promise<void> {
    try {
      const value = await bridge.capState();
      state = { ...state, cap: { status: 'ok', value } };
    } catch (e) {
      state = {
        ...state,
        cap: { status: 'error', message: e instanceof Error ? e.message : String(e) },
      };
    }
    handle.setDaemonState(state);
  }
  return { refresh, dispose: () => handle.dispose() };
}
