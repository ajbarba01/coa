import { contextBridge, ipcRenderer } from 'electron';
import { METHODS, PUSH_CHANNEL, channel, type MethodName } from '../shared/methods.js';

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

contextBridge.exposeInMainWorld('coa', api);
