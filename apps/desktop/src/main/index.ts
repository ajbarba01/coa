import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, session } from 'electron';
import { connectClient, defaultDaemonPath, probeDaemon } from '@coa/core/rpc';
import { contentSecurityPolicy } from './csp.js';
import {
  overlayForTheme,
  titleBarConfig,
  windowBackground,
  type ResolvedTheme,
} from './titlebar.js';
import { type DaemonClient } from './daemon.js';
import { createDaemonManager, type DaemonProcess } from './daemon-manager.js';
import { readJson, writeJson } from './persistence.js';
import {
  DAEMON_CONTROL,
  DAEMON_STATUS_CHANNEL,
  METHODS,
  PUSH_CHANNEL,
  channel,
  type DaemonControlName,
  type MethodName,
} from '../shared/methods.js';
import { parseSettings, type ConsoleSettings } from '../shared/settings.js';

/** The single console window, tracked so a theme change can recolor its native chrome. */
let mainWindow: BrowserWindow | undefined;

/** The live theme preference, tracked so an OS light/dark flip can recolor the native
 *  chrome while the preference is `'system'` (mirrors the renderer's matchMedia follow). */
let themePref: ConsoleSettings['theme'] = 'dark';

/** Resolve the preference to a concrete theme; `'system'` follows the OS (`nativeTheme`
 *  defaults its source to `'system'`, so `shouldUseDarkColors` reflects the OS). */
function resolveChromeTheme(theme: ConsoleSettings['theme']): ResolvedTheme {
  if (theme !== 'system') return theme;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function createWindow(): void {
  themePref = parseSettings(readJson(settingsFile())).theme;
  const theme = resolveChromeTheme(themePref);
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 860,
    minHeight: 540,
    show: false,
    backgroundColor: windowBackground(theme),
    ...titleBarConfig(process.platform, theme),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  win.once('ready-to-show', () => {
    win.show();
    if (process.env['ELECTRON_RENDERER_URL']) win.webContents.openDevTools();
  });
  // Fallback: if `ready-to-show` never fires (a dev-server race that would otherwise
  // leave a hidden window and a process that "acts like it's running"), show anyway.
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 4000);

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const load = (): void => {
    void (rendererUrl
      ? win.loadURL(rendererUrl)
      : win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
    ).catch(() => undefined);
  };
  // In dev, the Vite server may not be accepting connections the instant Electron
  // launches; a failed load leaves a blank hidden window, so retry once shortly.
  win.webContents.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
    if (isMainFrame && rendererUrl && !win.isDestroyed()) setTimeout(load, 500);
  });
  load();
}

/**
 * Adapt the real `@coa/core` `RpcClient` (whose `request` resolves the full
 * JSON-RPC envelope — `{ jsonrpc, id, result }` or `{ jsonrpc, id, error }` —
 * and which also carries a `notify` method) to the local, minimal
 * `DaemonClient` contract that the daemon manager + IPC proxy depend on.
 */
function toRpcParams(params: unknown): Array<unknown> | Record<string, unknown> | undefined {
  if (params === undefined) return undefined;
  if (Array.isArray(params)) return params;
  if (typeof params === 'object' && params !== null) return params as Record<string, unknown>;
  throw new TypeError('daemon request params must be structured (array or object)');
}

function toDaemonClient(rpc: Awaited<ReturnType<typeof connectClient>>): DaemonClient {
  return {
    request: async (method, params) => {
      const res = await rpc.request(method, toRpcParams(params));
      return 'error' in res ? { error: res.error } : { result: res.result };
    },
    close: () => rpc.close(),
  };
}

/** A daemon RPC error surfaced over IPC, carrying the structured JSON-RPC `code`. */
class DaemonError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = 'DaemonError';
  }
}

/** Walk up from `start` for the pnpm workspace root (where the project's `.coa` lives). */
function findRepoRoot(start: string): string {
  for (let dir = start; ; ) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start; // hit the filesystem root — fall back to `start`
    dir = parent;
  }
}

/**
 * How to launch the daemon, resolved deterministically rather than trusting the
 * Electron process to have inherited `coa` on PATH (it often hasn't). Preference:
 * an explicit `COA_CLI` override → the built `apps/cli/dist/bin.js` run with the
 * same Node that launched the app (`npm_node_execpath`, so the native addons'
 * ABI matches) → a bare `coa serve` on PATH as a last resort. The daemon runs with
 * cwd = the repo root so it reads/writes the project's real `.coa` store.
 */
function daemonSpawn(): DaemonProcess {
  const root = findRepoRoot(process.cwd());
  const binPath = join(root, 'apps', 'cli', 'dist', 'bin.js');
  const node = process.env['npm_node_execpath'] ?? 'node';
  const override = process.env['COA_CLI'];

  const child = override
    ? spawn(`${override} serve`, { cwd: root, stdio: 'ignore', shell: true, windowsHide: true })
    : existsSync(binPath)
      ? // shell:false + args array → the space in the path is safe and the child is
        // directly killable (no shell wrapper to orphan the real process on stop/quit).
        spawn(node, [binPath, 'serve'], { cwd: root, stdio: 'ignore', windowsHide: true })
      : spawn('coa serve', { cwd: root, stdio: 'ignore', shell: true, windowsHide: true });
  return { kill: () => child.kill() };
}

/**
 * The daemon lifecycle owner behind the title-bar Start/Stop/Restart control.
 * `connect` adapts the ABI-safe pipe client and forwards the daemon's push stream
 * to the renderer; `spawn` launches the daemon as a tracked child (reaped on stop
 * + quit); status changes are pushed to the window on {@link DAEMON_STATUS_CHANNEL}.
 */
const daemon = createDaemonManager({
  path: defaultDaemonPath(),
  probe: probeDaemon,
  // Give a cold daemon time to load its native addons + bind the pipe (~a few seconds).
  retry: { attempts: 50, delayMs: 200 },
  connect: async (path, onClose): Promise<DaemonClient> =>
    toDaemonClient(
      await connectClient(
        path,
        (note) => {
          if (note.method === 'push') mainWindow?.webContents.send(PUSH_CHANNEL, note.params);
        },
        onClose,
      ),
    ),
  spawn: daemonSpawn,
});

/** The per-user layout file. Per-workspace keying lands when the app gains a
 *  workspace-open flow; today the daemon is a single fixed pipe. */
function layoutFile(): string {
  return join(app.getPath('userData'), 'coa', 'layout.json');
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'coa', 'settings.json');
}

/** Forward a read to the daemon, surfacing a JSON-RPC error as a coded IPC error. */
async function proxyDaemon(method: string, params?: unknown): Promise<unknown> {
  const res = await (await daemon.client()).request(method, params);
  if ('error' in res && res.error) throw new DaemonError(res.error.message, res.error.code);
  return res.result;
}

async function runMethod(name: MethodName, params: unknown): Promise<unknown> {
  switch (name) {
    case 'capState':
      return proxyDaemon('capState');
    case 'flagsForUser':
      return proxyDaemon('flagsForUser');
    case 'listTimeline':
      return proxyDaemon('listTimeline');
    case 'listAccounts':
      return proxyDaemon('listAccounts');
    case 'currentAccount':
      return proxyDaemon('currentAccount');
    case 'useAccount':
      return proxyDaemon('useAccount', params);
    case 'startSession':
      return proxyDaemon('createSession', params);
    case 'newSession':
      return proxyDaemon('newSession', params);
    case 'listSessions':
      return proxyDaemon('listSessions');
    case 'reloadConversation':
      return proxyDaemon('reloadConversation', params);
    case 'renameSession':
      return proxyDaemon('renameSession', params);
    case 'deleteSession':
      return proxyDaemon('deleteSession', params);
    case 'listModels':
      return proxyDaemon('listModels');
    case 'listRoles':
      return proxyDaemon('listRoles');
    case 'listPackages':
      return proxyDaemon('listPackages');
    case 'getLayout':
      return readJson(layoutFile());
    case 'saveLayout':
      writeJson(layoutFile(), params);
      return undefined;
    case 'getSettings':
      return parseSettings(readJson(settingsFile()));
    case 'saveSettings': {
      // Recolor the native chrome *before* the disk write so the OS-drawn caption
      // controls track the renderer's (instant) CSS as closely as the IPC hop allows.
      themePref = parseSettings(params).theme;
      applyChromeTheme(resolveChromeTheme(themePref));
      writeJson(settingsFile(), params);
      return undefined;
    }
  }
}

/** Re-theme the native window chrome (background + Windows caption overlay) so the
 *  OS-drawn controls track light/dark. Takes a resolved theme. macOS traffic lights
 *  re-theme via the OS. */
function applyChromeTheme(theme: ResolvedTheme): void {
  if (!mainWindow) return;
  mainWindow.setBackgroundColor(windowBackground(theme));
  if (process.platform === 'win32') mainWindow.setTitleBarOverlay(overlayForTheme(theme));
}

for (const name of Object.keys(METHODS) as MethodName[]) {
  ipcMain.handle(channel(name), async (_event, rawParams: unknown) => {
    const spec = METHODS[name];
    const params = spec.params ? spec.params.parse(rawParams) : undefined;
    const result = await runMethod(name, params);
    return spec.result.parse(result);
  });
}

// The title-bar daemon control (Start/Stop/Restart) + a status read. These are
// main-local transport actions, not daemon RPC reads, so they sit on their own channels.
const daemonActions: Record<DaemonControlName, () => unknown | Promise<unknown>> = {
  status: () => daemon.status(),
  start: () => daemon.start(),
  stop: () => daemon.stop(),
  restart: () => daemon.restart(),
};
for (const [name, action] of Object.entries(daemonActions) as [DaemonControlName, () => unknown][]) {
  ipcMain.handle(DAEMON_CONTROL[name], async () => (await action()) ?? undefined);
}

// A single instance owns the daemon + the fixed pipe; a second launch (e.g. a stale
// prior `electron-vite dev`) would otherwise shadow it with a hidden second window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  bootstrap();
}

/** Push the current daemon status to the renderer (used on status change + on window load). */
function pushDaemonStatus(): void {
  mainWindow?.webContents.send(DAEMON_STATUS_CHANNEL, daemon.status());
}

function bootstrap(): void {
  app.whenReady().then(() => {
  // The custom AppShell title bar is the only chrome — no File/Edit/View menu (§22.2).
  Menu.setApplicationMenu(null);
  // Dev is served from `ELECTRON_RENDERER_URL` by Vite (HMR + Fast Refresh);
  // production loads from file. The CSP relaxes only in dev (see `csp.ts`).
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL']);
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy(isDev)],
      },
    });
  });
  // While following the OS, a system light/dark flip recolors the native chrome to
  // match the renderer (which tracks the same flip via matchMedia).
  nativeTheme.on('updated', () => {
    if (themePref === 'system') applyChromeTheme(resolveChromeTheme('system'));
  });
    createWindow();
    // Mirror daemon status to the renderer; re-push on each (re)load so a reload or a
    // status change that happened before the window was ready still lands.
    daemon.onStatus(() => pushDaemonStatus());
    mainWindow?.webContents.on('did-finish-load', () => pushDaemonStatus());
    // Auto-start the daemon on launch (the pill shows `running` once connected).
    void daemon.start();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Reap the daemon connection + tracked child so it doesn't outlive the app.
  app.on('before-quit', () => daemon.dispose());
}
