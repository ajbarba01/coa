import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ModelDescriptor, RpcParams } from '@coa/shared';
import { pushSchema } from '@coa/shared';
import {
  bindDaemon,
  buildConversationHandlers,
  buildDaemonConsoleHandlers,
  buildRegistryHandlers,
  buildSessionHandlers,
  connectClient,
  createConversationStore,
  defaultDaemonPath,
  packageSummaries,
  roleSummaries,
  type ModelCache,
  type ModelCacheAccount,
  type RpcServer,
} from '@coa/core';
import { runAuthCommand } from './auth-cli.js';
import { runWebCommand } from './web-cli.js';
import { buildSessionDeps } from './session-deps.js';
import { parseRunArgs, renderPush } from './run-render.js';

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
  timeline: () => ({ method: 'listTimeline' }),
};

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  if (command === undefined) {
    io.err('usage: coa <run|auth|websearch|webfetch|cap|flags|why|decision|timeline> [args]');
    return 1;
  }
  if (command === 'auth') return runAuthCommand(args, io);
  if (command === 'websearch') return runWebCommand('search', args, io);
  if (command === 'webfetch') return runWebCommand('fetch', args, io);
  if (command === 'run') return runSession(args, io);
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

/**
 * `coa run` — start a governed session on the daemon and stream its turns to the
 * terminal. A thin client (D112/D113): it opens the pipe, subscribes to the R-12
 * push stream, calls `createSession`, and renders each turn/status/cost record as
 * it arrives, resolving when the session reaches its terminal status. The session
 * itself lives in the daemon; this process only renders. Exit code follows the
 * session outcome (a loop error → non-zero).
 */
export async function runSession(args: string[], io: CliIo): Promise<number> {
  const parsed = parseRunArgs(args);
  if ('error' in parsed) {
    io.err(parsed.error);
    return 1;
  }

  let settle!: (failed: boolean) => void;
  const finished = new Promise<boolean>((resolve) => (settle = resolve));

  const client = await connectClient(io.path ?? defaultDaemonPath(), (note) => {
    if (note.method !== 'push') return;
    const push = pushSchema.safeParse(note.params);
    if (!push.success) return;
    const { lines, terminal } = renderPush(push.data);
    for (const line of lines) io.out(line);
    if (terminal !== undefined) settle(terminal === 'error');
  });

  try {
    const response = await client.request('createSession', {
      input: parsed.input,
      ...(parsed.role !== undefined ? { role: parsed.role } : {}),
      ...(parsed.scope !== undefined ? { scope: parsed.scope } : {}),
      ...(parsed.model !== undefined ? { model: parsed.model } : {}),
    });
    if ('error' in response) {
      io.err(response.error.message);
      return 1;
    }
    const failed = await finished;
    return failed ? 1 : 0;
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
  /** How the `shutdown` verb tears the process down (injected for tests); defaults to close-then-exit. */
  onShutdown?: (server: RpcServer) => void;
}

/**
 * Start the daemon: construct the full session closure (M1–M7 + the M9 adapter
 * factory), then serve both the inspector reads and the session-lifecycle verbs.
 * Handlers are built per connection so each `createSession` streams its turns over
 * the connection that opened it (the R-12 push seam).
 */
/**
 * Fetch every provider's models and flatten them into one list. A provider whose
 * fetch throws is logged (via `logErr`) and contributes no models to THIS call's
 * result — but the failure is never cached ({@link ModelCache} only caches a
 * resolved fetch), so the next `listModels` call retries that provider and
 * self-heals once it recovers.
 */
export async function listMergedModels(
  models: ModelCache,
  accounts: ModelCacheAccount[],
  logErr: (line: string) => void = (line) => console.error(line),
): Promise<ModelDescriptor[]> {
  const lists = await Promise.all(
    accounts.map((account) =>
      models.list(account).catch((error: unknown): ModelDescriptor[] => {
        const message = error instanceof Error ? error.message : String(error);
        logErr(`listModels: ${account.label} (${account.provider ?? 'claude'}) failed: ${message}`);
        return [];
      }),
    ),
  );
  return lists.flat();
}

export async function startDaemon(options: DaemonOptions): Promise<RpcServer> {
  const path = options.path ?? defaultDaemonPath();
  const walPath = options.walPath ?? join('.coa', 'wal', 'log.ndjson');
  mkdirSync(dirname(walPath), { recursive: true });
  if (process.platform !== 'win32') mkdirSync(dirname(path), { recursive: true });

  const { deps, handle, models, modelAccounts } = buildSessionDeps({
    walPath,
    root: process.cwd(),
  });
  const consoleHandlers = buildDaemonConsoleHandlers(handle);
  // The agent-assembly catalogue the console picker reads (starter registry today).
  const registryHandlers = buildRegistryHandlers({
    listRoles: () => roleSummaries(),
    listPackages: () => packageSummaries(),
  });
  // The R-7 conversation store lives beside the WAL under the gitignored `.coa/local/`.
  const store = createConversationStore(join(process.cwd(), '.coa', 'local', 'conversation'));
  const conversationHandlers = buildConversationHandlers(store);
  // The console's daemon control (title-bar Stop/Restart) stops the process over the
  // pipe rather than by PID, so it also cleans up a daemon this app didn't spawn. The
  // reply flushes first, then the teardown runs on the next tick (see `onShutdown`).
  // A holder so the `shutdown` handler can close the server that outlives its own
  // construction (the handler is built before `bindDaemon` resolves).
  const bound: { server?: RpcServer } = {};
  const onShutdown =
    options.onShutdown ?? ((s: RpcServer) => void s.close().finally(() => process.exit(0)));
  const shutdownHandlers = {
    shutdown: {
      handle: () => {
        const server = bound.server;
        if (server !== undefined) setTimeout(() => onShutdown(server), 10).unref();
        return { ok: true };
      },
    },
  };
  bound.server = await bindDaemon(path, (connection) => ({
    ...consoleHandlers,
    ...registryHandlers,
    ...conversationHandlers,
    ...shutdownHandlers,
    ...buildSessionHandlers(deps, connection, store),
    // Every provider's models + per-model reasoning levels, merged into one list
    // (cached, fetched lazily; a provider that fails to fetch is logged + skipped
    // for this call, not fatal — it self-heals on the next call since the failure
    // is never cached).
    listModels: { handle: () => listMergedModels(models, modelAccounts(), options.err) },
  }));
  options.out(`coa daemon listening on ${path}`);
  return bound.server;
}
