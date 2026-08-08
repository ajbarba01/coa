import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ModelDescriptor, RpcParams } from '@coa/shared';
import { pushSchema } from '@coa/shared';
import {
  AgentRegistry,
  bindDaemon,
  buildAgentRegistryHandlers,
  buildConversationHandlers,
  buildModelHandlers,
  buildRegistryHandlers,
  buildSessionHandlers,
  connectClient,
  createConversationStore,
  defaultDaemonPath,
  effectiveModels,
  LiveSessionRegistry,
  MODEL_PROVIDERS,
  ModelCatalogStore,
  packageSummaries,
  roleSummaries,
  SessionService,
  type ModelCache,
  type ModelCacheAccount,
  type RpcServer,
} from '@coa/core';
import { runAuthCommand } from './auth-cli.js';
import { runWebCommand } from './web-cli.js';
import { buildDaemonConsoleHandlers } from './console-handlers.js';
import { buildClaudeLoginDriver } from './login-driver.js';
import { buildSessionDeps } from './session-deps.js';
import { parseRunArgs, renderPush } from './run-render.js';
import type { CliIo } from './io.js';

/**
 * The `coa` CLI entrypoint logic. `runCli` serves the read commands a human runs
 * against a running daemon — it connects over the OS pipe/socket, calls one
 * JSON-RPC inspector verb, and prints the result as JSON. `startDaemon` is the
 * `serve` path: it stands up the daemon core and binds the endpoint. Kept as
 * injectable functions (the IO + endpoint path are parameters) so both are tested
 * over a real daemon; the thin `bin` shim wires them to the process.
 *
 * This is the in-process-free, single-process-pair product: one `coa serve`, then
 * `coa cap` / `coa flags` / `coa timeline` from another invocation.
 */

export type { CliIo } from './io.js';

/** Map a read command to the JSON-RPC method + params it issues. */
const READS: Record<string, (args: string[]) => { method: string; params?: RpcParams }> = {
  cap: () => ({ method: 'capState' }),
  flags: (args) => ({
    method: 'flagsForUser',
    ...(args[0] !== undefined ? { params: { scope: args[0] } } : {}),
  }),
  timeline: () => ({ method: 'listTimeline' }),
};

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  if (command === undefined) {
    io.err('usage: coa <serve|run|auth|websearch|webfetch|cap|flags|timeline> [args]');
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
 * terminal. A thin client: it opens the pipe, subscribes to the daemon's
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

/**
 * The idle-timeout (ms) a daemon-owned live session is closed after with no
 * activity — a session left untouched this long is evicted so a long-lived
 * daemon doesn't accumulate abandoned sessions. A config seam to override this
 * per-deployment may land later; today it's a fixed constant.
 */
const DEFAULT_LIVE_IDLE_MS = 10 * 60_000;

export interface DaemonOptions {
  out: (line: string) => void;
  err: (line: string) => void;
  /** WAL path; its parent is created if missing. Defaults under `.coa/wal/`. */
  walPath?: string;
  /** Endpoint override; defaults to {@link defaultDaemonPath}. */
  path?: string;
  /**
   * The worktree the daemon governs; defaults to the process's working directory, which
   * is what a user running `coa serve` means. Overridable because the reconciler walks
   * and hashes this root at startup: a test that leaves it at the default boots a daemon
   * over the whole checkout, so its cost grows with the repo rather than with the test.
   */
  root?: string;
  /** How the `shutdown` verb tears the process down (injected for tests); defaults to close-then-exit. */
  onShutdown?: (server: RpcServer) => void;
}

/**
 * Start the daemon: construct the full session closure (the daemon core plus the
 * backend adapter factory), then serve both the inspector reads and the
 * session-lifecycle verbs. Handlers are built per connection so each
 * `createSession` streams its turns over the connection that opened it.
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

/**
 * The SOT projection `listModels` now serves: the user's per-provider list
 * (models.yaml, catalog-seeded), enriched by that provider's live fetch. The
 * fetch is demoted to enrichment — it can fail (degrading to shipped caps)
 * without emptying the list; an emptied list is served empty (the picker falls
 * back to the backend default — never-cage).
 */
export async function listEffectiveModels(
  catalog: ModelCatalogStore,
  models: ModelCache,
  accounts: ModelCacheAccount[],
  logErr: (line: string) => void = (line) => console.error(line),
): Promise<ModelDescriptor[]> {
  // One live list per provider (an account pins the fetch; extra accounts on the
  // same provider add nothing to the SOT projection).
  const byProvider = new Map<string, ModelCacheAccount>();
  for (const account of accounts) byProvider.set(account.provider ?? 'claude', account);
  const lists = await Promise.all(
    [...byProvider.entries()].map(async ([provider, account]) => {
      const live = await models.list(account).catch((error: unknown): ModelDescriptor[] => {
        const message = error instanceof Error ? error.message : String(error);
        logErr(`listModels: ${account.label} (${provider}) failed: ${message}`);
        return [];
      });
      return effectiveModels(provider, catalog.listFor(provider), live);
    }),
  );
  return lists.flat();
}

export async function startDaemon(options: DaemonOptions): Promise<RpcServer> {
  const path = options.path ?? defaultDaemonPath();
  const walPath = options.walPath ?? join('.coa', 'wal', 'log.ndjson');
  mkdirSync(dirname(walPath), { recursive: true });
  if (process.platform !== 'win32') mkdirSync(dirname(path), { recursive: true });

  // The session service resolves a session's spawn port, but it can't exist until
  // AFTER `buildSessionDeps` returns — and `buildSessionDeps` wants `resolveSpawn`
  // (`registry` below needs `deps.checkpoint`/`releaseWorktree`, so it can't be built
  // first either — an ordinary composition-root cycle). `resolveSpawn` reads the
  // `const`s in this same scope DIRECTLY rather than through a holder: it fires only
  // once a session is actually running a turn, long after every `const` below has
  // initialized, since no session can exist before `bindDaemon` at the end of this
  // function even accepts a connection.
  const { deps, handle, models, modelAccounts } = buildSessionDeps({
    walPath,
    root: options.root ?? process.cwd(),
    resolveSpawn: (sessionId) => sessions.spawnFor(sessionId),
  });
  // The driven-login plumbing imports the backend package, so it is built here (the
  // composition root) and injected into the login manager the handler map constructs.
  const consoleHandlers = buildDaemonConsoleHandlers(handle, {
    loginDriver: buildClaudeLoginDriver(homedir()),
  });
  // The editable per-provider model list (models.yaml) — the SOT `listModels` projects.
  const modelCatalog = new ModelCatalogStore(homedir());
  // The agent-assembly catalogue the console picker reads (starter registry today).
  const registryHandlers = buildRegistryHandlers({
    listRoles: () => roleSummaries(),
    listPackages: () => packageSummaries(),
  });
  // The agent-definition registry: built-in ∪ ~/.coa/agents ∪ <repo>/.coa/agents.
  const agentRegistry = new AgentRegistry(homedir(), process.cwd());
  const agentHandlers = buildAgentRegistryHandlers({
    listAgents: () => agentRegistry.list(),
    saveAgent: (ref, file, scope) => agentRegistry.save(ref, file, scope),
    deleteAgent: (ref, scope) => agentRegistry.remove(ref, scope),
  });
  // The persistent conversation store lives beside the WAL under the gitignored `.coa/local/`.
  const store = createConversationStore(join(process.cwd(), '.coa', 'local', 'conversation'));
  const conversationHandlers = buildConversationHandlers(store);
  // The daemon-authoritative home for every conversation's live session (the daemon,
  // not any client, owns a live session across turns),
  // constructed once — same lifetime as `store` — so two connections sharing a
  // conversation id share the one live session rather than each getting their own.
  // `onClose` is the SINGLE teardown path (live-registry.ts#close): the change-event-spine
  // checkpoint + worktree release happen exactly once here, on whichever of
  // idle-eviction / the `closeSession` verb / shutdown (`closeAll`) tears a
  // session down — never in `session-handlers.ts` directly (no double-release).
  // Idle-eviction never fires on a still-`running` session (see the  // running-aware re-arm), so this only actually releases a live adapter's
  // worktree on the explicit `closeSession` verb or shutdown — attended-v1-acceptable.
  const registry = new LiveSessionRegistry({
    idleMs: DEFAULT_LIVE_IDLE_MS,
    onClose: (s) => {
      deps.checkpoint();
      if (s.worktree !== undefined) deps.releaseWorktree(s.worktree);
    },
  });
  // The daemon's ONE owner of live-session lifetime: the drive loop, the spawn dispatch,
  // and the conversation store all hang off this single instance. A connection never owns
  // any of it — it only translates RPC into calls against this service, so a turn sent
  // over a second console reaches exactly the same machinery as the first console's.
  const sessions = new SessionService({
    deps,
    registry,
    store,
    listAgents: () => agentRegistry.list().agents,
  });
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
        // Tear down every live session/loop before scheduling the injected
        // teardown, so this runs on every daemon stop regardless of `onShutdown`.
        registry.closeAll();
        const server = bound.server;
        if (server !== undefined) setTimeout(() => onShutdown(server), 10).unref();
        return { ok: true };
      },
    },
  };
  bound.server = await bindDaemon(path, (connection) => ({
    ...consoleHandlers,
    ...registryHandlers,
    ...agentHandlers,
    ...conversationHandlers,
    ...shutdownHandlers,
    ...buildSessionHandlers(sessions, connection),
    ...buildModelHandlers(modelCatalog, MODEL_PROVIDERS),
    // The SOT projection: the user's editable list, enriched (never defined) by
    // each provider's live fetch — both pickers read this one feed.
    listModels: {
      handle: () => listEffectiveModels(modelCatalog, models, modelAccounts(), options.err),
    },
  }));
  options.out(`coa daemon listening on ${path}`);
  return bound.server;
}
