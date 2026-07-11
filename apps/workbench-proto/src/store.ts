import type { SessionStatus } from '@coa/console-kit';
import { create } from 'zustand';

/** The app's base scale: the maintainer judged the whole surface better at
 *  120%, so that IS 100% now (body{zoom} in index.css; Electron will use
 *  webFrame.setZoomFactor). Pointer math that converts viewport coordinates
 *  into layout px must divide by this. */
export const ZOOM = 1.2;

/** Transcript frames — the prototype's mock of the daemon's TurnFrame view. */
export type Frame =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'think'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; tk: string; label: string }
  | {
      kind: 'toolx';
      id: string;
      tk: string;
      file: string;
      add: number;
      del: number;
      diff: { t: 'a' | 'd' | 'c'; line: string }[];
    }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'subagent'; id: string; name: string; status: SessionStatus; tick: string }
  | {
      kind: 'approval';
      id: string;
      tool: string;
      cmd: string;
      why: string;
      resolved?: 'approved' | 'denied';
    };

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
  hud: 'usage' | 'account' | 'flags';
  /** The nav-selected surface filling the center column. */
  surface: string;
  /** D85 raw mode — palette-toggled, surfaced only while ON. */
  raw: boolean;
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
  patchLastThink: (sessionId: string, text: string, streaming: boolean) => void;
  resolveApproval: (sessionId: string, frameId: string, decision: 'approved' | 'denied') => void;
  setRunning: (running: boolean) => void;
  setStatus: (sessionId: string, status: SessionStatus) => void;
}

export const useWorkbench = create<WorkbenchState>((set) => ({
  sessions: {},
  order: [],
  tabs: [],
  activeId: '',
  mode: 'work',
  query: '',
  running: false,
  hud: 'usage',
  surface: 'chat',
  raw: false,
  workOpen: true,
  settingsOpen: false,
  shortcutsOpen: false,
  navWidth: 196,
  workWidth: 218,
  daemon: 'running',

  setSurface: (surface) => set({ surface }),
  toggleRaw: () => set((s) => ({ raw: !s.raw })),
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
  patchLastThink: (sessionId, text, streaming) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      const frames = [...session.frames];
      for (let i = frames.length - 1; i >= 0; i--) {
        const f = frames[i];
        if (f && f.kind === 'think') {
          frames[i] = { ...f, text, streaming };
          break;
        }
      }
      return { sessions: { ...s.sessions, [sessionId]: { ...session, frames } } };
    }),
  resolveApproval: (sessionId, frameId, decision) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      const frames = session.frames.map((f) =>
        f.kind === 'approval' && f.id === frameId ? { ...f, resolved: decision } : f,
      );
      return { sessions: { ...s.sessions, [sessionId]: { ...session, frames } } };
    }),
  setRunning: (running) => set({ running }),
  setStatus: (sessionId, status) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return { sessions: { ...s.sessions, [sessionId]: { ...session, status } } };
    }),
}));
