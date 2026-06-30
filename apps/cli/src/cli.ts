import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RpcParams } from '@coa/shared';
import {
  bindDaemon,
  buildDaemonConsoleHandlers,
  connectClient,
  createDaemonCore,
  defaultDaemonPath,
  type RpcServer,
} from '@coa/core';

/**
 * The `coa` CLI entrypoint logic. `runCli` serves the read commands a human runs
 * against a running daemon — it connects over the OS pipe/socket, calls one
 * JSON-RPC inspector verb, and prints the result as JSON. `startDaemon` is the
 * `serve` path: it stands up the daemon core and binds the endpoint. Kept as
 * injectable functions (the IO + endpoint path are parameters) so both are tested
 * over a real daemon; the thin `bin` shim wires them to the process.
 *
 * This is the in-process-free, single-process-pair product: one `coa serve`, then
 * `coa cap` / `coa flags` / `coa why` / `coa decision` from another invocation.
 */

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Endpoint override (tests); defaults to {@link defaultDaemonPath}. */
  path?: string;
}

/** Map a read command to the JSON-RPC method + params it issues. */
const READS: Record<string, (args: string[]) => { method: string; params?: RpcParams }> = {
  cap: () => ({ method: 'capState' }),
  flags: (args) => ({
    method: 'flagsForUser',
    ...(args[0] !== undefined ? { params: { scope: args[0] } } : {}),
  }),
  why: (args) => ({ method: 'why', params: { target: args[0] ?? '' } }),
  decision: (args) => ({ method: 'getDecision', params: { id: Number(args[0]) } }),
};

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  if (command === undefined) {
    io.err('usage: coa <cap|flags|why|decision> [args]');
    return 1;
  }
  const build = READS[command];
  if (build === undefined) {
    io.err(`unknown command: ${command}`);
    return 1;
  }

  const { method, params } = build(args);
  const client = await connectClient(io.path ?? defaultDaemonPath());
  try {
    const response = await client.request(method, params);
    if ('error' in response) {
      io.err(response.error.message);
      return 1;
    }
    io.out(JSON.stringify(response.result));
    return 0;
  } finally {
    await client.close();
  }
}

export interface DaemonOptions {
  out: (line: string) => void;
  err: (line: string) => void;
  /** WAL path; its parent is created if missing. Defaults under `.coa/wal/`. */
  walPath?: string;
  /** Endpoint override; defaults to {@link defaultDaemonPath}. */
  path?: string;
}

/** Start the daemon: construct the core, bind the endpoint, serve the inspector reads. */
export async function startDaemon(options: DaemonOptions): Promise<RpcServer> {
  const path = options.path ?? defaultDaemonPath();
  const walPath = options.walPath ?? join('.coa', 'wal', 'log.ndjson');
  mkdirSync(dirname(walPath), { recursive: true });
  if (process.platform !== 'win32') mkdirSync(dirname(path), { recursive: true });

  const handle = createDaemonCore({ walPath });
  const server = await bindDaemon(path, buildDaemonConsoleHandlers(handle));
  options.out(`coa daemon listening on ${path}`);
  return server;
}
