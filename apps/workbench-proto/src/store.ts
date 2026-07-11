import type { SessionStatus } from '@coa/console-kit';
import { create } from 'zustand';
import type { Frame } from './chat/model.js';

/** The app's base scale: the maintainer judged the whole surface better at
 *  120%, so that IS 100% now (body{zoom} in index.css; Electron will use
 *  webFrame.setZoomFactor). Pointer math that converts viewport coordinates
 *  into layout px must divide by this. */
export const ZOOM = 1.2;

export interface ChangedFile {
  path: string;
  add: number;
  del: number;
}

export interface AgentNode {
  name: string;
  status: SessionStatus;
  cost?: string;
  depth: number;
}

export interface QueuedMessage {
  id: string;
  text: string;
}

export interface Session {
  id: string;
  title: string;
  agent: string;
  status: SessionStatus;
  cost: string;
  flags: number;
  divider?: string;
  recency: string;
  frames: Frame[];
  agents: AgentNode[];
  changes: ChangedFile[];
  branch?: string;
}

export interface WorkbenchState {
  sessions: Record<string, Session>;
  order: string[];
  /** The open tabs (working set) in order. */
  tabs: string[];
  activeId: string;
  /** Session hovered in the browser — the right column previews it (search mode). */
  previewId?: string | undefined;
  mode: 'work' | 'search';
  query: string;
  running: boolean;
  /** Epoch ms the in-flight turn started — drives the working footer's count. */
  runningSince?: number | undefined;
  /** Messages queued during a running turn, released FIFO at its end. */
  queued: QueuedMessage[];
  hud: 'usage' | 'account' | 'flags';
  /** The nav-selected surface filling the center column. */
  surface: string;
  /** D85 raw mode — palette-toggled, surfaced only while ON. */
  raw: boolean;
  /** Transcript width: true = unbounded (full panel); false = the composer's
   *  reading measure. Toggled from the transcript's corner control. */
  chatWide: boolean;
  /** Right column visibility — the left nav never collapses; this one does. */
  workOpen: boolean;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  /** Drag-resizable column widths (layout px). */
  navWidth: number;
  workWidth: number;
  /** The coa daemon itself — the console is a client; no daemon, no console. */
  daemon: 'running' | 'starting' | 'stopped';

  select: (id: string) => void;
  setPreview: (id?: string) => void;
  setSurface: (surface: string) => void;
  toggleRaw: () => void;
  toggleChatWide: () => void;
  toggleWork: () => void;
  setWorkOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setNavWidth: (px: number) => void;
  setWorkWidth: (px: number) => void;
  setDaemon: (daemon: WorkbenchState['daemon']) => void;
  openSearch: () => void;
  closeSearch: () => void;
  setQuery: (q: string) => void;
  setHud: (h: WorkbenchState['hud']) => void;
  appendFrame: (sessionId: string, frame: Frame) => void;
  /** Patch one frame in place (streaming growth, plan updates, resolves). */
  patchFrame: (sessionId: string, frameId: string, patch: (f: Frame) => Frame) => void;
  queueMessage: (text: string) => void;
  removeQueued: (id: string) => void;
  /** Pop the head of the queue (FIFO release at turn end). */
  shiftQueued: () => QueuedMessage | undefined;
  setRunning: (running: boolean) => void;
  setStatus: (sessionId: string, status: SessionStatus) => void;
}

let queuedId = 0;

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  sessions: {},
  order: [],
  tabs: [],
  activeId: '',
  mode: 'work',
  query: '',
  running: false,
  queued: [],
  hud: 'usage',
  surface: 'chat',
  raw: false,
  chatWide: true,
  workOpen: true,
  settingsOpen: false,
  shortcutsOpen: false,
  navWidth: 196,
  workWidth: 218,
  daemon: 'running',

  setSurface: (surface) => set({ surface }),
  toggleRaw: () => set((s) => ({ raw: !s.raw })),
  toggleChatWide: () => set((s) => ({ chatWide: !s.chatWide })),
  toggleWork: () => set((s) => ({ workOpen: !s.workOpen })),
  setWorkOpen: (workOpen) => set({ workOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setNavWidth: (navWidth) => set({ navWidth }),
  setWorkWidth: (workWidth) => set({ workWidth }),
  setDaemon: (daemon) => set({ daemon }),
  select: (id) =>
    set((s) => ({
      activeId: id,
      previewId: undefined,
      mode: 'work',
      query: '',
      tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id],
    })),
  setPreview: (id) => set({ previewId: id }),
  openSearch: () => set({ mode: 'search', query: '' }),
  closeSearch: () => set({ mode: 'work', query: '', previewId: undefined }),
  setQuery: (q) => set({ query: q }),
  setHud: (h) => set({ hud: h }),
  appendFrame: (sessionId, frame) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...session, frames: [...session.frames, frame] },
        },
      };
    }),
  patchFrame: (sessionId, frameId, patch) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      const frames = session.frames.map((f) => (f.id === frameId ? patch(f) : f));
      return { sessions: { ...s.sessions, [sessionId]: { ...session, frames } } };
    }),
  queueMessage: (text) => set((s) => ({ queued: [...s.queued, { id: `q${queuedId++}`, text }] })),
  removeQueued: (id) => set((s) => ({ queued: s.queued.filter((q) => q.id !== id) })),
  shiftQueued: () => {
    const head = get().queued[0];
    if (head !== undefined) set((s) => ({ queued: s.queued.slice(1) }));
    return head;
  },
  setRunning: (running) =>
    set(() =>
      running ? { running, runningSince: Date.now() } : { running, runningSince: undefined },
    ),
  setStatus: (sessionId, status) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return { sessions: { ...s.sessions, [sessionId]: { ...session, status } } };
    }),
}));
