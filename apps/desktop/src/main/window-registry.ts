/**
 * F11: the `mainWindow: BrowserWindow | undefined` singleton generalizes into this
 * registry — a multi-window map, each entry tracking which project root it is
 * bound to. Every window-scoped decision (which window to focus for "same project
 * opened twice", which project a daemon-status push belongs to, which root an IPC
 * call resolves against) reduces to a lookup here.
 *
 * Generic over the window handle type `W` so the decision logic (this whole file)
 * never imports Electron and is fully unit-testable; `index.ts` instantiates it
 * with real `BrowserWindow`s. Identity is never raw string equality — every root
 * comparison goes through the injected `canonicalize` (case-insensitive on
 * Windows, matching the exact rule `defaultDaemonPath` hashes from), so the same
 * project is recognized regardless of trailing slash / separator style / case.
 */

export interface WindowEntry<W> {
  id: number;
  win: W;
  root: string;
}

export interface WindowRegistry<W> {
  /** Register a freshly created window bound to `root`. */
  bind: (id: number, win: W, root: string) => void;
  /** Rebind an already-registered window to a different project (swap-in-current-
   *  window). A no-op if `id` isn't registered. */
  rebind: (id: number, root: string) => void;
  /** Drop a window — it closed. */
  unbind: (id: number) => void;
  /** The project root a window is bound to, if it's still registered. */
  rootOf: (id: number) => string | undefined;
  /** The window currently bound to `root` (by canonical identity), if any — the
   *  core decision behind "same project opened twice -> focus the existing
   *  window" and second-instance project-aware focusing. */
  windowForRoot: (root: string) => W | undefined;
  /** Every currently bound root, one per open window — what launch-restore persists. */
  openRoots: () => string[];
  /** Every registered entry. */
  all: () => WindowEntry<W>[];
}

export function createWindowRegistry<W>(canonicalize: (root: string) => string): WindowRegistry<W> {
  const entries = new Map<number, WindowEntry<W>>();

  return {
    bind: (id, win, root) => {
      entries.set(id, { id, win, root });
    },
    rebind: (id, root) => {
      const entry = entries.get(id);
      if (entry !== undefined) entry.root = root;
    },
    unbind: (id) => {
      entries.delete(id);
    },
    rootOf: (id) => entries.get(id)?.root,
    windowForRoot: (root) => {
      const key = canonicalize(root);
      for (const entry of entries.values()) {
        if (canonicalize(entry.root) === key) return entry.win;
      }
      return undefined;
    },
    openRoots: () => [...entries.values()].map((entry) => entry.root),
    all: () => [...entries.values()],
  };
}
