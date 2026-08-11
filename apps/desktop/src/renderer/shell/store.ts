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
  /** Closed tabs, most recent last — the browser's reopen stack. Closing a tab drops the
   *  session from the working set, never from the daemon, so reopening is just re-adding
   *  its id. Deleting a session purges it from here (nothing to come back to). */
  closedTabs: string[];
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
  /** The agent picker — the one way a session is started (the + control and ctrl+t both
   *  open it). */
  newSessionOpen: boolean;
  /** The auth surface's add-provider catalogue. A modal is a SHELL citizen whatever
   *  surface asked for it — living here is what keeps the single-dialog rule airtight. */
  addProviderOpen: boolean;
  /** The provider the remove-confirm dialog is asking about (undefined = closed). A
   *  payload-bearing dialog joins the exclusive set like any other. */
  confirmRemoveProvider?: string | undefined;
  /** The provider whose add-from-defaults model dialog is open (undefined = closed). */
  addModelsProvider?: string | undefined;
  /** The custom model the remove-confirm dialog is asking about (undefined = closed). */
  confirmRemoveModel?: { providerId: string; id: string } | undefined;
  /** The login the remove-confirm dialog is asking about (undefined = closed). */
  confirmRemoveCredential?: string | undefined;
  /** F11: the project the swap-while-active confirm dialog is asking about (undefined =
   *  closed). Only raised when `openProject({target:'current'})` would swap THIS window
   *  away from a session that has a turn actively running — see `shouldConfirmSwap`. */
  confirmSwapProject?: { root: string; name: string } | undefined;
  /** The provider whose driven-login EMAIL pre-step is open (undefined = closed). Only the
   *  renderer-local pre-step joins the exclusive set — once the daemon owns a flow, the
   *  dialog projects daemon state and is dismissed only by an explicit cancel (killing a
   *  running CLI login must never be a side effect of opening another dialog). A relogin
   *  that lost its email carries the credential it aims at. */
  loginEmailFor?: { providerId: string; credentialId?: string } | undefined;
  /** Bumped whenever the composer should take focus — opening a session, or Enter pressed
   *  anywhere in the conversation. A nonce rather than a flag: two consecutive requests to
   *  focus are two events, and the composer must answer both. */
  composerFocus: number;
  /** The coa daemon itself — the console is a client; no daemon, no console. */
  daemon: DaemonStatus;
  /** Why the daemon is in that state, when there is anything to say (a failure). The gate
   *  renders it: an error the user cannot read the reason for is an error they cannot fix. */
  daemonReason?: string | undefined;
  /** The REAL window maximize state (main pushes it) — drives the restore glyph. */
  maximized: boolean;
  /** The open project, read from main (which derives it from the CALLING window's bound
   *  root — F11: one project per window, never one app-wide workspace). */
  workspace?: { name: string; root: string } | undefined;
  /** Bumped on every F11 project SWAP (never on the initial boot-time read — see
   *  `applyProjectSwitch`) — the composition root keys the console controller's lifecycle
   *  on this, so a swap tears down and reboots the controller exactly like a fresh window
   *  mount, rather than trying to patch stale project-scoped state in place. */
  projectEpoch: number;

  /** Also exits search mode (a surface switch is a work-mode navigation). */
  setSurface: (id: string) => void;
  /** Adds to `tabs` if absent, and brings the chat surface forward in work mode — opening
   *  a session means looking at it, wherever you were. */
  openTab: (sessionId: string) => void;
  closeTab: (sessionId: string) => void;
  /** Reopen the most recently closed tab; returns its id (undefined if the stack is empty)
   *  so the caller can also make it active. */
  reopenTab: () => string | undefined;
  /** Rearrange a tab within the working set (from one index to another). Working-set
   *  only — the browser's session ordering is unaffected. */
  reorderTabs: (fromId: string, toIndex: number) => void;
  /** A deleted session can't be reopened — drop it from the stack (and the working set). */
  forgetTab: (sessionId: string) => void;
  /** Forget several at once. One write, so a subscriber watching the working set never
   *  sees a half-pruned strip — the tabs it reacts to are the ones that survived. */
  forgetTabs: (sessionIds: readonly string[]) => void;
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
  setNewSessionOpen: (open: boolean) => void;
  setAddProviderOpen: (open: boolean) => void;
  setConfirmRemoveProvider: (providerId: string | undefined) => void;
  setAddModelsProvider: (providerId: string | undefined) => void;
  setConfirmRemoveModel: (target: { providerId: string; id: string } | undefined) => void;
  setConfirmRemoveCredential: (id: string | undefined) => void;
  setConfirmSwapProject: (target: { root: string; name: string } | undefined) => void;
  setLoginEmailFor: (target: { providerId: string; credentialId?: string } | undefined) => void;
  /** Put the caret in the composer — whatever the user types next is a message. */
  focusComposer: () => void;
  setDaemon: (daemon: DaemonStatus, reason?: string) => void;
  setMaximized: (maximized: boolean) => void;
  /** The boot-time read only (`App`'s one-shot `getWorkspace()` on mount). Never call this
   *  for a runtime project switch — it does not clear project-scoped chrome or bump
   *  `projectEpoch`; use `applyProjectSwitch` instead. */
  setWorkspace: (workspace: { name: string; root: string }) => void;
  /** F11 — commit a project switch that just happened in THIS window: adopts the new
   *  workspace, drops the tab strip (open/closed tabs name the OLD project's sessions, and
   *  a session id from one project means nothing in another), closes whatever dialog asked
   *  for the swap, and bumps `projectEpoch` so the composition root tears down and reboots
   *  the console controller fresh — the same boot sequence a brand new window runs. */
  applyProjectSwitch: (workspace: { name: string; root: string }) => void;
}

/** The modal overlays are mutually exclusive — opening one dismisses the rest so they
 *  never stack over each other. All false = every dialog closed. Every new dialog joins
 *  this set; a dialog opened any other way is a single-dialog-rule violation. */
const CLOSE_ALL_DIALOGS = {
  settingsOpen: false,
  shortcutsOpen: false,
  paletteOpen: false,
  projectOpen: false,
  newSessionOpen: false,
  addProviderOpen: false,
  confirmRemoveProvider: undefined,
  addModelsProvider: undefined,
  confirmRemoveModel: undefined,
  confirmRemoveCredential: undefined,
  confirmSwapProject: undefined,
  loginEmailFor: undefined,
} as const;

export const useShell = create<ShellState>((set, get) => ({
  surface: 'chat',
  mode: 'work',
  query: '',
  tabs: [],
  closedTabs: [],
  previewId: undefined,
  workOpen: true,
  navWidth: 196,
  workWidth: 218,
  settingsOpen: false,
  shortcutsOpen: false,
  paletteOpen: false,
  projectOpen: false,
  newSessionOpen: false,
  addProviderOpen: false,
  confirmRemoveProvider: undefined,
  addModelsProvider: undefined,
  confirmRemoveModel: undefined,
  confirmRemoveCredential: undefined,
  confirmSwapProject: undefined,
  loginEmailFor: undefined,
  composerFocus: 0,
  daemon: 'stopped',
  daemonReason: undefined,
  maximized: false,
  workspace: undefined,
  projectEpoch: 0,

  setSurface: (surface) => set({ surface, mode: 'work' }),
  openTab: (sessionId) =>
    set((s) => ({
      tabs: s.tabs.includes(sessionId) ? s.tabs : [...s.tabs, sessionId],
      surface: 'chat',
      mode: 'work',
      // Opening a session is an invitation to say something: the caret lands in the
      // composer, so typing goes straight into the message.
      composerFocus: s.composerFocus + 1,
    })),
  closeTab: (sessionId) =>
    set((s) => ({
      tabs: s.tabs.filter((t) => t !== sessionId),
      // Re-closing a tab moves it to the top of the stack rather than duplicating it.
      closedTabs: [...s.closedTabs.filter((t) => t !== sessionId), sessionId],
    })),
  reopenTab: () => {
    const { closedTabs, tabs } = get();
    const id = closedTabs.at(-1);
    if (id === undefined) return undefined;
    set({
      closedTabs: closedTabs.slice(0, -1),
      tabs: tabs.includes(id) ? tabs : [...tabs, id],
      mode: 'work',
    });
    return id;
  },
  forgetTab: (sessionId: string) => get().forgetTabs([sessionId]),
  forgetTabs: (sessionIds) =>
    set((s) => {
      const drop = new Set(sessionIds);
      return {
        tabs: s.tabs.filter((t) => !drop.has(t)),
        closedTabs: s.closedTabs.filter((t) => !drop.has(t)),
      };
    }),
  reorderTabs: (fromId, toIndex) =>
    set((s) => {
      const tabs = s.tabs.filter((id) => id !== fromId);
      const at = Math.max(0, Math.min(toIndex, tabs.length));
      tabs.splice(at, 0, fromId);
      return { tabs };
    }),
  setPreview: (previewId) => set({ previewId }),
  setMode: (mode) => set({ mode }),
  // Search lives on the chat surface (the strip morphs) — opening it from any
  // other surface routes home first, so ctrl+p never strands an invisible mode.
  // It also closes every dialog: the shortcut swaps, so search can never open
  // (and steal focus) behind a modal.
  openSearch: () => set({ ...CLOSE_ALL_DIALOGS, surface: 'chat', mode: 'search', query: '' }),
  closeSearch: () => set({ mode: 'work', query: '' }),
  setQuery: (query) => set({ query }),
  toggleWork: () => set((s) => ({ workOpen: !s.workOpen })),
  setWorkOpen: (workOpen) => set({ workOpen }),
  setNavWidth: (navWidth) => set({ navWidth }),
  setWorkWidth: (workWidth) => set({ workWidth }),
  // Opening any dialog first clears the others (single dialog at a time); closing leaves
  // the rest untouched.
  setSettingsOpen: (open) =>
    set(open ? { ...CLOSE_ALL_DIALOGS, settingsOpen: true } : { settingsOpen: false }),
  setShortcutsOpen: (open) =>
    set(open ? { ...CLOSE_ALL_DIALOGS, shortcutsOpen: true } : { shortcutsOpen: false }),
  setPaletteOpen: (open) =>
    set(open ? { ...CLOSE_ALL_DIALOGS, paletteOpen: true } : { paletteOpen: false }),
  setProjectOpen: (open) =>
    set(open ? { ...CLOSE_ALL_DIALOGS, projectOpen: true } : { projectOpen: false }),
  setNewSessionOpen: (open) =>
    set(open ? { ...CLOSE_ALL_DIALOGS, newSessionOpen: true } : { newSessionOpen: false }),
  setAddProviderOpen: (open) =>
    set(open ? { ...CLOSE_ALL_DIALOGS, addProviderOpen: true } : { addProviderOpen: false }),
  setConfirmRemoveProvider: (providerId) =>
    set(
      providerId !== undefined
        ? { ...CLOSE_ALL_DIALOGS, confirmRemoveProvider: providerId }
        : { confirmRemoveProvider: undefined },
    ),
  setAddModelsProvider: (providerId) =>
    set(
      providerId !== undefined
        ? { ...CLOSE_ALL_DIALOGS, addModelsProvider: providerId }
        : { addModelsProvider: undefined },
    ),
  setConfirmRemoveModel: (target) =>
    set(
      target !== undefined
        ? { ...CLOSE_ALL_DIALOGS, confirmRemoveModel: target }
        : { confirmRemoveModel: undefined },
    ),
  setConfirmRemoveCredential: (id) =>
    set(
      id !== undefined
        ? { ...CLOSE_ALL_DIALOGS, confirmRemoveCredential: id }
        : { confirmRemoveCredential: undefined },
    ),
  setLoginEmailFor: (target) =>
    set(
      target !== undefined
        ? { ...CLOSE_ALL_DIALOGS, loginEmailFor: target }
        : { loginEmailFor: undefined },
    ),
  setConfirmSwapProject: (target) =>
    set(
      target !== undefined
        ? { ...CLOSE_ALL_DIALOGS, confirmSwapProject: target }
        : { confirmSwapProject: undefined },
    ),
  focusComposer: () => set((s) => ({ composerFocus: s.composerFocus + 1 })),
  setDaemon: (daemon, daemonReason) => set({ daemon, daemonReason }),
  setMaximized: (maximized) => set({ maximized }),
  setWorkspace: (workspace) => set({ workspace }),
  applyProjectSwitch: (workspace) =>
    set((s) => ({
      ...CLOSE_ALL_DIALOGS,
      workspace,
      projectEpoch: s.projectEpoch + 1,
      tabs: [],
      closedTabs: [],
      previewId: undefined,
    })),
}));
