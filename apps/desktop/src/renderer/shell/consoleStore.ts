import { create } from 'zustand';
import type { ConsoleState } from '../panels/state.js';

/**
 * Holds the single `ConsoleState` (data down, actions up) the app composition root
 * assembles, so Workbench components read it via a plain hook instead of the
 * engine's imperative `setDaemonState`. `undefined` until the first publish.
 */
export const useConsoleState = create<ConsoleState | undefined>(() => undefined);

/** Module-level publish so non-component code (the composition root) can push a
 *  fresh `ConsoleState` without holding a hook reference. A full replace, not a
 *  merge — `ConsoleState` is assembled whole by its owner each time. */
export function publishConsoleState(s: ConsoleState): void {
  useConsoleState.setState(s, true);
}
