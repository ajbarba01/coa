import type { CapState, Checkpoint, FeedView } from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../../shared/settings.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';

/** A single async read's UI state — carries loading/error/value through the
 *  pure selectors so panels can render states-first. */
export type Remote<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: T };

/** The account list + which one is active, composed from two daemon verbs. */
export interface AccountsInfo {
  accounts: { label: string }[];
  active: string;
}

/** The daemon reads the console has fetched. */
export interface ConsoleData {
  cap: Remote<CapState>;
  flags: Remote<FeedView>;
  timeline: Remote<Checkpoint[]>;
  accounts: Remote<AccountsInfo>;
}

/** Local view state (not daemon data). */
export interface ConsoleUi {
  /** Which surface panel currently fills the nav-driven main region. */
  activeMainPanelId: string;
  settings: ConsoleSettings;
}

/** App-owned callbacks panels invoke to drive the console. */
export interface ConsoleActions {
  setRoute: (panelId: string) => void;
  refresh: () => void;
  switchAccount: (label: string) => void;
  setSettings: (patch: Partial<ConsoleSettings>) => void;
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
    data: {
      cap: { status: 'loading' },
      flags: { status: 'loading' },
      timeline: { status: 'loading' },
      accounts: { status: 'loading' },
    },
    ui: { activeMainPanelId: DEFAULT_MAIN_PANEL_ID, settings: DEFAULT_SETTINGS },
    actions,
  };
}
