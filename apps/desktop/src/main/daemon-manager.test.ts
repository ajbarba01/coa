import { describe, expect, it, vi } from 'vitest';
import type { DaemonClient } from './daemon.js';
import {
  createDaemonManager,
  type DaemonManagerDeps,
  type DaemonProcess,
} from './daemon-manager.js';

/** A fake client that records requests and exposes its close handler for drop simulation. */
function fakeClient(): DaemonClient & { requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    request: async (method) => {
      requests.push(method);
      return { result: { ok: true } };
    },
    close: async () => undefined,
  };
}

function deps(over: Partial<DaemonManagerDeps> = {}): {
  deps: DaemonManagerDeps;
  spawn: ReturnType<typeof vi.fn>;
  proc: DaemonProcess & { kill: ReturnType<typeof vi.fn> };
  closers: Array<() => void>;
} {
  const proc = { kill: vi.fn() };
  const spawn = vi.fn(() => proc);
  const closers: Array<() => void> = [];
  return {
    proc,
    spawn,
    closers,
    deps: {
      probe: async () => false,
      connect: async (_path, onClose) => {
        closers.push(onClose);
        return fakeClient();
      },
      spawn,
      path: '\\\\.\\pipe\\test',
      retry: { attempts: 3, delayMs: 0 },
      delay: async () => undefined,
      ...over,
    },
  };
}

describe('createDaemonManager', () => {
  it('starts stopped and transitions stopped → starting → running, spawning when none is live', async () => {
    const { deps: d, spawn } = deps();
    const mgr = createDaemonManager(d);
    const seen: string[] = [];
    mgr.onStatus((s) => seen.push(s));

    expect(mgr.status()).toBe('stopped');
    await mgr.start();

    expect(spawn).toHaveBeenCalledOnce();
    expect(mgr.status()).toBe('running');
    expect(seen).toEqual(['stopped', 'starting', 'running']);
  });

  it('attaches to an already-live daemon without spawning', async () => {
    const { deps: d, spawn } = deps({ probe: async () => true });
    const mgr = createDaemonManager(d);
    await mgr.start();
    expect(spawn).not.toHaveBeenCalled();
    expect(mgr.status()).toBe('running');
  });

  it('retries the connect until the freshly spawned daemon binds', async () => {
    let attempts = 0;
    const { deps: d } = deps({
      connect: async (_path, onClose) => {
        attempts += 1;
        if (attempts < 3) throw new Error('not up yet');
        return { request: async () => ({ result: {} }), close: async () => onClose && undefined };
      },
    });
    const mgr = createDaemonManager(d);
    await mgr.start();
    expect(attempts).toBe(3);
    expect(mgr.status()).toBe('running');
  });

  it('goes to error when the connect never succeeds', async () => {
    const { deps: d } = deps({
      connect: async () => {
        throw new Error('nope');
      },
    });
    const mgr = createDaemonManager(d);
    await mgr.start();
    expect(mgr.status()).toBe('error');
    await expect(mgr.client()).rejects.toThrow(/not running/);
  });

  it('stop sends the shutdown verb, closes the client, kills the child, and reports stopped', async () => {
    const client = fakeClient();
    const { deps: d, proc } = deps({ connect: async () => client });
    const mgr = createDaemonManager(d);
    await mgr.start();

    await mgr.stop();
    expect(client.requests).toContain('shutdown');
    expect(proc.kill).toHaveBeenCalledOnce();
    expect(mgr.status()).toBe('stopped');
  });

  it('stop waits for the endpoint to release before it reports stopped', async () => {
    // The pipe outlives the process for a beat: probe stays true for two polls, then frees.
    // A start that raced this window would attach to the dying daemon instead of spawning.
    const answers = [false, true, true, false]; // start's probe, then the drain's
    const probe = vi.fn(async () => answers.shift() ?? false);
    const { deps: d, spawn } = deps({ probe, drain: { attempts: 5, delayMs: 0 } });
    const mgr = createDaemonManager(d);
    await mgr.start();
    expect(spawn).toHaveBeenCalledOnce();

    await mgr.stop();
    expect(mgr.status()).toBe('stopped');
    expect(answers).toHaveLength(0); // it drained the endpoint rather than declaring victory
  });

  it('gives up waiting on an endpoint that never releases, and still reports stopped', async () => {
    const { deps: d } = deps({ probe: async () => true, drain: { attempts: 3, delayMs: 0 } });
    const mgr = createDaemonManager(d);
    await mgr.start();
    await mgr.stop();
    expect(mgr.status()).toBe('stopped');
  });

  it('restart tears down then brings up a fresh daemon', async () => {
    const { deps: d, spawn } = deps();
    const mgr = createDaemonManager(d);
    await mgr.start();
    await mgr.restart();
    expect(spawn).toHaveBeenCalledTimes(2); // once per start (stop reaps the first)
    expect(mgr.status()).toBe('running');
  });

  it('flips to error on an unexpected connection drop, but not on a deliberate stop', async () => {
    const { deps: d, closers } = deps();
    const mgr = createDaemonManager(d);
    await mgr.start();

    // A crash: the socket closes without us asking.
    closers[0]!();
    expect(mgr.status()).toBe('error');

    // A deliberate stop must NOT re-trigger error via its own close.
    await mgr.start();
    await mgr.stop();
    expect(mgr.status()).toBe('stopped');
  });

  it('ignores the close a deliberate stop leaves behind, however late it lands', async () => {
    const { deps: d, closers } = deps();
    const mgr = createDaemonManager(d);
    await mgr.start();
    await mgr.stop();

    // The socket's close event is delivered by the OS, not by us: it routinely arrives
    // after `stop` has already resolved. That is the teardown's own wake — not a crash.
    closers[0]!();
    expect(mgr.status()).toBe('stopped');
  });

  it('does not let a restart’s discarded connection report an error over the new one', async () => {
    const { deps: d, closers } = deps();
    const mgr = createDaemonManager(d);
    await mgr.start();
    await mgr.restart();
    expect(mgr.status()).toBe('running');

    closers[0]!(); // the OLD connection finally closes — it speaks for nobody now
    expect(mgr.status()).toBe('running');

    closers[1]!(); // the LIVE one dropping is still a crash
    expect(mgr.status()).toBe('error');
  });

  it('client() rejects when stopped and never resurrects a deliberately stopped daemon', async () => {
    const { deps: d, spawn } = deps();
    const mgr = createDaemonManager(d);
    await expect(mgr.client()).rejects.toThrow(/not running/);
    expect(spawn).not.toHaveBeenCalled(); // a read must not start the daemon

    await mgr.start();
    await mgr.stop();
    await expect(mgr.client()).rejects.toThrow(/not running/);
    expect(spawn).toHaveBeenCalledOnce(); // still just the one explicit start
  });

  it('client() waits out an in-progress start (the launch race) then resolves', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { deps: d } = deps({
      connect: async () => {
        await gate;
        return { request: async () => ({ result: {} }), close: async () => undefined };
      },
    });
    const mgr = createDaemonManager(d);
    const starting = mgr.start();
    const clientP = mgr.client(); // called mid-start
    release();
    await starting;
    await expect(clientP).resolves.toBeDefined();
    expect(mgr.status()).toBe('running');
  });
});
