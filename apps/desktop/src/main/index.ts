import { basename, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import { connectClient, defaultDaemonPath, probeDaemon } from '@coa/core/rpc';
import { contentSecurityPolicy } from './csp.js';
import { titleBarConfig, WINDOW_BACKGROUND } from './titlebar.js';
import { appliedLevel, keyToZoomAction, nextLevel, BASE_ZOOM_LEVEL } from './zoom.js';
import { type DaemonClient } from './daemon.js';
import { createDaemonManager, type DaemonProcess } from './daemon-manager.js';
import { readJson, writeJson } from './persistence.js';
import { codeInvocation, confineToWorktree, safeForWindowsShell } from './openPath.js';
import { validateExternalUrl } from './openExternal.js';
import {
  DAEMON_CONTROL,
  DAEMON_STATUS_CHANNEL,
  METHODS,
  PUSH_CHANNEL,
  WINDOW_CONTROL,
  WINDOW_STATE_CHANNEL,
  channel,
  type DaemonControlName,
  type MethodName,
  type WindowControlName,
} from '../shared/methods.js';
import { parseSettings } from '../shared/settings.js';

/** The single console window — the target for window-control IPC, status pushes,
 *  and second-instance focus. */
let mainWindow: BrowserWindow | undefined;

/**
 * The project root the reveal IPC resolves a tool card's (worktree-relative) path against —
 * the same directory the daemon is launched in (its `cwd`, which is the tools' `worktreeRoot`),
 * so a worktree-relative path from a tool result resolves to the real file. Detected from the
 * workspace marker (as an editor detects a workspace), memoized, and independent of the daemon
 * push stream — so it is correct on first launch AND after a restart that reconnects to an
 * already-running daemon (the stream only re-emits `worktree` on a new turn, and that value is
 * a logical worktree id, not a filesystem path). The renderer never supplies a root (it can't
 * be trusted to); main derives it so `openPath` confinement is authoritative.
 */
let cachedProjectRoot: string | undefined;
function projectRoot(): string {
  cachedProjectRoot ??= findRepoRoot(process.cwd());
  return cachedProjectRoot;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 860,
    minHeight: 540,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    ...titleBarConfig(process.platform),
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

  // Ctrl+/- window zoom (VSCode-style): intercept the accelerator keys before they
  // reach the page, step the persisted level, and scale the whole DOM. Zoom is per-
  // `webContents` and resets on reload, so it is (re)applied on every load below.
  win.webContents.on('before-input-event', (event, input) => {
    const action = keyToZoomAction(input);
    if (!action) return;
    event.preventDefault();
    // The applied Electron level carries the 120% base on top of the user's offset;
    // derive the offset back out before stepping it, then re-apply + persist the offset.
    const userLevel = nextLevel(win.webContents.getZoomLevel() - BASE_ZOOM_LEVEL, action);
    win.webContents.setZoomLevel(appliedLevel(userLevel));
    const settings = parseSettings(readJson(settingsFile()));
    writeJson(settingsFile(), { ...settings, zoomLevel: userLevel });
  });
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomLevel(appliedLevel(parseSettings(readJson(settingsFile())).zoomLevel));
    win.webContents.send(WINDOW_STATE_CHANNEL, win.isMaximized());
  });
  // Keep the DOM maximize/restore glyph in sync with the real window state.
  const pushMaximized = (): void => win.webContents.send(WINDOW_STATE_CHANNEL, win.isMaximized());
  win.on('maximize', pushMaximized);
  win.on('unmaximize', pushMaximized);
  win.once('ready-to-show', () => {
    win.show();
  });
  // The custom title bar means no native menu, and no menu means no accelerators — so
  // devtools has no way in unless we give it one. It opens on request, never on launch.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    const combo = input.control && input.shift && input.key.toLowerCase() === 'i';
    if (combo || input.key === 'F12') win.webContents.toggleDevTools();
  });
  // Fallback: if `ready-to-show` never fires (a dev-server race that would otherwise
  // leave a hidden window and a process that "acts like it's running"), show anyway.
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 4000);

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const load = (): void => {
    void (
      rendererUrl
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
  const root = projectRoot();
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
          if (note.method === 'push') {
            mainWindow?.webContents.send(PUSH_CHANNEL, note.params);
          }
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

/** Result of a reveal-in-editor attempt (mirrors `OpenPathResultSchema`). Advisory: a
 *  failure surfaces to the renderer (which toasts it) but never blocks. */
type RevealResult = { ok: boolean; revealed?: 'editor' | 'folder'; reason?: string };

/** Spawn `code -g <abs>:<line>`, resolving to whether it launched. `code`/`code.cmd`
 *  detaches and its exit code isn't awaited (the editor stays open); we treat a clean
 *  spawn (no immediate `error` event) as success and reveal via the OS fallback if the
 *  binary is missing or errors. */
function spawnCode(absPath: string, line: number | undefined): Promise<boolean> {
  // On Windows the invocation goes through `cmd.exe /c code`; refuse a path carrying a
  // cmd-interpreted metacharacter (a maliciously-named worktree file) — spaces are fine
  // (Node quotes each arg), only `%`/`!`/`"`/newlines are refused. The caller falls back to
  // the shell-free folder reveal. POSIX spawns `code` directly, so it is exempt.
  if (process.platform === 'win32' && !safeForWindowsShell(absPath)) return Promise.resolve(false);
  const { command, args } = codeInvocation(process.platform, absPath, line);
  return new Promise((resolvePromise) => {
    try {
      // shell:false ⇒ Node applies Win32 argument quoting, so a path with spaces stays one
      // argument (the reveal's original split-at-space bug is gone). `code -g` signals the
      // running instance and exits promptly; a clean exit (code 0) means it launched, a
      // non-zero exit (e.g. `code` not on PATH ⇒ cmd's "not recognized") means fall back.
      const child = spawn(command, args, {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
        detached: false,
      });
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        resolvePromise(ok);
      };
      // ENOENT (no `cmd.exe`/`code` binary) surfaces as an async `error` event.
      child.once('error', () => done(false));
      child.once('exit', (code) => done(code === 0));
      // If it stays attached past a short window (rare for `-g`), assume it launched.
      setTimeout(() => done(true), 2000);
    } catch {
      resolvePromise(false);
    }
  });
}

/**
 * The reveal-in-editor IPC (a tool card's path/match click). Resolves the (worktree-
 * relative) path against the named session's worktree root, CONFINES it (a path that
 * escapes the root is refused — never open an arbitrary file), then opens it in VS Code
 * at the line via `code -g`, falling back to `shell.showItemInFolder` when `code` is
 * unavailable. Always resolves a structured result (never throws to the renderer) — the
 * renderer toasts a failure; the reveal is advisory and never blocks.
 */
async function revealPath(params: {
  path: string;
  line?: number;
  sessionId?: string;
}): Promise<RevealResult> {
  // Resolve against the project root main derives (= the daemon's cwd / the tools'
  // worktreeRoot), not an ephemeral push-supplied worktree id — so it works on first launch
  // and after a restart, and points at the real filesystem directory.
  const abs = confineToWorktree(projectRoot(), params.path);
  if (abs === undefined) {
    return { ok: false, reason: `Path escapes the worktree: ${params.path}` };
  }
  const launched = await spawnCode(abs, params.line);
  if (launched) return { ok: true, revealed: 'editor' };
  // `code` absent/failed: reveal the file in the OS file manager (no line jump).
  try {
    shell.showItemInFolder(abs);
    return { ok: true, revealed: 'folder' };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Could not reveal the file.' };
  }
}

/**
 * Open a web URL in the default browser (a tool card's WebSearch/WebFetch link). Validates
 * the URL to `http:`/`https:` first (any other scheme is refused — never hand the OS a
 * `file:`/`javascript:`/shell URL), then `shell.openExternal`. Always resolves a structured
 * result (never throws to the renderer); the renderer toasts a failure. Advisory.
 */
async function openExternalUrl(params: { url: string }): Promise<{ ok: boolean; reason?: string }> {
  const check = validateExternalUrl(params.url);
  if (!check.ok) return { ok: false, reason: check.reason };
  try {
    await shell.openExternal(check.url);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Could not open the URL.' };
  }
}

/** Expand a leading `~` to the home directory — a directory field carries `~/…` pointers
 *  (that is how the auth surface writes them), but the OS dialog needs a real path. */
function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? join(homedir(), p.slice(1)) : p;
}

/** The native directory picker, parented to the console window (a free-floating dialog can
 *  land behind it). Cancelling returns NO path — the renderer keeps whatever it had. */
async function pickDirectory(params: { defaultPath?: string }): Promise<{ path?: string }> {
  const options = {
    properties: ['openDirectory' as const],
    ...(params.defaultPath !== undefined && existsSync(expandHome(params.defaultPath))
      ? { defaultPath: expandHome(params.defaultPath) }
      : {}),
  };
  const res = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  const path = res.filePaths[0];
  return res.canceled || path === undefined ? {} : { path };
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
    case 'authView':
      return proxyDaemon('authView');
    case 'addProvider':
      return proxyDaemon('addProvider', params);
    case 'removeProvider':
      return proxyDaemon('removeProvider', params);
    case 'addCredential':
      return proxyDaemon('addCredential', params);
    case 'replaceSecret':
      return proxyDaemon('replaceSecret', params);
    case 'renameCredential':
      return proxyDaemon('renameCredential', params);
    case 'removeCredential':
      return proxyDaemon('removeCredential', params);
    case 'setProviderEnabled':
      return proxyDaemon('setProviderEnabled', params);
    case 'setCredentialDisabled':
      return proxyDaemon('setCredentialDisabled', params);
    case 'makeActive':
      return proxyDaemon('makeActive', params);
    case 'clearCooldown':
      return proxyDaemon('clearCooldown', params);
    case 'setIsolatedBrowserLogins':
      return proxyDaemon('setIsolatedBrowserLogins', params);
    case 'setBrowserPath':
      return proxyDaemon('setBrowserPath', params);
    case 'reclaimBrowserProfiles':
      return proxyDaemon('reclaimBrowserProfiles', params);
    case 'refresh':
      return proxyDaemon('refresh');
    case 'startSession':
      return proxyDaemon('createSession', params);
    case 'newSession':
      return proxyDaemon('newSession', params);
    case 'listSessions':
      return proxyDaemon('listSessions');
    case 'reloadConversation':
      return proxyDaemon('reloadConversation', params);
    case 'deleteSession':
      return proxyDaemon('deleteSession', params);
    case 'recompilePrompt':
      return proxyDaemon('recompilePrompt', params);
    case 'interruptSession':
      return proxyDaemon('interruptSession', params);
    case 'steerSession':
      return proxyDaemon('steerSession', params);
    case 'subscribeSession':
      return proxyDaemon('subscribeSession', params);
    case 'listModels':
      return proxyDaemon('listModels');
    case 'modelCatalog':
      return proxyDaemon('modelCatalog');
    case 'addModels':
      return proxyDaemon('addModels', params);
    case 'addCustomModel':
      return proxyDaemon('addCustomModel', params);
    case 'editModel':
      return proxyDaemon('editModel', params);
    case 'removeModel':
      return proxyDaemon('removeModel', params);
    case 'setModelHidden':
      return proxyDaemon('setModelHidden', params);
    case 'listRoles':
      return proxyDaemon('listRoles');
    case 'listPackages':
      return proxyDaemon('listPackages');
    case 'openPath':
      return revealPath(params as { path: string; line?: number; sessionId?: string });
    case 'openExternal':
      return openExternalUrl(params as { url: string });
    case 'pickDirectory':
      return pickDirectory(params as { defaultPath?: string });
    case 'editCommand': {
      // The DOM edit menu's actions: main drives Chromium's native editing commands on
      // the focused element, so the renderer never touches the clipboard itself.
      const { command } = params as { command: 'cut' | 'copy' | 'paste' | 'selectAll' };
      mainWindow?.webContents[command]();
      return undefined;
    }
    case 'getWorkspace': {
      const root = projectRoot();
      return { name: basename(root), root };
    }
    case 'getLayout':
      return readJson(layoutFile());
    case 'saveLayout':
      writeJson(layoutFile(), params);
      return undefined;
    case 'getSettings':
      return parseSettings(readJson(settingsFile()));
    case 'listAgents':
      return proxyDaemon('listAgents');
    case 'saveAgent':
      return proxyDaemon('saveAgent', params);
    case 'deleteAgent':
      return proxyDaemon('deleteAgent', params);
    case 'startLogin':
      return proxyDaemon('startLogin', params);
    case 'loginState':
      return proxyDaemon('loginState');
    case 'submitLoginCode':
      return proxyDaemon('submitLoginCode', params);
    case 'cancelLogin':
      return proxyDaemon('cancelLogin');
    case 'resolveLoginMismatch':
      return proxyDaemon('resolveLoginMismatch', params);
    case 'probeHealth':
      return proxyDaemon('probeHealth');
    case 'reportAuthFailure':
      return proxyDaemon('reportAuthFailure', params);
    case 'saveSettings': {
      const incoming = parseSettings(params);
      // Main owns `zoomLevel` (driven by the keybindings, not this renderer save), so
      // preserve the on-disk value — a stale renderer copy must not clobber the zoom.
      const zoomLevel = parseSettings(readJson(settingsFile())).zoomLevel;
      writeJson(settingsFile(), { ...incoming, zoomLevel });
      return undefined;
    }
  }
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
for (const [name, action] of Object.entries(daemonActions) as [
  DaemonControlName,
  () => unknown,
][]) {
  ipcMain.handle(DAEMON_CONTROL[name], async () => (await action()) ?? undefined);
}

// The custom (DOM) window controls act on the single window. `toggleMaximize` mirrors
// the OS behaviour; the resulting state is pushed back on WINDOW_STATE_CHANNEL by the
// maximize/unmaximize listeners wired in `createWindow`.
const windowActions: Record<WindowControlName, () => void> = {
  minimize: () => mainWindow?.minimize(),
  toggleMaximize: () =>
    mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize(),
  close: () => mainWindow?.close(),
};
for (const [name, action] of Object.entries(windowActions) as [WindowControlName, () => void][]) {
  ipcMain.handle(WINDOW_CONTROL[name], () => {
    action();
    return undefined;
  });
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
    // The custom DOM title bar is the only chrome — no File/Edit/View menu.
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
