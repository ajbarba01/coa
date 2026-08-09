import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// `@coa/core` (root), not `@coa/core/rpc` — the workspace vitest alias for
// `@coa/core` prefix-matches subpaths too, so the deep specifier fails to
// resolve under vitest; the root barrel re-exports `defaultDaemonPath` anyway.
import { defaultDaemonPath } from '@coa/core';
import type * as DaemonManagerModule from './daemon-manager.js';
import type { DaemonManager } from './daemon-manager.js';

/**
 * F11 regression coverage for `index.ts`'s Electron COMPOSITION — the layer the
 * adversarial review found had zero test coverage, which is exactly why a stale
 * closure in `createProjectWindow`'s `closed` handler (it released the ORIGINAL
 * project a window was created for, not whatever it was later rebound to via
 * "Open Folder…") went undetected: `window-registry.test.ts`/`daemon-registry.test.ts`
 * cover each registry in isolation, but nothing exercised the WIRING between them.
 *
 * `electron` and `./daemon-manager.js` are mocked at the module boundary — real
 * Electron isn't available headless here, and a real `DaemonManager` would probe/
 * spawn/retry-connect against a pipe nothing is listening on. Everything else
 * (`window-registry.ts`, `daemon-registry.ts`, `recent-projects.ts`, `persistence.ts`,
 * `@coa/core/rpc`'s `defaultDaemonPath`/`canonicalProjectRoot`) runs FOR REAL, so
 * this exercises the actual wiring `index.ts` does between them.
 */

// ---- electron mock -------------------------------------------------------

const electronMock = vi.hoisted(() => {
  class Emitter {
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    on(event: string, cb: (...args: unknown[]) => void): this {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }
    once(event: string, cb: (...args: unknown[]) => void): this {
      const wrapped = (...args: unknown[]): void => {
        this.off(event, wrapped);
        cb(...args);
      };
      return this.on(event, wrapped);
    }
    off(event: string, cb: (...args: unknown[]) => void): void {
      const list = this.handlers.get(event);
      if (list === undefined) return;
      this.handlers.set(
        event,
        list.filter((h) => h !== cb),
      );
    }
    emit(event: string, ...args: unknown[]): void {
      for (const cb of [...(this.handlers.get(event) ?? [])]) cb(...args);
    }
  }

  class FakeWebContents extends Emitter {
    zoomLevel = 0;
    send = vi.fn();
    setZoomLevel(level: number): void {
      this.zoomLevel = level;
    }
    getZoomLevel(): number {
      return this.zoomLevel;
    }
    toggleDevTools(): void {}
  }

  const byWebContents = new Map<FakeWebContents, FakeBrowserWindow>();
  let nextId = 1;

  const instances: FakeBrowserWindow[] = [];

  class FakeBrowserWindow extends Emitter {
    readonly id: number;
    readonly webContents = new FakeWebContents();
    private destroyed = false;
    private visible = false;
    private minimized = false;
    private maximized = false;

    constructor(_opts: unknown) {
      super();
      this.id = nextId++;
      byWebContents.set(this.webContents, this);
      instances.push(this);
    }
    static fromWebContents(wc: unknown): FakeBrowserWindow | undefined {
      return byWebContents.get(wc as FakeWebContents);
    }
    show(): void {
      this.visible = true;
    }
    isVisible(): boolean {
      return this.visible;
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    isMinimized(): boolean {
      return this.minimized;
    }
    restore(): void {
      this.minimized = false;
    }
    focus(): void {}
    minimize(): void {
      this.minimized = true;
    }
    maximize(): void {
      this.maximized = true;
      this.emit('maximize');
    }
    unmaximize(): void {
      this.maximized = false;
      this.emit('unmaximize');
    }
    isMaximized(): boolean {
      return this.maximized;
    }
    close(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    }
    loadFile(): Promise<void> {
      return Promise.resolve();
    }
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
  }

  const ipcHandlers = new Map<
    string,
    (event: unknown, params?: unknown) => unknown | Promise<unknown>
  >();
  const appEmitter = new Emitter();
  let userDataDir = '';

  const app = {
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    getPath: vi.fn((name: string) => (name === 'userData' ? userDataDir : '')),
    whenReady: vi.fn(() => Promise.resolve()),
    on: (event: string, cb: (...args: unknown[]) => void) => appEmitter.on(event, cb),
    emit: (event: string, ...args: unknown[]) => appEmitter.emit(event, ...args),
  };

  return {
    Emitter,
    FakeBrowserWindow,
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, params?: unknown) => unknown) => {
        ipcHandlers.set(channel, fn);
      },
    },
    dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
    Menu: { setApplicationMenu: vi.fn() },
    session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
    shell: { showItemInFolder: vi.fn(), openExternal: vi.fn(async () => undefined) },
    app,
    instances,
    ipcHandlers,
    setUserDataDir: (dir: string) => {
      userDataDir = dir;
    },
    reset: () => {
      instances.length = 0;
      ipcHandlers.clear();
      byWebContents.clear();
      app.requestSingleInstanceLock.mockClear();
      app.requestSingleInstanceLock.mockImplementation(() => true);
      app.quit.mockClear();
      app.getPath.mockClear();
      app.whenReady.mockClear();
    },
  };
});

vi.mock('electron', () => ({
  app: electronMock.app,
  BrowserWindow: electronMock.FakeBrowserWindow,
  dialog: electronMock.dialog,
  ipcMain: electronMock.ipcMain,
  Menu: electronMock.Menu,
  session: electronMock.session,
  shell: electronMock.shell,
}));

// ---- daemon-manager mock --------------------------------------------------
// Real DaemonManager probes/spawns/retry-connects against a live pipe; nothing is
// listening in a test, so the manager itself is replaced with a lightweight fake
// (the exact pattern `daemon-registry.test.ts` uses) while everything ELSE
// `index.ts` composes (window-registry, daemon-registry, recent-projects,
// persistence) runs for real.

interface CreatedManager {
  path: string;
  manager: DaemonManager;
}

const daemonManagerMock = vi.hoisted(() => {
  const created: CreatedManager[] = [];
  const createDaemonManager = vi.fn((deps: { path: string }) => {
    let status: 'stopped' | 'running' = 'stopped';
    const listeners = new Set<(report: { status: string }) => void>();
    const notify = (): void => {
      for (const l of listeners) l({ status });
    };
    const manager = {
      status: () => status,
      report: () => ({ status }),
      client: vi.fn(async () => {
        throw new Error('no client in test');
      }),
      start: vi.fn(async () => {
        status = 'running';
        notify();
      }),
      adopt: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        status = 'stopped';
        notify();
      }),
      restart: vi.fn(async () => undefined),
      onStatus: vi.fn((listener: (report: { status: string }) => void) => {
        listeners.add(listener);
        listener({ status });
        return () => listeners.delete(listener);
      }),
      dispose: vi.fn(),
    };
    created.push({ path: deps.path, manager: manager as unknown as DaemonManager });
    return manager;
  });
  return {
    created,
    createDaemonManager,
    reset: () => {
      created.length = 0;
      createDaemonManager.mockClear();
    },
  };
});

vi.mock('./daemon-manager.js', async (importOriginal) => {
  const actual = await importOriginal<typeof DaemonManagerModule>();
  return { ...actual, createDaemonManager: daemonManagerMock.createDaemonManager };
});

// ---- test helpers ----------------------------------------------------------

/** Flush both the microtask queue and one macrotask tick — covers the
 *  `app.whenReady().then(...)` chain bootstrap schedules at import time. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

/** The mocked manager created for `root`, matched by its deterministic endpoint
 *  path (`defaultDaemonPath`) rather than creation order — robust to whatever
 *  extra windows/managers bootstrap's launch-restore created for OTHER roots. */
function managerForRoot(root: string): DaemonManager & {
  start: { mock: { calls: unknown[] } };
  stop: { mock: { calls: unknown[] } };
} {
  const path = defaultDaemonPath(root);
  const entry = daemonManagerMock.created.find((e) => e.path === path);
  if (entry === undefined) throw new Error(`no daemon manager was created for ${root}`);
  return entry.manager as unknown as DaemonManager & {
    start: { mock: { calls: unknown[] } };
    stop: { mock: { calls: unknown[] } };
  };
}

type Handler = (event: unknown, params?: unknown) => Promise<unknown>;

function handler(name: string): Handler {
  const fn = electronMock.ipcHandlers.get(`coa:${name}`);
  if (fn === undefined) throw new Error(`no ipcMain handler registered for coa:${name}`);
  return fn as Handler;
}

/** Import `index.ts` fresh — `vi.resetModules()` clears its module-level
 *  `windowRegistry`/`daemonRegistry` singletons so each test starts clean. */
async function importIndex(): Promise<void> {
  vi.resetModules();
  electronMock.reset();
  daemonManagerMock.reset();
  await import('./index.js');
  await flush();
}

describe('index.ts composition (F11 window/daemon wiring)', () => {
  let tmpRoot: string;
  let dirA: string;
  let dirB: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'coa-index-test-'));
    dirA = mkdtempSync(join(tmpRoot, 'proj-a-'));
    dirB = mkdtempSync(join(tmpRoot, 'proj-b-'));
    electronMock.setUserDataDir(join(tmpRoot, 'userData'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('closing a window that was swapped to a different project releases the CURRENT project, not the one it was created for', async () => {
    await importIndex();
    const openProject = handler('openProject');

    // Open project A in a fresh window (a stray, unregistered sender — `target:
    // 'new'` never depends on the calling window anyway).
    await openProject({ sender: {} }, { root: dirA, target: 'new' });
    const win = electronMock.instances.at(-1);
    if (win === undefined) throw new Error('no window was created');

    // Swap THAT window (the picker's default "Open Folder…", target: 'current')
    // to project B.
    await openProject({ sender: win.webContents }, { root: dirB, target: 'current' });

    const managerA = managerForRoot(dirA);
    const managerB = managerForRoot(dirB);
    expect(managerA.stop).toHaveBeenCalledTimes(1); // released by the swap itself
    expect(managerB.stop).not.toHaveBeenCalled();

    // Close the window — it is now bound to B, not the A it was created for.
    win.close();

    expect(managerB.stop).toHaveBeenCalledTimes(1); // B's daemon must be released...
    expect(managerA.stop).toHaveBeenCalledTimes(1); // ...and A must NOT be released again
  });

  it('two windows on two different projects are independent — closing one never touches the other project’s daemon', async () => {
    await importIndex();
    const openProject = handler('openProject');

    await openProject({ sender: {} }, { root: dirA, target: 'new' });
    const winA = electronMock.instances.at(-1);
    await openProject({ sender: {} }, { root: dirB, target: 'new' });
    const winB = electronMock.instances.at(-1);
    if (winA === undefined || winB === undefined) throw new Error('windows were not created');
    expect(winA).not.toBe(winB);

    winA.close();

    expect(managerForRoot(dirA).stop).toHaveBeenCalledTimes(1);
    expect(managerForRoot(dirB).stop).not.toHaveBeenCalled();
  });

  it('opening the same project twice focuses the existing window instead of spawning a second daemon', async () => {
    await importIndex();
    const openProject = handler('openProject');

    await openProject({ sender: {} }, { root: dirA, target: 'new' });
    const win = electronMock.instances.at(-1);
    if (win === undefined) throw new Error('no window was created');

    const res = await openProject({ sender: {} }, { root: dirA, target: 'new' });

    expect(res).toMatchObject({ opened: 'focused-existing' });
    // Only ONE manager was ever created for A — never a second daemon over the
    // same project, regardless of what `target` a redundant open asked for.
    expect(
      daemonManagerMock.created.filter((e) => e.path === defaultDaemonPath(dirA)),
    ).toHaveLength(1);

    // Only one window ever governs A; closing it releases A's one reference.
    win.close();
    expect(managerForRoot(dirA).stop).toHaveBeenCalledTimes(1);
  });
});
