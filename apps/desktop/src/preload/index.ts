import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('coa', {});
