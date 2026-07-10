import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import type { ConsoleActions, ConsoleState } from './state.js';
import { initialState } from './state.js';

/** Inert actions for test states; spread and override the ones under test. */
export const NOOP_ACTIONS: ConsoleActions = {
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
};

export interface StateOverrides {
  data?: Partial<ConsoleState['data']>;
  ui?: Partial<ConsoleState['ui']>;
  actions?: Partial<ConsoleActions>;
}

/** A ConsoleState for tests: everything loading + defaults, with deep overrides.
 *  Lives beside the panels (not in a .test file) so every panel test shares one
 *  builder instead of re-hand-rolling the state shape. */
export function makeState(overrides: StateOverrides = {}): ConsoleState {
  const base = initialState({ ...NOOP_ACTIONS, ...overrides.actions });
  return {
    data: { ...base.data, ...overrides.data },
    ui: { ...base.ui, settings: DEFAULT_SETTINGS, ...overrides.ui },
    actions: base.actions,
  };
}
