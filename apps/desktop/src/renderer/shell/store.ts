import { create } from 'zustand';
import type { DaemonStatus } from '../../shared/methods.js';

/**
 * The workbench shell's own chrome state (nav surface, search overlay, tab strip,
 * dock visibility/width, the palette/settings/shortcuts/project dialogs, and the
 * daemon lifecycle badge) — the plain-React replacement for the console-layout
 * engine. Mirrors `apps/workbench-proto/src/store.ts`'s naming; the resize-boundary
 * width CONSTANTS (min/max) stay out of this store — they belong with the drag seams
 * in Workbench, not the state it reads.
 */
export interface ShellState {
  /** The nav-selected surface filling the main region. */
  surface: string;
  mode: 'work' | 'search';
  query: string;
  /** The open tabs (working set) in order. */
  tabs: string[];
  /** Session hovered in the browser — the dock previews it (search mode). */
  previewId?: string | undefined;
  /** Right column (dock) visibility — the left nav never collapses; this one does. */
  workOpen: boolean;
  /** Drag-resizable column widths (layout px). */
  navWidth: number;
  workWidth: number;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  paletteOpen: boolean;
  projectOpen: boolean;
  /** The coa daemon itself — the console is a client; no daemon, no console. */
  daemon: DaemonStatus;
  /** The REAL window maximize state (main pushes it) — drives the restore glyph. */
  maximized: boolean;
  /** The open project, read from main (which derives it from the daemon's cwd). */
  workspace?: { name: string; root: string } | undefined;

  /** Also exits search mode (a surface switch is a work-mode navigation). */
  setSurface: (id: string) => void;
  /** Adds to `tabs` if absent, and switches to work mode. */
  openTab: (sessionId: string) => void;
  closeTab: (sessionId: string) => void;
  setPreview: (id?: string) => void;
  setMode: (mode: 'work' | 'search') => void;
  openSearch: () => void;
  closeSearch: () => void;
  setQuery: (query: string) => void;
  toggleWork: () => void;
  setWorkOpen: (open: boolean) => void;
  setNavWidth: (px: number) => void;
  setWorkWidth: (px: number) => void;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setProjectOpen: (open: boolean) => void;
  setDaemon: (daemon: DaemonStatus) => void;
  setMaximized: (maximized: boolean) => void;
  setWorkspace: (workspace: { name: string; root: string }) => void;
}

export const useShell = create<ShellState>((set) => ({
  surface: 'chat',
  mode: 'work',
  query: '',
  tabs: [],
  previewId: undefined,
  workOpen: true,
  navWidth: 196,
  workWidth: 218,
  settingsOpen: false,
  shortcutsOpen: false,
  paletteOpen: false,
  projectOpen: false,
  daemon: 'stopped',
  maximized: false,
  workspace: undefined,

  setSurface: (surface) => set({ surface, mode: 'work' }),
  openTab: (sessionId) =>
    set((s) => ({
      tabs: s.tabs.includes(sessionId) ? s.tabs : [...s.tabs, sessionId],
      mode: 'work',
    })),
  closeTab: (sessionId) => set((s) => ({ tabs: s.tabs.filter((t) => t !== sessionId) })),
  setPreview: (previewId) => set({ previewId }),
  setMode: (mode) => set({ mode }),
  openSearch: () => set({ mode: 'search', query: '' }),
  closeSearch: () => set({ mode: 'work', query: '' }),
  setQuery: (query) => set({ query }),
  toggleWork: () => set((s) => ({ workOpen: !s.workOpen })),
  setWorkOpen: (workOpen) => set({ workOpen }),
  setNavWidth: (navWidth) => set({ navWidth }),
  setWorkWidth: (workWidth) => set({ workWidth }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setProjectOpen: (projectOpen) => set({ projectOpen }),
  setDaemon: (daemon) => set({ daemon }),
  setMaximized: (maximized) => set({ maximized }),
  setWorkspace: (workspace) => set({ workspace }),
}));
