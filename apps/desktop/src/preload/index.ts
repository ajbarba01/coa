import { contextBridge, ipcRenderer } from 'electron';
import { IPC_GET_CAP } from '../shared/ipc.js';

contextBridge.exposeInMainWorld('coa', {
  getCap: (): Promise<unknown> => ipcRenderer.invoke(IPC_GET_CAP),
});
