import type { CapState } from '@coa/console-viewmodel';

/** A single async read's UI state — carries loading/error/value through the
 *  pure selector so panels can render states-first. */
export type Remote<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: T };

/** The aggregate the app polls and pushes into the engine. Widened in later plans. */
export interface DaemonState {
  cap: Remote<CapState>;
}

export const INITIAL_STATE: DaemonState = { cap: { status: 'loading' } };
