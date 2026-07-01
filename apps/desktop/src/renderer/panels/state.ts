import type { CapState } from '@coa/console-viewmodel';

/** A single async read's UI state — carries loading/error/value through the
 *  pure selectors so panels can render states-first. */
export type Remote<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: T };

/** The daemon reads the console has fetched. Widened in later parts. */
export interface ConsoleData {
  cap: Remote<CapState>;
}

/** Local view state (not daemon data). Widened in later parts. */
export interface ConsoleUi {
  /** Which surface panel currently fills the nav-driven main region. */
  activeMainPanelId: string;
}

/** App-owned callbacks panels invoke to drive the console. Widened in later parts. */
export interface ConsoleActions {
  setRoute: (panelId: string) => void;
  refresh: () => void;
}

/** The single object pushed into the engine via setDaemonState: data down,
 *  actions up. Every panel's pure selectVm reads only what it needs. */
export interface ConsoleState {
  data: ConsoleData;
  ui: ConsoleUi;
  actions: ConsoleActions;
}

/** The default main surface when nothing is persisted. */
export const DEFAULT_MAIN_PANEL_ID = 'cost';

export function initialState(actions: ConsoleActions): ConsoleState {
  return {
    data: { cap: { status: 'loading' } },
    ui: { activeMainPanelId: DEFAULT_MAIN_PANEL_ID },
    actions,
  };
}
