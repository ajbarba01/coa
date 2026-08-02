import { create } from 'zustand';

/**
 * The agents surface's own chrome state — the same reason `useAuthUi`/`useUsageUi`
 * (surfaceUi.ts) live outside the panel: the title-bar strip is part of the surface, and
 * it renders in the shell's title-bar segment, not inside the panel body, so the strip
 * and the surface body need one shared store to never disagree about what they show.
 *
 * WHICH agent is open is real ConsoleState (`ui.selectedAgentRef` + the `selectAgent`
 * action) — that's a daemon-shaped concern, not chrome. This store only carries the
 * surface's own presentation state: the filter query, the measured pane width, and
 * whether a narrow pane's drill-down is showing the detail rather than the list.
 * `open` is local (not derived from `selectedAgentRef`) because `selectAgent` takes a
 * ref, never `undefined` — walking back to the list on a narrow pane must stop LOOKING
 * at the open agent without un-selecting it (the wide layout still needs something to
 * show if the pane widens again).
 */
export interface AgentsUiState {
  query: string;
  setQuery: (query: string) => void;
  /** Mirrored from the surface's pane-width measurement so the STRIP can wear the
   *  drill-down's back control (the strip is part of the surface, and only the narrow
   *  shape has a drill-down to climb out of). */
  narrow: boolean;
  setNarrow: (narrow: boolean) => void;
  /** On a narrow pane, is the drill-down showing the detail (true) or the list (false)? */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Bumped whenever the filter input should take focus — ctrl+f on the agents surface.
   *  A nonce rather than a flag, mirroring `useShell.focusComposer`: two consecutive
   *  requests to focus are two events, and the strip's input effect must answer both. */
  filterFocus: number;
  focusFilter: () => void;
}

export const useAgentsUi = create<AgentsUiState>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
  narrow: false,
  setNarrow: (narrow) => set({ narrow }),
  open: false,
  setOpen: (open) => set({ open }),
  filterFocus: 0,
  focusFilter: () => set((s) => ({ filterFocus: s.filterFocus + 1 })),
}));
