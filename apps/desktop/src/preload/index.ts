import { contextBridge, ipcRenderer } from 'electron';
import { METHODS, channel, type MethodName } from '../shared/methods.js';

// One named method per verb, generated from the shared registry; no raw
// ipcRenderer is exposed. `process.platform` is available in the sandboxed
// preload and is injected so the renderer applies title-bar insets without
// touching `process` (spec §9).
const api: Record<string, unknown> = { platform: process.platform };
for (const name of Object.keys(METHODS) as MethodName[]) {
  api[name] = (params?: unknown): Promise<unknown> => ipcRenderer.invoke(channel(name), params);
}

contextBridge.exposeInMainWorld('coa', api);
