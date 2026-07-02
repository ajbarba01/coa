import { contextBridge, ipcRenderer } from 'electron';
import {
  DAEMON_CONTROL,
  DAEMON_STATUS_CHANNEL,
  METHODS,
  PUSH_CHANNEL,
  channel,
  type DaemonStatus,
  type MethodName,
} from '../shared/methods.js';

// One named method per verb, generated from the shared registry; no raw
// ipcRenderer is exposed. `process.platform` is available in the sandboxed
// preload and is injected so the renderer applies title-bar insets without
// touching `process` (spec §9).
const api: Record<string, unknown> = { platform: process.platform };
for (const name of Object.keys(METHODS) as MethodName[]) {
  api[name] = (params?: unknown): Promise<unknown> => ipcRenderer.invoke(channel(name), params);
}

// The one-way push stream (server→client): subscribe the renderer to forwarded
// daemon CON-PUSH records. Returns an unsubscribe so the controller can detach on
// dispose; only the payload crosses the bridge (no raw ipcRenderer/event leaks).
api['onPush'] = (listener: (payload: unknown) => void): (() => void) => {
  const handler = (_event: unknown, payload: unknown): void => listener(payload);
  ipcRenderer.on(PUSH_CHANNEL, handler);
  return () => ipcRenderer.removeListener(PUSH_CHANNEL, handler);
};

// The title-bar daemon control: the four lifecycle actions plus a one-way status
// subscription (mirrors `onPush`). Status is a transport fact owned by main, not a
// daemon RPC read, so it lives on its own channels.
api['daemon'] = {
  status: (): Promise<DaemonStatus> =>
    ipcRenderer.invoke(DAEMON_CONTROL.status) as Promise<DaemonStatus>,
  start: (): Promise<void> => ipcRenderer.invoke(DAEMON_CONTROL.start) as Promise<void>,
  stop: (): Promise<void> => ipcRenderer.invoke(DAEMON_CONTROL.stop) as Promise<void>,
  restart: (): Promise<void> => ipcRenderer.invoke(DAEMON_CONTROL.restart) as Promise<void>,
  onStatus: (listener: (status: DaemonStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: DaemonStatus): void => listener(status);
    ipcRenderer.on(DAEMON_STATUS_CHANNEL, handler);
    return () => ipcRenderer.removeListener(DAEMON_STATUS_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('coa', api);
