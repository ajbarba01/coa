import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { PieceRef, Producer, ProducerInput, SymbolRef } from '@coa/shared';
import { compile } from '../compiler/compile.js';
import { createGovernanceAnchorProducer } from '../context/governance-anchor.js';
import { FlagPipeline } from '../flags/pipeline.js';
import { Governance } from '../governance/governance.js';
import { ChangeKernel } from '../kernel.js';
import { Reconciler } from '../reconcile/reconciler.js';
import { buildGovernedTools, type GovernedToolDeps } from '../workbench/governed-tools.js';
import type { SpawnDeps } from '../workbench/spawn.js';
import type { BaseToolDeps } from '../workbench/base-tools.js';
import { listFilesFor } from '../workbench/file-listing.js';
import { searchWithRipgrep } from '../workbench/ripgrep.js';
import { createExec } from '../workbench/exec.js';
import { buildWebToolDeps, type WebConfig } from '../workbench/web/web-config.js';
import type { Summarizer } from '../workbench/web-tools.js';
import type { LoginDriverPort, RuntimeUsage } from '@coa/spi';
import { homedir } from 'node:os';
import { buildConsoleHandlers } from '../rpc/console-handlers.js';
import { resolveShell } from './shell.js';
import { buildAuthHandlers } from '../rpc/auth-handlers.js';
import { AccountsRegistry } from '../auth/registry.js';
import { LoginManager } from '../auth/login-manager.js';
import { WebConfigStore } from '../workbench/web/web-config-store.js';
import { KeyStateStore } from '../workbench/web/key-state-store.js';
import { ConsoleStateStore } from '../console/console-state-store.js';
import { BrowserSession } from '../auth/browser-session.js';
import type { RpcHandlers } from '../rpc/router.js';
import type { DaemonCore } from './composition.js';

/**
 * The daemon composition root — construct the daemon-singleton core once, in
 * dependency order (the change-event spine as kernel → the flag pipeline → cost governance, with prompt compile +
 * governed tool catalogue bound by reference). Returns the {@link DaemonCore} the
 * session wiring consumes plus the live singletons, so the daemon host can read
 * projections and drive the worktree/conversation layers as they are built. The
 * backend is constructed per session, outside this root.
 */
export interface DaemonCoreOptions {
  /** The WAL path (the change-event spine) — its parent directory must exist. */
  walPath: string;
  /** The worktree root for git operations; defaults to the process cwd. */
  root?: string;
  /** The session's configured tool baseline for the sandbox policy. */
  allowedTools?: string[];
  /** The flag producers (injected) to register and drive off the kernel feed. */
  producers?: readonly Producer[];
  /**
   * The web-egress config (credential-gated); when present and a key resolves,
   * `baseCatalogue` gains `WebSearch`/`WebFetch` (absent/unresolved ⇒ the
   * tools are simply not offered).
   */
  web?: WebConfig;
  /**
   * Compose the WebFetch summarizer from the web config — the composition root owns
   * the provider-specific `complete()`, so the backend package never enters core.
   * Handed the ledger's cost recorder. Absent, or returning `undefined`, ⇒ the
   * raw-markdown floor (WebFetch is still offered; nothing is summarized).
   */
  summarizer?: (deps: { recordCost: (usage: RuntimeUsage) => void }) => Summarizer | undefined;
}

export interface DaemonCoreHandle {
  core: DaemonCore;
  kernel: ChangeKernel;
  flags: FlagPipeline;
  governance: Governance;
}

/** Construct the daemon singletons and bind them into a {@link DaemonCore}. */
export function createDaemonCore(options: DaemonCoreOptions): DaemonCoreHandle {
  const kernel = new ChangeKernel({ walPath: options.walPath });
  const governance = new Governance({
    ...(options.allowedTools !== undefined ? { allowedTools: options.allowedTools } : {}),
  });
  const flags = new FlagPipeline();
  const governanceAnchor = createGovernanceAnchorProducer({
    governedByEdges: () => kernel.graph.governedByEdges(),
    isRegistered: (id) => flags.registeredProducer(id) !== undefined,
  });
  wireProducers(kernel, flags, [...(options.producers ?? []), governanceAnchor]);

  // Producer ②. The class shipped with tests but was never constructed anywhere,
  // so a change made by a tool coa does not execute itself — a native Edit, or anything a
  // Bash command touches — reached the change-event spine on no backend. `reconcile()` scopes dirty paths with
  // git, dedups coa's own precise writes into a `confirm`, and respects .gitignore, so a
  // backend only has to trigger it.
  //
  // Constructed EAGERLY and guarded. Eagerly because the constructor seeds each tracked
  // file's prior hash from `git ls-files`, and that baseline is what makes a later edit
  // read as a transition: deferring construction to the first tool call would seed the
  // baseline from already-modified disk, so the first edit to a tracked file would show
  // no change at all. Guarded because `git ls-files` throws outside a git worktree — coa
  // must work on any project (no-lock-in) and producer ② is an enhancement, so a non-git
  // root degrades to a no-op rather than breaking every session. A later failure
  // latches the same way, so a broken git does not respawn a process per tool call.
  let reconciler: Reconciler | undefined;
  try {
    reconciler = new Reconciler({
      worktree: 'main',
      root: options.root ?? '.',
      emit: (draft) => {
        kernel.emit(draft);
      },
    });
  } catch {
    reconciler = undefined;
  }
  const observeChanges = (): void => {
    if (reconciler === undefined) return;
    try {
      reconciler.reconcile();
    } catch {
      reconciler = undefined;
    }
  };

  const core: DaemonCore = {
    checkpoint: () => {
      kernel.checkpoint();
    },
    observeChanges,
    perToolDeny: (tool, input) => flags.perToolDeny(tool, input),
    gate: () => flags.gate(),
    capState: () => governance.capState(),
    charge: (sessionId, costUsd) => governance.charge(sessionId, costUsd),
    record: (event) => governance.record(event),
    sandboxPolicy: (ctx) => governance.sandboxPolicy(ctx),
    compile: (pieces, frame) => {
      const { config, findings } = compile(pieces, frame, {
        isRegistered: (id) => flags.registeredProducer(id) !== undefined,
        hasGeneratedFrom: (name) =>
          kernel.graph.outEdges(name).some((edge) => edge.type === 'generated-from'),
      });
      for (const finding of findings) flags.ingest(finding); // schema coercions are feed items, never silent
      return config;
    },
    catalogue: buildGovernedTools(governedToolDeps(kernel, governance, flags, options.root ?? '.')),
    baseCatalogue: buildBaseCatalogue(kernel, governance, flags, options),
    catalogueFor: (sessionId, spawn) =>
      buildGovernedTools(
        governedToolDeps(kernel, governance, flags, options.root ?? '.', sessionId, spawn),
      ),
    baseCatalogueFor: (sessionId, spawn) =>
      buildBaseCatalogue(kernel, governance, flags, options, sessionId, spawn),
  };

  return { core, kernel, flags, governance };
}

/** The backend plumbing the console handlers consume but core must not construct itself. */
export interface DaemonConsoleDeps {
  /**
   * The rented CLI's driven-login plumbing (pty spawn + auth probe), built by the
   * composition root over the backend package. Absent ⇒ no login manager is
   * constructed and every login verb degrades to its idle floor (auth reads,
   * account verbs, and key management still work).
   */
  loginDriver?: LoginDriverPort;
}

/**
 * Bind the daemon's live singletons to the read-only inspector handler map the
 * JSON-RPC router serves — the seam between the daemon core and the console's
 * CON-CAT reads. Pure projection wiring: each port reads an existing surface
 * (cost state, flag user feed), no new behavior. The transport layer
 * (socket/pipe + peer-cred) calls `dispatch(message, handlers)` with this map.
 */
export function buildDaemonConsoleHandlers(
  handle: DaemonCoreHandle,
  deps: DaemonConsoleDeps = {},
): RpcHandlers {
  const accounts = new AccountsRegistry(homedir());
  const consoleState = new ConsoleStateStore(homedir());
  // The one place the three isolation facts meet: the user's setting, the provider's
  // declared capability, and what browser this machine actually has.
  const browser = new BrowserSession({
    home: homedir(),
    platform: process.platform,
    env: process.env,
    settings: () => {
      const state = consoleState.read();
      return {
        enabled: state.isolatedBrowserLogins,
        ...(state.browserPath !== undefined ? { browserPath: state.browserPath } : {}),
      };
    },
  });
  const loginManager =
    deps.loginDriver === undefined
      ? undefined
      : new LoginManager(accounts, deps.loginDriver, {
          browserSession: {
            launcherFor: (email) => browser.launcherFor('claude', email),
            // Fire-and-forget: the open waits briefly for the shim's relayed url, and a login
            // must never block on a browser window.
            openUrl: (email, url) => void browser.openUrl('claude', email, url),
            removeProfile: (email) => browser.removeProfile(email),
          },
        });
  return {
    ...buildConsoleHandlers({
      capState: (sessionId) => handle.governance.capState(sessionId),
      flagsForUser: (scope) => handle.flags.flagsForUser(scope),
      listTimeline: () => handle.kernel.listTimeline(),
    }),
    ...buildAuthHandlers({
      accounts,
      web: new WebConfigStore(homedir()),
      keys: new KeyStateStore(homedir()),
      console: consoleState,
      ...(loginManager !== undefined ? { loginManager } : {}),
      browser,
    }),
  };
}

/** The sweep scope for a reconciling producer's full-set recompute (any non-golden scope). */
const RECONCILE_SWEEP: ProducerInput = { kind: 'scope', scope: '' };

/**
 * Register context assembly's producers into the flag pipeline (each gated by the CF-6 `validateProducer`
 * stamp inside `registerProducer`) and drive them off the kernel feed: the flag pipeline is a
 * projection-owning consumer, so it subscribes **from cursor 0** (replay-from-0)
 * and every change-event — historical on replay, then live — runs each producer
 * over `{ kind: 'change', event }`, ingesting the flags it emits. With no
 * producers configured the pipeline stays inert (the strict-superset floor:
 * the gate allows and no flag fires). Each producer's own `run` decides whether
 * the event is relevant; coarse activation-label filtering is a later optimization.
 *
 * A **reconciling** producer (rebuild-to-follow) is driven differently: it emits
 * its complete current set, so the driver tracks the fingerprints it last emitted
 * (per producer) and resolves any it no longer emits — the self-heal. A one-shot
 * convergence sweep runs it at wiring so dangling state already present at startup
 * surfaces even with no change events. Per-producer tracking keeps the diff scoped
 * to that producer, never touching another's flags.
 */
function wireProducers(
  kernel: ChangeKernel,
  flags: FlagPipeline,
  producers: readonly Producer[],
): void {
  if (producers.length === 0) return;
  for (const producer of producers) flags.registerProducer(producer);

  const lastEmitted = new Map<string, Set<string>>();
  const drive = (producer: Producer, input: ProducerInput): void => {
    if (producer.reconciling !== true) {
      flags.runProducer(producer.id, input);
      return;
    }
    const fresh = producer.run(input);
    for (const flag of fresh) flags.ingest(flag);
    const freshFps = new Set(fresh.map((flag) => flag.fingerprint));
    for (const fp of lastEmitted.get(producer.id) ?? []) {
      if (!freshFps.has(fp)) flags.resolve(fp);
    }
    lastEmitted.set(producer.id, freshFps);
  };

  for (const producer of producers) {
    if (producer.reconciling === true) drive(producer, RECONCILE_SWEEP);
  }
  kernel.subscribe(0, (event) => {
    for (const producer of producers) drive(producer, { kind: 'change', event });
  });
}

/** Resolve a Piece, degrading a missing/ambiguous ref to `undefined` (degrade gracefully, never a throw). */
function resolvePieceSafely(kernel: ChangeKernel, ref: PieceRef) {
  try {
    return kernel.resolvePiece(ref);
  } catch {
    return undefined;
  }
}

/**
 * Wire the governed tools to the live daemon singletons: Retrieve/enrich read
 * the resident kernel index/graph, Mutate routes writes through the kernel spine
 * (producer ①) and the worktree's disk, and Inspect reads the cost governor's cap and the flag pipeline's
 * flag pipeline. The not-yet-built halves degrade to a floor:
 * the graph outline/dependents reads, the assembled-context/spec store, and
 * the reconciler's precise-write expectation. The worktree is the configured root
 * (the per-session worktree manager is later); confinement runs in POSIX path
 * space, so the root is normalized to forward slashes.
 *
 * `sessionId`/`spawn` default to the pre-existing daemon-wide floor (a constant
 * `'daemon'` stamp, no spawn port) so the ONE shared catalogue built at daemon
 * startup is unchanged; `catalogueFor`/`baseCatalogueFor` (composition.ts) pass the
 * real per-session values when a session-scoped catalogue is being derived.
 */
function governedToolDeps(
  kernel: ChangeKernel,
  governance: Governance,
  flags: FlagPipeline,
  root: string,
  sessionId = 'daemon',
  spawn?: SpawnDeps,
): GovernedToolDeps {
  const worktreeRoot = root.replace(/\\/g, '/');
  return {
    sessionId,
    ...(spawn !== undefined ? { spawn } : {}),
    retrieve: {
      worktreeRoot,
      lookupSymbol: (name) => kernel.lookup(name),
      outline: () => [],
      references: () => [],
      resolvePiece: (ref) => resolvePieceSafely(kernel, ref),
    },
    mutate: {
      worktreeRoot,
      worktree: 'main',
      readFile: (absolutePath) => readFileSync(absolutePath, 'utf8'),
      writeFile: (absolutePath, bytes) => writeFileSync(absolutePath, bytes),
      emit: (draft) => kernel.emit(draft),
      resolveFile: (ref: SymbolRef) =>
        'name' in ref ? kernel.lookup(ref.name)?.definedIn : ref.path,
    },
    inspect: {
      runChecks: (scope) => flags.flagsForUser(scope),
      capState: () => governance.capState(),
    },
    enrich: {
      flagsForAgent: (scope) => flags.flagsForAgent(scope),
    },
  };
}

/**
 * Build the pure-API catalogue: governance + base tools, plus the web tools
 * (`WebSearch`/`WebFetch`) whenever `options.web` is configured — the free
 * floor guarantees `buildWebToolDeps` always returns deps in that case,
 * so `includeWebTools` is set whenever a `web` block is present. WebFetch's
 * summarizer comes from the injected factory (`options.summarizer`), handed the
 * ledger's cost recorder; an absent factory or an `undefined` return degrades to
 * raw markdown. Summarizer spend is audited (recorded to the ledger) but not
 * charged to the session spend counter — a deliberate deferral.
 */
function buildBaseCatalogue(
  kernel: ChangeKernel,
  governance: Governance,
  flags: FlagPipeline,
  options: DaemonCoreOptions,
  sessionId = 'daemon',
  spawn?: SpawnDeps,
) {
  const summarizer = options.web
    ? options.summarizer?.({
        recordCost: (usage) => governance.record({ scope: 'web_fetch_summarizer', ...usage }),
      })
    : undefined;
  const web = options.web
    ? buildWebToolDeps(options.web, process.env, { ...(summarizer ? { summarizer } : {}) })
    : undefined;
  return buildGovernedTools(
    {
      ...governedToolDeps(kernel, governance, flags, options.root ?? '.', sessionId, spawn),
      base: baseToolDeps(kernel, options.root ?? '.'),
      ...(web ? { web } : {}),
    },
    { includeBaseTools: true, ...(web ? { includeWebTools: true } : {}) },
  );
}

/**
 * Wire the pure-API base-tool ports (Read/Glob/Grep/Write/Edit/Bash) to the real disk +
 * process implementations the workbench owns. Mirrors `governedToolDeps` — same
 * kernel, same forward-slash-normalized worktree root.
 */
function baseToolDeps(kernel: ChangeKernel, root: string): BaseToolDeps {
  const worktreeRoot = root.replace(/\\/g, '/');
  // Resolve the Bash shell once per session: Git Bash on Windows when present, so the
  // model's POSIX one-liners run against a POSIX shell instead of cmd.exe (Claude Code parity).
  const { shell } = resolveShell({
    platform: process.platform,
    env: process.env,
    fileExists: existsSync,
  });
  return {
    worktreeRoot,
    worktree: 'main',
    readFile: (absolutePath) => readFileSync(absolutePath, 'utf8'),
    writeFile: (absolutePath, bytes) => writeFileSync(absolutePath, bytes),
    fileExists: (absolutePath) => existsSync(absolutePath),
    listFiles: (pattern, baseAbsolute) => listFilesFor(pattern, baseAbsolute, worktreeRoot),
    searchFiles: (req) => searchWithRipgrep(req),
    exec: createExec(shell),
    emit: (draft) => kernel.emit(draft),
  };
}
