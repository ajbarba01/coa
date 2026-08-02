import { create } from 'zustand';
import type { Range } from './mockUsage.js';

/**
 * The auth/usage surfaces' own chrome state.
 *
 * It lives OUTSIDE the panels because the title bar is part of the surface (the chat surface's
 * strip is its tabs; auth's is its add-control; usage's is its range picker) — and the strip
 * renders in the shell's title-bar segment, not inside the panel body. One store, so the two
 * halves of one surface can never disagree about what is selected.
 */

export interface AuthUiState {
  /** The provider whose detail is open. Undefined on a narrow pane = the list is showing. */
  selected?: string | undefined;
  /** Mirrored from the surface's pane-width measurement so the STRIP can wear the
   *  drill-down's back control (the strip is part of the surface, and only the narrow
   *  shape has a drill-down to climb out of). */
  narrow: boolean;
  select: (providerId: string | undefined) => void;
  setNarrow: (narrow: boolean) => void;
}

export const useAuthUi = create<AuthUiState>((set) => ({
  selected: undefined,
  narrow: false,
  select: (selected) => set({ selected }),
  setNarrow: (narrow) => set({ narrow }),
}));

/** The two readings usage carries — different enough to be two sub-views, not one mixed
 *  list: backends are metered in dollars and limit windows, tool services in key health. */
export type UsageView = 'providers' | 'tools';
export const USAGE_VIEWS: UsageView[] = ['providers', 'tools'];

/** Value/label split: the ids key the view state, the labels are what the switcher shows. */
export const USAGE_VIEW_LABEL: Record<UsageView, string> = {
  providers: 'Providers',
  tools: 'Tools',
};

export interface UsageUiState {
  view: UsageView;
  range: Range;
  /** Providers the view is narrowed to (the icon rail) — ANY combination; empty = all.
   *  Exactly one selected re-stacks the chart BY ACCOUNT, the reading "all" cannot give. */
  scopes: string[];
  /** The account whose dashboard is open (level 2 — providers view only). */
  opened?: string | undefined;
  setView: (view: UsageView) => void;
  setRange: (range: Range) => void;
  toggleScope: (providerId: string) => void;
  open: (credentialId: string | undefined) => void;
}

export const useUsageUi = create<UsageUiState>((set) => ({
  view: 'providers',
  range: 'today',
  scopes: [],
  opened: undefined,
  // Switching views closes an open drill-down — the tools view has no level 2, and coming
  // back to providers should land on the overview, not a dashboard you left minutes ago.
  setView: (view) => set({ view, opened: undefined }),
  setRange: (range) => set({ range }),
  toggleScope: (providerId) =>
    set((s) => ({
      scopes: s.scopes.includes(providerId)
        ? s.scopes.filter((id) => id !== providerId)
        : [...s.scopes, providerId],
    })),
  open: (opened) => set({ opened }),
}));
