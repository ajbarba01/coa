import { create } from 'zustand';

/**
 * The Library surface's own chrome state — the same reason `useAuthUi`/`useUsageUi`
 * (surfaceUi.ts) live outside the panel: the title-bar strip is part of the surface
 * (it carries the Skills/MCP switch and the rescan control), and it renders in the
 * shell's title-bar segment, not inside the panel body, so the strip and the body
 * need one shared store to never disagree about which tab is showing.
 */

/** The two kinds the library manages, one tab each. */
export type LibraryTab = 'skills' | 'mcp';
export const LIBRARY_TABS: LibraryTab[] = ['skills', 'mcp'];

/** Value/label split: the ids key the tab state, the labels are what the switch shows. */
export const LIBRARY_TAB_LABEL: Record<LibraryTab, string> = { skills: 'Skills', mcp: 'MCP' };

export interface LibraryUiState {
  tab: LibraryTab;
  setTab: (tab: LibraryTab) => void;
}

export const useLibraryUi = create<LibraryUiState>((set) => ({
  tab: 'skills',
  setTab: (tab) => set({ tab }),
}));
