import { basename, join, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn, type StdioOptions } from 'node:child_process';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { canonicalProjectRoot, connectClient, defaultDaemonPath, probeDaemon } from '@coa/core/rpc';
import { contentSecurityPolicy } from './csp.js';
import { titleBarConfig, WINDOW_BACKGROUND } from './titlebar.js';
import { appliedLevel, keyToZoomAction, nextLevel, BASE_ZOOM_LEVEL } from './zoom.js';
import { type DaemonClient } from './daemon.js';
import {
  createDaemonManager,
  failureLine,
  type DaemonManager,
  type DaemonProcess,
} from './daemon-manager.js';
import { createDaemonRegistry, type DaemonRegistry } from './daemon-registry.js';
import { createWindowRegistry, type WindowRegistry } from './window-registry.js';
import { recordRecentProject } from './recent-projects.js';
import { secondInstanceTarget } from './second-instance.js';
import { findCoaInstallRoot } from './coa-install.js';
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
import { parseProjectsState, type RecentProject } from '../shared/projects.js';

/**
 * F11: coa governs any project a window is pointed at, not only its own
 * checkout. Two registries replace the old app-wide singletons:
 *  - {@link windowRegistry} — every open window, keyed by id, each tracking the
 *    project ROOT it is bound to (was `mainWindow: BrowserWindow | undefined`).
 *  - {@link daemonRegistry} — one daemon manager PER PROJECT ROOT, refcounted by
 *    the windows bound to it, spawned on first reference and killed the instant
 *    the last one releases (see daemon-registry.ts's doc comment for the
 *    concurrent-write hazard this rules out).
 * Every window-scoped IPC handler below resolves "which project" from the
 * CALLING window (`event.sender` → `BrowserWindow.fromWebContents`), never from
 * a single global — see `windowFromEvent`/`requireWindowRoot`/`requireManager`.
 */
const windowRegistry: WindowRegistry<BrowserWindow> =
  createWindowRegistry<BrowserWindow>(canonicalProjectRoot);
const daemonRegistry: DaemonRegistry = createDaemonRegistry({
  createManager: buildManagerFor,
  canonicalize: canonicalProjectRoot,
});

/**
 * Where coa itself is installed — walked up from Electron's own `process.cwd()`.
 * Locates the daemon's CLI binary at spawn time ONLY; it is independent of which
 * project a window governs (see coa-install.ts). Memoized: the walk never
 * changes within one running app instance.
 */
let cachedCoaInstallRoot: string | undefined;
function coaInstallRoot(): string {
  cachedCoaInstallRoot ??= findCoaInstallRoot(process.cwd());
  return cachedCoaInstallRoot;
}

/** Create a window bound to `root`: registers it, takes a daemon reference (F11
 *  refcounting — the daemon is spawned on the FIRST window bound to a project and
 *  killed when the LAST one closes), and wires the same per-window chrome the
 *  single-window app always had (zoom, devtools, maximize state, dev-server load
 *  retry). Returns the window so a caller (openProject, second-instance,
 *  launch-restore) can act on it further if needed. */
function createProjectWindow(root: string): BrowserWindow {
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
  windowRegistry.bind(win.id, win, root);
  daemonRegistry.acquire(root);

  win.on('closed', () => {
    // Look up the CURRENT root, not the `root` this closure was created with — `win`
    // may have been rebound to a different project since creation (`rebindWindow`,
    // the swap-in-current-window path), and closing must release whatever project
    // this window is bound to NOW, or the swapped-to project's daemon reference is
    // never released and its process is orphaned with zero windows watching it.
    const currentRoot = windowRegistry.rootOf(win.id) ?? root;
    windowRegistry.unbind(win.id);
    // Fire-and-forget: closing must not block on the daemon's graceful teardown.
    void daemonRegistry.release(currentRoot);
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
    // Re-sync THIS window's project's current daemon status — a reload (or the
    // first paint) must not wait for the next status CHANGE to learn it.
    pushDaemonStatusFor(win);
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

  return win;
}

/** Rebind `win` from whatever project it had to `newRoot` in place (the
 *  swap-in-current-window path of `openProject`) — releases the old project's
 *  daemon reference, takes one on the new project, and re-syncs the daemon-status
 *  push so the window's gate reflects the new project immediately. A no-op if
 *  `win` is already bound to `newRoot` (by canonical identity). */
async function rebindWindow(win: BrowserWindow, newRoot: string): Promise<void> {
  const oldRoot = windowRegistry.rootOf(win.id);
  if (oldRoot !== undefined && canonicalProjectRoot(oldRoot) === canonicalProjectRoot(newRoot)) {
    return;
  }
  windowRegistry.rebind(win.id, newRoot);
  daemonRegistry.acquire(newRoot);
  if (oldRoot !== undefined) void daemonRegistry.release(oldRoot);
  pushDaemonStatusFor(win);
}

/** Push `win`'s project's CURRENT daemon report — used on load/reload and right
 *  after a rebind, so the gate doesn't wait for the next status CHANGE. */
function pushDaemonStatusFor(win: BrowserWindow): void {
  const root = windowRegistry.rootOf(win.id);
  const manager = root !== undefined ? daemonRegistry.get(root) : undefined;
  if (manager !== undefined) win.webContents.send(DAEMON_STATUS_CHANNEL, manager.report());
}

/** Bring `win` to the front (same restore/show/focus sequence the old
 *  second-instance handler used on the single `mainWindow`). */
function focusWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** The `BrowserWindow` an IPC call came from, if it still exists (a window can be
 *  destroyed mid-request). Every window-scoped handler resolves "which project"
 *  through this — never through a single global. */
function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

/** The project root the CALLING window is bound to. Every window is bound at
 *  creation time (see `createProjectWindow`), so this is only ever undefined for
 *  a window that raced its own destruction. */
function requireWindowRoot(event: IpcMainInvokeEvent): string {
  const win = windowFromEvent(event);
  const root = win !== undefined ? windowRegistry.rootOf(win.id) : undefined;
  if (root === undefined) throw new Error('no project is open in this window');
  return root;
}

/** The CALLING window's project's daemon manager — the F11 replacement for the
 *  single app-wide `daemon` this used to be. */
function requireManager(event: IpcMainInvokeEvent): DaemonManager {
  const root = requireWindowRoot(event);
  const manager = daemonRegistry.get(root);
  if (manager === undefined) throw new Error(`no daemon registered for ${root}`);
  return manager;
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

/** How much of the daemon's stderr to keep for the failure line (a few lines' worth). */
const DAEMON_STDERR_TAIL = 4000;

/**
 * How to launch `root`'s daemon, resolved deterministically rather than trusting
 * the Electron process to have inherited `coa` on PATH (it often hasn't).
 * Preference: an explicit `COA_CLI` override → the built `apps/cli/dist/bin.js`
 * from coa's OWN install location ({@link coaInstallRoot}, NOT `root` — F11:
 * these are independent once coa can govern a project it isn't itself part of) →
 * a bare `coa serve` on PATH as a last resort. The daemon runs with `cwd = root`
 * so it reads/writes THAT project's `.coa` store (and resolves the same
 * project-keyed endpoint a probe against `root` expects).
 */
function daemonSpawn(root: string): DaemonProcess {
  const binPath = join(coaInstallRoot(), 'apps', 'cli', 'dist', 'bin.js');
  const node = process.env['npm_node_execpath'] ?? 'node';
  const override = process.env['COA_CLI'];
  // stderr is PIPED, not ignored: a daemon that dies on a missing binary or a broken
  // native addon says so on stderr, and discarding it left the gate able to report only
  // that something failed. stdin/stdout stay ignored — nothing reads them.
  const stdio: StdioOptions = ['ignore', 'ignore', 'pipe'];

  const child = override
    ? spawn(`${override} serve`, { cwd: root, stdio, shell: true, windowsHide: true })
    : existsSync(binPath)
      ? // shell:false + args array → the space in the path is safe and the child is
        // directly killable (no shell wrapper to orphan the real process on stop/quit).
        spawn(node, [binPath, 'serve'], { cwd: root, stdio, windowsHide: true })
      : spawn('coa serve', { cwd: root, stdio, shell: true, windowsHide: true });

  // Only the TAIL is kept: a crash explains itself in its last lines, and an unbounded
  // buffer would grow for as long as the app runs.
  let tail = '';
  const remember = (text: string): void => {
    tail = `${tail}${text}`.slice(-DAEMON_STDERR_TAIL);
  };
  child.stderr?.on('data', (chunk: Buffer) => remember(chunk.toString()));
  // A spawn that never starts (no such binary, permission denied) reports on `error`
  // rather than stderr — same failure to the user, so it lands in the same buffer.
  child.on('error', (err: Error) => remember(`${err.message}\n`));
  return { kill: () => child.kill(), failure: () => failureLine(tail) };
}

/**
 * Build the daemon manager for `root` — the daemon-registry's `createManager`
 * factory. Everything below closes over `root`, including push routing: a
 * connection's forwarded `push` notifications and status changes are delivered
 * to whichever window is CURRENTLY bound to `root` (looked up at delivery time
 * via `windowRegistry`, never cached), so a rebind never needs this manager
 * rewired.
 */
function buildManagerFor(root: string): DaemonManager {
  const manager = createDaemonManager({
    path: defaultDaemonPath(root),
    probe: probeDaemon,
    // Give a cold daemon time to load its native addons + bind the pipe (~a few seconds).
    retry: { attempts: 50, delayMs: 200 },
    connect: async (path, onClose): Promise<DaemonClient> =>
      toDaemonClient(
        await connectClient(
          path,
          (note) => {
            if (note.method === 'push') {
              windowRegistry.windowForRoot(root)?.webContents.send(PUSH_CHANNEL, note.params);
            }
          },
          onClose,
        ),
      ),
    spawn: () => daemonSpawn(root),
  });
  manager.onStatus((report) => {
    if (report.status === 'error') {
      console.error(`[coa] daemon error (${root}): ${report.reason ?? 'no reason reported'}`);
    }
    windowRegistry.windowForRoot(root)?.webContents.send(DAEMON_STATUS_CHANNEL, report);
  });
  return manager;
}

/** The per-app-install (never per-project — F11 ruled chrome app-global) layout file. */
function layoutFile(): string {
  return join(app.getPath('userData'), 'coa', 'layout.json');
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'coa', 'settings.json');
}

/** The recent-projects MRU + the roots open at last quit — see `shared/projects.ts`. */
function projectsFile(): string {
  return join(app.getPath('userData'), 'coa', 'projects.json');
}

/** Move `root` to the front of the recent-projects list (an `openProject` call,
 *  successful or focusing-existing — either way the user just reached for it). */
function recordRecent(root: string): void {
  const state = parseProjectsState(readJson(projectsFile()));
  const entry: RecentProject = { root, name: basename(root), lastOpenedAt: Date.now() };
  writeJson(projectsFile(), {
    ...state,
    recent: recordRecentProject(state.recent, entry, canonicalProjectRoot),
  });
}

/** Dedupe a root list by canonical identity, keeping the first spelling seen. */
function dedupeRoots(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of roots) {
    const key = canonicalProjectRoot(root);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
  }
  return out;
}

/** The project roots to open at launch — F11's restore-last-session. The
 *  persisted `openAtQuit` set wins; a fresh install (nothing ever persisted) falls
 *  back to today's only prior behavior: one window on coa's own install root. */
function rootsToRestore(): string[] {
  const state = parseProjectsState(readJson(projectsFile()));
  return state.openAtQuit.length > 0 ? dedupeRoots(state.openAtQuit) : [coaInstallRoot()];
}

/** Snapshot every currently-open project root, one per window, for the next launch. */
function persistOpenAtQuit(): void {
  const state = parseProjectsState(readJson(projectsFile()));
  writeJson(projectsFile(), { ...state, openAtQuit: dedupeRoots(windowRegistry.openRoots()) });
}

/** Forward a read to the CALLING window's project daemon, surfacing a JSON-RPC
 *  error as a coded IPC error. */
async function proxyDaemon(
  event: IpcMainInvokeEvent,
  method: string,
  params?: unknown,
): Promise<unknown> {
  const manager = requireManager(event);
  const res = await (await manager.client()).request(method, params);
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
 * relative) path against the CALLING window's bound project root, CONFINES it (a
 * path that escapes the root is refused — never open an arbitrary file), then opens
 * it in VS Code at the line via `code -g`, falling back to `shell.showItemInFolder`
 * when `code` is unavailable. Always resolves a structured result (never throws to
 * the renderer) — the renderer toasts a failure; the reveal is advisory and never
 * blocks.
 */
async function revealPath(
  event: IpcMainInvokeEvent,
  params: { path: string; line?: number; sessionId?: string },
): Promise<RevealResult> {
  // Resolve against the calling window's bound project root (= the daemon's cwd / the
  // tools' worktreeRoot), not an ephemeral push-supplied worktree id — so it works on
  // first launch and after a restart, and points at the real filesystem directory.
  const root = requireWindowRoot(event);
  const abs = confineToWorktree(root, params.path);
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

/** The native directory picker, parented to the CALLING window (a free-floating dialog
 *  can land behind it). Cancelling returns NO path — the renderer keeps whatever it had. */
async function pickDirectory(
  event: IpcMainInvokeEvent,
  params: { defaultPath?: string },
): Promise<{ path?: string }> {
  const win = windowFromEvent(event);
  const options = {
    properties: ['openDirectory' as const],
    ...(params.defaultPath !== undefined && existsSync(expandHome(params.defaultPath))
      ? { defaultPath: expandHome(params.defaultPath) }
      : {}),
  };
  const res =
    win !== undefined
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
  const path = res.filePaths[0];
  return res.canceled || path === undefined ? {} : { path };
}

/**
 * F11 — open, switch to, or focus a project. Contract:
 *  - `root` must already exist as a real directory (a stale recent entry, a
 *    mistyped path — refused up front with a plain `Error` rather than a
 *    confusing daemon-spawn failure).
 *  - If `root` is ALREADY open in some window (by canonical identity), that
 *    window is focused and NOTHING ELSE happens — never a second daemon over the
 *    same project, regardless of what `target` asked for.
 *  - Otherwise `target: 'new'` opens a fresh window; `target: 'current'` rebinds
 *    the calling window in place (releasing its old project's daemon reference,
 *    taking one on the new project).
 *  - Every successful call (including "focused existing") moves `root` to the
 *    front of the recent-projects list.
 * Returns which of the three things happened plus the resulting workspace, so
 * the caller can react without a second round trip. The caller is responsible
 * for confirming with the user BEFORE calling this with `target: 'current'`
 * while its own project has a turn actively running (see the IPC method's doc
 * comment in `shared/methods.ts`) — main performs the swap unconditionally.
 */
async function openProject(
  event: IpcMainInvokeEvent,
  params: { root: string; target: 'current' | 'new' },
): Promise<{
  opened: 'new' | 'current' | 'focused-existing';
  workspace: { name: string; root: string };
}> {
  const root = resolve(params.root);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }
  recordRecent(root);
  const workspace = { name: basename(root), root };

  const requester = windowFromEvent(event);
  const requesterRoot = requester !== undefined ? windowRegistry.rootOf(requester.id) : undefined;
  // Already the calling window's own project — nothing to rebind.
  if (
    requester !== undefined &&
    requesterRoot !== undefined &&
    canonicalProjectRoot(requesterRoot) === canonicalProjectRoot(root)
  ) {
    focusWindow(requester);
    return { opened: 'current', workspace };
  }

  const existing = windowRegistry.windowForRoot(root);
  if (existing !== undefined) {
    // Some OTHER window already has this project open — never a second daemon for
    // the same project, so "already open" wins over whatever `target` asked for.
    focusWindow(existing);
    return { opened: 'focused-existing', workspace };
  }

  if (params.target === 'new' || requester === undefined) {
    createProjectWindow(root);
    return { opened: 'new', workspace };
  }

  await rebindWindow(requester, root);
  return { opened: 'current', workspace };
}

/** The recent-projects MRU, each entry live-annotated with whether it's open in
 *  some window right now (computed from the window registry, never persisted). */
function listRecentProjects(): Array<RecentProject & { open: boolean }> {
  const state = parseProjectsState(readJson(projectsFile()));
  return state.recent.map((entry) => ({
    ...entry,
    open: windowRegistry.windowForRoot(entry.root) !== undefined,
  }));
}

async function runMethod(
  name: MethodName,
  params: unknown,
  event: IpcMainInvokeEvent,
): Promise<unknown> {
  switch (name) {
    case 'capState':
      return proxyDaemon(event, 'capState');
    case 'flagsForUser':
      return proxyDaemon(event, 'flagsForUser');
    case 'listTimeline':
      return proxyDaemon(event, 'listTimeline');
    case 'listAccounts':
      return proxyDaemon(event, 'listAccounts');
    case 'currentAccount':
      return proxyDaemon(event, 'currentAccount');
    case 'useAccount':
      return proxyDaemon(event, 'useAccount', params);
    case 'authView':
      return proxyDaemon(event, 'authView');
    case 'addProvider':
      return proxyDaemon(event, 'addProvider', params);
    case 'removeProvider':
      return proxyDaemon(event, 'removeProvider', params);
    case 'addCredential':
      return proxyDaemon(event, 'addCredential', params);
    case 'replaceSecret':
      return proxyDaemon(event, 'replaceSecret', params);
    case 'renameCredential':
      return proxyDaemon(event, 'renameCredential', params);
    case 'removeCredential':
      return proxyDaemon(event, 'removeCredential', params);
    case 'setProviderEnabled':
      return proxyDaemon(event, 'setProviderEnabled', params);
    case 'setCredentialDisabled':
      return proxyDaemon(event, 'setCredentialDisabled', params);
    case 'makeActive':
      return proxyDaemon(event, 'makeActive', params);
    case 'clearCooldown':
      return proxyDaemon(event, 'clearCooldown', params);
    case 'setIsolatedBrowserLogins':
      return proxyDaemon(event, 'setIsolatedBrowserLogins', params);
    case 'setBrowserPath':
      return proxyDaemon(event, 'setBrowserPath', params);
    case 'reclaimBrowserProfiles':
      return proxyDaemon(event, 'reclaimBrowserProfiles', params);
    case 'refresh':
      return proxyDaemon(event, 'refresh');
    case 'startSession':
      return proxyDaemon(event, 'createSession', params);
    case 'newSession':
      return proxyDaemon(event, 'newSession', params);
    case 'listSessions':
      return proxyDaemon(event, 'listSessions');
    case 'reloadConversation':
      return proxyDaemon(event, 'reloadConversation', params);
    case 'deleteSession':
      return proxyDaemon(event, 'deleteSession', params);
    case 'recompilePrompt':
      return proxyDaemon(event, 'recompilePrompt', params);
    case 'interruptSession':
      return proxyDaemon(event, 'interruptSession', params);
    case 'steerSession':
      return proxyDaemon(event, 'steerSession', params);
    case 'subscribeSession':
      return proxyDaemon(event, 'subscribeSession', params);
    case 'listModels':
      return proxyDaemon(event, 'listModels');
    case 'modelCatalog':
      return proxyDaemon(event, 'modelCatalog');
    case 'addModels':
      return proxyDaemon(event, 'addModels', params);
    case 'addCustomModel':
      return proxyDaemon(event, 'addCustomModel', params);
    case 'editModel':
      return proxyDaemon(event, 'editModel', params);
    case 'removeModel':
      return proxyDaemon(event, 'removeModel', params);
    case 'setModelHidden':
      return proxyDaemon(event, 'setModelHidden', params);
    case 'listRoles':
      return proxyDaemon(event, 'listRoles');
    case 'listPackages':
      return proxyDaemon(event, 'listPackages');
    case 'openPath':
      return revealPath(event, params as { path: string; line?: number; sessionId?: string });
    case 'openExternal':
      return openExternalUrl(params as { url: string });
    case 'pickDirectory':
      return pickDirectory(event, params as { defaultPath?: string });
    case 'openProject':
      return openProject(event, params as { root: string; target: 'current' | 'new' });
    case 'listRecentProjects':
      return listRecentProjects();
    case 'editCommand': {
      // The DOM edit menu's actions: main drives Chromium's native editing commands on
      // the focused element (the one that sent this call), so the renderer never
      // touches the clipboard itself.
      const { command } = params as { command: 'cut' | 'copy' | 'paste' | 'selectAll' };
      event.sender[command]();
      return undefined;
    }
    case 'getWorkspace': {
      const root = requireWindowRoot(event);
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
      return proxyDaemon(event, 'listAgents');
    case 'saveAgent':
      return proxyDaemon(event, 'saveAgent', params);
    case 'deleteAgent':
      return proxyDaemon(event, 'deleteAgent', params);
    case 'startLogin':
      return proxyDaemon(event, 'startLogin', params);
    case 'loginState':
      return proxyDaemon(event, 'loginState');
    case 'submitLoginCode':
      return proxyDaemon(event, 'submitLoginCode', params);
    case 'cancelLogin':
      return proxyDaemon(event, 'cancelLogin');
    case 'resolveLoginMismatch':
      return proxyDaemon(event, 'resolveLoginMismatch', params);
    case 'probeHealth':
      return proxyDaemon(event, 'probeHealth');
    case 'reportAuthFailure':
      return proxyDaemon(event, 'reportAuthFailure', params);
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
  ipcMain.handle(channel(name), async (event, rawParams: unknown) => {
    const spec = METHODS[name];
    const params = spec.params ? spec.params.parse(rawParams) : undefined;
    const result = await runMethod(name, params, event);
    return spec.result.parse(result);
  });
}

// The title-bar daemon control (Start/Stop/Restart) + a status read. These are
// main-local transport actions, not daemon RPC reads, so they sit on their own channels.
// F11: window-scoped — each window controls ITS OWN project's daemon (resolved from
// the calling window's bound root), never a single app-wide one.
const daemonActions: Record<
  DaemonControlName,
  (manager: DaemonManager) => unknown | Promise<unknown>
> = {
  status: (m) => m.report(),
  start: (m) => m.start(),
  adopt: (m) => m.adopt(),
  stop: (m) => m.stop(),
  restart: (m) => m.restart(),
};
for (const [name, action] of Object.entries(daemonActions) as [
  DaemonControlName,
  (m: DaemonManager) => unknown,
][]) {
  ipcMain.handle(
    DAEMON_CONTROL[name],
    async (event) => (await action(requireManager(event))) ?? undefined,
  );
}

// The custom (DOM) window controls act on the window that SENT the call — F11
// generalizes this from the single `mainWindow` singleton to whichever window's
// title bar the click came from. The resulting state is pushed back on
// WINDOW_STATE_CHANNEL by the maximize/unmaximize listeners wired in `createProjectWindow`.
const windowActions: Record<WindowControlName, (win: BrowserWindow) => void> = {
  minimize: (win) => win.minimize(),
  toggleMaximize: (win) => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  close: (win) => win.close(),
};
for (const [name, action] of Object.entries(windowActions) as [
  WindowControlName,
  (win: BrowserWindow) => void,
][]) {
  ipcMain.handle(WINDOW_CONTROL[name], (event) => {
    const win = windowFromEvent(event);
    if (win !== undefined) action(win);
    return undefined;
  });
}

/** Whether `path` exists and is a real directory — never throws (a missing path,
 *  a permission error, all resolve to "not a directory"). */
function isRealDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// A single instance owns every project's daemon + endpoint; a second launch (e.g. a
// stale prior `electron-vite dev`, or a future "open with coa" shell association)
// would otherwise shadow it with a hidden second window. F11: the handler is now
// PROJECT-AWARE — a launch naming a project focuses (or opens) that project's
// window specifically, rather than just refocusing whatever `mainWindow` used to mean.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const target = secondInstanceTarget(argv, isRealDirectory);
    if (target !== undefined) {
      const existing = windowRegistry.windowForRoot(target);
      if (existing !== undefined) focusWindow(existing);
      else createProjectWindow(resolve(target)); // never a second daemon — F11 registry-backed
      return;
    }
    // No project named (a plain relaunch): fall back to whatever window is already open.
    const [first] = windowRegistry.all();
    if (first !== undefined) focusWindow(first.win);
  });
  bootstrap();
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
    // F11 launch-restore: reopen every project/window that was open at last quit
    // (a fresh install — nothing ever persisted — falls back to one window on coa's
    // own install root, today's only prior behavior).
    for (const root of rootsToRestore()) createProjectWindow(root);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        for (const root of rootsToRestore()) createProjectWindow(root);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    // Snapshot what's open now so the NEXT launch restores it, then reap every
    // project's daemon (best-effort, not awaited — the app is quitting).
    persistOpenAtQuit();
    daemonRegistry.disposeAll();
  });
}
