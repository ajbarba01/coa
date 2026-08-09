import type { DaemonManager } from './daemon-manager.js';

/**
 * F11: the single app-wide daemon manager generalizes into one manager PER
 * PROJECT ROOT, refcounted by the windows currently bound to it. coa's
 * attended-v1 model never runs a daemon with zero windows watching it, so the
 * moment a project's last window releases it, the daemon is stopped and its
 * manager discarded — the next acquire spawns fresh.
 *
 * Refcounting (not just presence) matters because a project can be released and
 * re-acquired in the same tick — a window swapping FROM this project TO another
 * and possibly back, or a second-instance request that names a project mid-swap.
 * The registered entry is kept until its `stop()` actually resolves (never
 * deleted the instant refs hits zero), so a reference that arrives while a stop
 * is still in flight REVIVES the same manager instead of racing a second
 * `createManager` for the same project — `DaemonManager` already serializes its
 * own start/stop internally (see daemon-manager.ts's `inflight` chain), so a
 * `start()` queued behind an in-flight `stop()` is safe, exactly like `restart()`.
 * Without this, two daemon processes could momentarily both hold the same
 * project's `.coa/local/` state open — the concurrent-write hazard F11 rules out.
 */
export interface DaemonRegistryDeps {
  /** Build a fresh DaemonManager for `root`, wired to that project's endpoint +
   *  spawn command. Called once per root per "generation" — a root re-acquired
   *  after its manager fully stopped gets a brand-new manager + connection. */
  createManager: (root: string) => DaemonManager;
  /** Canonicalize a root for identity — same-project comparisons go through this
   *  (case-insensitive on Windows), never raw string equality. */
  canonicalize: (root: string) => string;
}

export interface DaemonRegistry {
  /** Get-or-create the manager for `root` and take one reference on it (a window
   *  binding to this project). Starts the daemon on first acquire (or revives it
   *  if a teardown was still in flight). */
  acquire: (root: string) => DaemonManager;
  /** Release one reference on `root` (a window unbinding/closing). At zero
   *  references the daemon is stopped and its manager discarded. Resolves once
   *  the stop completes (or immediately if nothing was registered / refs remain). */
  release: (root: string) => Promise<void>;
  /** The manager currently registered for `root`, if any — a read that does not
   *  itself take a reference (routing a push/status event, an IPC call that only
   *  needs the daemon its OWN window already holds a reference on). */
  get: (root: string) => DaemonManager | undefined;
  /** Tear down every registered daemon immediately (app quit) — bypasses
   *  refcounting entirely. */
  disposeAll: () => void;
}

interface Entry {
  manager: DaemonManager;
  refs: number;
}

export function createDaemonRegistry(deps: DaemonRegistryDeps): DaemonRegistry {
  const entries = new Map<string, Entry>();

  const acquire = (root: string): DaemonManager => {
    const key = deps.canonicalize(root);
    const existing = entries.get(key);
    if (existing !== undefined) {
      existing.refs += 1;
      // Revived after refs had reached zero (its stop may still be in flight) — start()
      // queues safely behind DaemonManager's own in-flight stop, same as restart().
      if (existing.refs === 1) void existing.manager.start();
      return existing.manager;
    }
    const manager = deps.createManager(root);
    entries.set(key, { manager, refs: 1 });
    void manager.start();
    return manager;
  };

  const release = (root: string): Promise<void> => {
    const key = deps.canonicalize(root);
    const existing = entries.get(key);
    if (existing === undefined) return Promise.resolve();
    existing.refs -= 1;
    if (existing.refs > 0) return Promise.resolve();
    // Kept in the map (refs = 0) through the stop, not deleted yet — see the class
    // doc comment: a concurrent acquire must be able to revive THIS entry.
    return existing.manager.stop().then(() => {
      if (existing.refs <= 0) entries.delete(key);
    });
  };

  return {
    acquire,
    release,
    get: (root) => entries.get(deps.canonicalize(root))?.manager,
    disposeAll: () => {
      for (const { manager } of entries.values()) manager.dispose();
      entries.clear();
    },
  };
}
