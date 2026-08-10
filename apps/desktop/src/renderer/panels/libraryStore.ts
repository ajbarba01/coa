import { create } from 'zustand';
import type { InvocableSkill, LibraryView } from '@coa/console-viewmodel';
import {
  onInvocableSkills,
  rpcCopyLibrary,
  rpcLinkLibrary,
  rpcListLibrary,
  rpcListSkills,
  rpcRescanLibrary,
  rpcSetLibraryEnabled,
  rpcUnlinkLibrary,
} from '../console.js';
import { reportFailure, surfaceWrite } from '../shell/failures.js';

/**
 * The Library surface's data, LIVE from the daemon. The stores on disk are the source
 * of truth and `listLibrary` is the ONE read that renders them — this store never
 * computes drift/shadowing/effective sets itself, it only mirrors what the daemon last
 * said (the daemon computes drift inside the view; `rescan` is the same fresh read as
 * an explicit gesture — hash-on-demand, no watcher).
 *
 * Every mutation calls its verb through `surfaceWrite` (a daemon refusal — duplicate
 * name, missing source — is announced, never swallowed) and then re-lists: the
 * mutation replies carry one record, but the view's discovered/diagnostics halves
 * shift with every link/unlink, so the fresh read is what keeps the surface honest.
 *
 * `invocable` is the composer's and agent editor's feed (the daemon's `listSkills`
 * effective fold: enabled + resolvable, project shadowing personal). It stays
 * `undefined` until the first successful read — "not loaded" must never render as
 * "no skills".
 */

/** The one read's UI state — same shape discipline as `Remote<T>` (panels/state.ts). */
export type LibraryRead =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; view: LibraryView };

export interface EntryRef {
  kind: 'skill' | 'mcp';
  scope: 'personal' | 'project';
  name: string;
}

export interface LibraryState {
  read: LibraryRead;
  /** The effective invocable skills; `undefined` until the first successful read. */
  invocable: InvocableSkill[] | undefined;
  /** First load (and any later re-read that should not flash the skeleton — the
   *  status only rewinds to `loading` from a cold start). Idempotent per mount. */
  hydrate: () => Promise<void>;
  /** The explicit refresh gesture — a fresh scan/list (drift recomputes in it). */
  rescan: () => Promise<void>;
  link: (args: {
    kind: 'skill' | 'mcp';
    scope: 'personal' | 'project';
    source: { path: string; serverName?: string };
    name?: string;
  }) => Promise<void>;
  /** Copy into the PROJECT store; on an existing copy this IS the one-click re-sync. */
  copy: (args: {
    kind: 'skill' | 'mcp';
    source: { path: string; serverName?: string };
    name?: string;
  }) => Promise<void>;
  unlink: (ref: EntryRef) => Promise<void>;
  setEnabled: (ref: EntryRef, enabled: boolean) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => {
  /** Re-read both halves and reproject. A failed list degrades honestly: to the error
   *  state on a cold read, and to the LAST GOOD view after a mutation (the surface
   *  keeps rendering truth it already had; the mutation's own failure was announced). */
  async function refresh(): Promise<void> {
    const hadView = get().read.status === 'ok';
    try {
      const view = await rpcListLibrary();
      set({ read: { status: 'ok', view } });
    } catch (e) {
      if (!hadView) {
        set({ read: { status: 'error', message: e instanceof Error ? e.message : String(e) } });
      }
    }
    await refreshSkills();
  }

  /** The invocable feed degrades by keeping its previous value — advisory read. */
  async function refreshSkills(): Promise<void> {
    try {
      set({ invocable: (await rpcListSkills()).skills });
    } catch {
      // Keep whatever was last known; `undefined` still reads as "not loaded".
    }
  }

  return {
    read: { status: 'loading' },
    invocable: undefined,

    hydrate: async () => refresh(),

    rescan: async () => {
      const hadView = get().read.status === 'ok';
      try {
        const view = await rpcRescanLibrary();
        set({ read: { status: 'ok', view } });
      } catch (e) {
        if (!hadView) {
          set({ read: { status: 'error', message: e instanceof Error ? e.message : String(e) } });
        } else {
          // A rescan the user explicitly asked for failed — say so (a silent ⟳ that
          // does nothing reads as a dead control), but keep showing the last good view.
          reportFailure('rescan the library', e);
        }
      }
      await refreshSkills();
    },

    link: async (args) => {
      const linked = await surfaceWrite('link that into the library', rpcLinkLibrary(args));
      if (linked !== undefined) await refresh();
    },

    copy: async (args) => {
      const copied = await surfaceWrite('copy that into the project', rpcCopyLibrary(args));
      if (copied !== undefined) await refresh();
    },

    unlink: async (ref) => {
      const result = await surfaceWrite('unlink that entry', rpcUnlinkLibrary(ref));
      if (result !== undefined) await refresh();
    },

    setEnabled: async (ref, enabled) => {
      const result = await surfaceWrite(
        enabled ? 'enable that entry' : 'disable that entry',
        rpcSetLibraryEnabled({ ...ref, enabled }),
      );
      if (result !== undefined) await refresh();
    },
  };
});

// The drift-dismissal key folds in the same resolvable skill slice the chat banner
// compares — registered here (the store is the invocable list's one owner) so the
// controller never imports this module (see `onInvocableSkills` in console.ts).
onInvocableSkills(() => useLibraryStore.getState().invocable);
