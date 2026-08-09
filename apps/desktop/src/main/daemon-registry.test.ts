import { describe, expect, it, vi } from 'vitest';
import { createDaemonRegistry, type DaemonRegistryDeps } from './daemon-registry.js';
import type { DaemonManager } from './daemon-manager.js';

/** A stub DaemonManager whose `stop()` is released by the test (never resolves on
 *  its own), so a release-then-acquire race can be driven deterministically. */
function fakeManager(): DaemonManager & {
  startCalls: number;
  stopCalls: number;
  disposeCalls: number;
  releaseStop: () => void;
} {
  let releaseStop!: () => void;
  const stopGate = new Promise<void>((r) => (releaseStop = r));
  const m = {
    startCalls: 0,
    stopCalls: 0,
    disposeCalls: 0,
    releaseStop,
    status: () => 'stopped' as const,
    report: () => ({ status: 'stopped' as const }),
    client: () => Promise.reject(new Error('not running')),
    start: async () => {
      m.startCalls += 1;
    },
    adopt: async () => undefined,
    stop: async () => {
      m.stopCalls += 1;
      await stopGate;
    },
    restart: async () => undefined,
    onStatus: () => () => undefined,
    dispose: () => {
      m.disposeCalls += 1;
    },
  };
  return m;
}

const canon = (root: string): string => root.toLowerCase();

function deps(createManager: (root: string) => DaemonManager): DaemonRegistryDeps {
  return { createManager, canonicalize: canon };
}

describe('createDaemonRegistry', () => {
  it('acquire creates and starts a manager for a fresh root', () => {
    const m = fakeManager();
    const create = vi.fn(() => m);
    const reg = createDaemonRegistry(deps(create));

    const got = reg.acquire('C:\\repos\\alpha');

    expect(got).toBe(m);
    expect(create).toHaveBeenCalledOnce();
    expect(m.startCalls).toBe(1);
  });

  it('a second acquire of the SAME root (by canonical identity) reuses the manager — never a second daemon', () => {
    const m = fakeManager();
    const create = vi.fn(() => m);
    const reg = createDaemonRegistry(deps(create));

    reg.acquire('C:\\Repos\\Alpha');
    const got = reg.acquire('c:\\repos\\alpha');

    expect(got).toBe(m);
    expect(create).toHaveBeenCalledOnce(); // one manager for one project, however many refs
  });

  it('release below the last reference is a no-op — the daemon keeps running', async () => {
    const m = fakeManager();
    const reg = createDaemonRegistry(deps(() => m));
    reg.acquire('C:\\repos\\alpha');
    reg.acquire('C:\\repos\\alpha'); // refs = 2

    await reg.release('C:\\repos\\alpha'); // refs = 1

    expect(m.stopCalls).toBe(0);
  });

  it('release at the last reference stops the manager — kill on refcount zero', async () => {
    const m = fakeManager();
    const reg = createDaemonRegistry(deps(() => m));
    reg.acquire('C:\\repos\\alpha');

    m.releaseStop(); // let stop() resolve immediately for this test
    await reg.release('C:\\repos\\alpha');

    expect(m.stopCalls).toBe(1);
  });

  it('a fresh acquire after full teardown creates a NEW manager', async () => {
    const m1 = fakeManager();
    const m2 = fakeManager();
    const create = vi.fn().mockReturnValueOnce(m1).mockReturnValueOnce(m2);
    const reg = createDaemonRegistry(deps(create));

    reg.acquire('C:\\repos\\alpha');
    m1.releaseStop();
    await reg.release('C:\\repos\\alpha');

    const got = reg.acquire('C:\\repos\\alpha');
    expect(got).toBe(m2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('release() releasing a root with no entry is a harmless no-op', async () => {
    const reg = createDaemonRegistry(deps(() => fakeManager()));
    await expect(reg.release('C:\\repos\\never-opened')).resolves.toBeUndefined();
  });

  it('an acquire that arrives WHILE a stop is still in flight revives the SAME manager, not a second one', async () => {
    // The correctness hazard F11 calls out explicitly: two daemon processes writing the
    // same project's state concurrently. A release-then-immediate-reacquire on the same
    // root (e.g. a fast swap away and back) must never spawn a second manager/process
    // while the first is still tearing down.
    const m = fakeManager();
    const create = vi.fn(() => m);
    const reg = createDaemonRegistry(deps(create));

    reg.acquire('C:\\repos\\alpha');
    const releasing = reg.release('C:\\repos\\alpha'); // refs -> 0, stop() in flight (gated)
    const revived = reg.acquire('C:\\repos\\alpha'); // arrives before stop() resolves

    expect(revived).toBe(m); // same manager instance — never a second createManager call
    expect(create).toHaveBeenCalledOnce();

    m.releaseStop(); // let the in-flight stop() finish
    await releasing;
    expect(m.startCalls).toBe(2); // the revive re-started the same manager after its stop
  });

  it('disposeAll tears every registered manager down immediately, bypassing refcounting', () => {
    const a = fakeManager();
    const b = fakeManager();
    const reg = createDaemonRegistry(
      deps((root) => (root.includes('alpha') ? a : b)),
    );
    reg.acquire('C:\\repos\\alpha');
    reg.acquire('C:\\repos\\beta');

    reg.disposeAll();

    expect(a.disposeCalls).toBe(1);
    expect(b.disposeCalls).toBe(1);
  });
});
