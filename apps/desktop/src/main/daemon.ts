export interface DaemonClient {
  request(
    method: string,
    params?: unknown,
  ): Promise<{ result?: unknown; error?: { code: number; message: string } }>;
  close(): Promise<void>;
}

export interface ResolveDaemonDeps {
  connect: (path: string) => Promise<DaemonClient>;
  spawn: () => void;
  path: string;
}

/** Connect to a running daemon; if none is up, spawn `coa serve` and retry once. */
export async function resolveDaemon(deps: ResolveDaemonDeps): Promise<DaemonClient> {
  try {
    return await deps.connect(deps.path);
  } catch {
    deps.spawn();
    return await deps.connect(deps.path);
  }
}
