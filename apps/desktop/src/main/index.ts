import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { connectClient, defaultDaemonPath } from '@coa/core';
import { resolveDaemon, type DaemonClient } from './daemon.js';
import { readLayout, writeLayout } from './persistence.js';
import { METHODS, channel, type MethodName } from '../shared/methods.js';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.once('ready-to-show', () => win.show());

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

/**
 * Adapt the real `@coa/core` `RpcClient` (whose `request` resolves the full
 * JSON-RPC envelope — `{ jsonrpc, id, result }` or `{ jsonrpc, id, error }` —
 * and which also carries a `notify` method) to the local, minimal
 * `DaemonClient` contract that `resolveDaemon`/the IPC handler depend on.
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

let client: DaemonClient | undefined;

async function ensureClient(): Promise<DaemonClient> {
  if (!client) {
    client = await resolveDaemon({
      connect: async (path) => toDaemonClient(await connectClient(path)),
      spawn: () => {
        // Invoke the `coa` CLI directly (never via `node`, which would treat
        // `coa` as a script path and fail). Production packaging must ensure
        // the `coa` daemon binary is resolvable on PATH/workspace bin
        // (tracked with the electron-builder config).
        spawn(process.env['COA_CLI'] ?? 'coa', ['serve'], {
          detached: true,
          stdio: 'ignore',
          shell: process.platform === 'win32',
        }).unref();
      },
      path: defaultDaemonPath(),
    });
  }
  return client;
}

/** The per-user layout file. Per-workspace keying lands when the app gains a
 *  workspace-open flow; today the daemon is a single fixed pipe. */
function layoutFile(): string {
  return join(app.getPath('userData'), 'coa', 'layout.json');
}

/** Forward a read to the daemon, surfacing a JSON-RPC error as a coded IPC error. */
async function proxyDaemon(method: string, params?: unknown): Promise<unknown> {
  const res = await (await ensureClient()).request(method, params);
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
    case 'getLayout':
      return readLayout(layoutFile());
    case 'saveLayout':
      writeLayout(layoutFile(), params);
      return undefined;
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

/**
 * The response-header CSP is the single source of truth (dev-aware); the
 * renderer's `index.html` carries no competing hardcoded policy. In dev the
 * renderer is served from `ELECTRON_RENDERER_URL` by Vite, whose HMR needs a
 * websocket, so `connect-src` is relaxed only in that mode. Production keeps
 * the strict policy, including `connect-src 'none'`.
 */
function contentSecurityPolicy(): string {
  const connectSrc = process.env['ELECTRON_RENDERER_URL'] ? "'self' ws: wss:" : "'none'";
  return `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${connectSrc}`;
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
      },
    });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
