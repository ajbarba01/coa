/**
 * The minimal daemon-connection contract the main process depends on — the subset
 * of the core `RpcClient` the IPC proxy + the {@link createDaemonManager} lifecycle
 * need. The concrete client is adapted from `@coa/core`'s pipe client in the
 * composition root (`index.ts`).
 */
export interface DaemonClient {
  request(
    method: string,
    params?: unknown,
  ): Promise<{ result?: unknown; error?: { code: number; message: string } }>;
  close(): Promise<void>;
}
