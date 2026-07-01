import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { connectClient, defaultDaemonPath } from '@coa/core';
import { resolveDaemon, type DaemonClient } from './daemon.js';
import { IPC_GET_CAP, CapResultSchema } from '../shared/ipc.js';

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

let client: DaemonClient | undefined;

async function ensureClient(): Promise<DaemonClient> {
  if (!client) {
    client = await resolveDaemon({
      connect: async (path) => toDaemonClient(await connectClient(path)),
      spawn: () => {
        spawn(process.execPath, [process.env['COA_CLI'] ?? 'coa', 'serve'], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      },
      path: defaultDaemonPath(),
    });
  }
  return client;
}

ipcMain.handle(IPC_GET_CAP, async () => {
  const res = await (await ensureClient()).request('capState');
  if ('error' in res && res.error) throw new Error(res.error.message);
  return CapResultSchema.parse(res.result);
});

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'",
        ],
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
