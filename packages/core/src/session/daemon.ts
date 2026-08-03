import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import { globSync } from 'tinyglobby';
import type { PieceRef, Producer, ProducerInput, SymbolRef } from '@coa/shared';
import { compile } from '../compiler/compile.js';
import { createGovernanceAnchorProducer } from '../context/governance-anchor.js';
import { FlagPipeline } from '../flags/pipeline.js';
import { Governance } from '../governance/governance.js';
import { ChangeKernel } from '../kernel.js';
import { Reconciler } from '../reconcile/reconciler.js';
import { buildGovernedTools, type GovernedToolDeps } from '../workbench/governed-tools.js';
import type { BaseToolDeps } from '../workbench/base-tools.js';
import { buildWebToolDeps, type WebConfig } from '../workbench/web/web-config.js';
import { makeDeepSeekComplete } from '@coa/adapter-deepseek';
import { makeSummarizer } from '../workbench/web/summarizer.js';
import type { Summarizer } from '../workbench/web-tools.js';
import type { Locator } from '@coa/shared';
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
import { managedLoginDir, probeAuthStatus, spawnLogin, extractOauthUrl } from '@coa/adapter-claude-sdk';

/**
 * M8 composition root (R-1) — construct the daemon-singleton core once, in
 * dependency order (M1 the kernel → M3 flags → M7 governance, with M5 compile +
 * M6 catalogue bound by reference). The kernel is the governance producer spine
 * (M7 writes through `appendGovernance`). Returns the {@link DaemonCore} the
 * session wiring consumes plus the live singletons, so the daemon host can read
 * projections and drive the worktree/conversation layers as they are built. The
 * backend (M9) is constructed per session, outside this root.
 */
export interface DaemonCoreOptions {
  /** The WAL path (M1) — its parent directory must exist. */
  walPath: string;
  /** The worktree root for git operations; defaults to the process cwd. */
  root?: string;
  /** The SQLite projection path; defaults to in-memory. */
  projectionPath?: string;
  /** The API-route hard ceiling in USD; omitted ⇒ subscription model (no ceiling). */
  ceilingUsd?: number;
  /** The session's configured tool baseline for the sandbox policy. */
  allowedTools?: string[];
  /** The M3 producers (M4's, injected) to register and drive off the kernel feed (R-3). */
  producers?: readonly Producer[];
  /**
   * The web-egress config (credential-gated); when present and a key resolves,
   * `baseCatalogue` gains `WebSearch`/`WebFetch` (D85 — absent/unresolved ⇒ the
   * tools are simply not offered).
   */
  web?: WebConfig;
}

export interface DaemonCoreHandle {
  core: DaemonCore;
  kernel: ChangeKernel;
  flags: FlagPipeline;
  governance: Governance;
}

/** Construct the daemon singletons and bind them into a {@link DaemonCore}. */
export function createDaemonCore(options: DaemonCoreOptions): DaemonCoreHandle {
  const kernel = new ChangeKernel({
    walPath: options.walPath,
    ...(options.root !== undefined ? { root: options.root } : {}),
    ...(options.projectionPath !== undefined ? { projectionPath: options.projectionPath } : {}),
  });
  const governance = new Governance(kernel, {
    ...(options.ceilingUsd !== undefined ? { ceilingUsd: options.ceilingUsd } : {}),
    ...(options.allowedTools !== undefined ? { allowedTools: options.allowedTools } : {}),
  });
  const flags = new FlagPipeline();
  const governanceAnchor = createGovernanceAnchorProducer({
    governedByEdges: () => kernel.graph.governedByEdges(),
    isRegistered: (id) => flags.registeredProducer(id) !== undefined,
  });
  wireProducers(kernel, flags, [...(options.producers ?? []), governanceAnchor]);

  // Producer ② (D123). The class shipped with tests but was never constructed anywhere,
  // so a change made by a tool coa does not execute itself — a native Edit, or anything a
  // Bash command touches — reached M1 on no backend. `reconcile()` scopes dirty paths with
  // git, dedups coa's own precise writes into a `confirm`, and respects .gitignore, so a
  // backend only has to trigger it.
  //
  // Constructed EAGERLY and guarded. Eagerly because the constructor seeds each tracked
  // file's prior hash from `git ls-files`, and that baseline is what makes a later edit
  // read as a transition: deferring construction to the first tool call would seed the
  // baseline from already-modified disk, so the first edit to a tracked file would show
  // no change at all. Guarded because `git ls-files` throws outside a git worktree — coa
  // must work on any project (no-lock-in) and producer ② is an enhancement, so a non-git
  // root degrades to a no-op rather than breaking every session (D85). A later failure
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
      for (const finding of findings) flags.ingest(finding); // TAX-4 coercions are feed items, never silent
      return config;
    },
    catalogue: buildGovernedTools(governedToolDeps(kernel, governance, flags, options.root ?? '.')),
    baseCatalogue: buildBaseCatalogue(kernel, governance, flags, options),
  };

  return { core, kernel, flags, governance };
}

/**
 * Bind the daemon's live singletons to the read-only inspector handler map the
 * JSON-RPC router serves — the seam between the daemon core and the console's
 * CON-CAT reads. Pure projection wiring: each port reads an existing surface
 * (M7 cap + Decision log, M3 user feed), no new behavior. The transport layer
 * (socket/pipe + peer-cred) calls `dispatch(message, handlers)` with this map.
 */
export function buildDaemonConsoleHandlers(handle: DaemonCoreHandle): RpcHandlers {
  const accounts = new AccountsRegistry(homedir());
  const consoleState = new ConsoleStateStore(homedir());
  // The one place the three isolation facts meet: the user's setting, the provider's
  // declared capability, and what browser this machine actually has (docs/adr/0018).
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
  const loginManager = new LoginManager(
    accounts,
    {
      home: homedir(),
      dirFor: (email) => managedLoginDir(homedir(), email),
      probe: async (dir) => {
        // Rebuild by omission (exactOptionalPropertyTypes) — the probe's zod-inferred
        // `AuthStatus` allows an explicit `undefined` per optional field and carries
        // `orgName`, neither of which the driver port's narrower shape accepts.
        const status = await probeAuthStatus(dir);
        if (status === undefined) return undefined;
        return {
          loggedIn: status.loggedIn,
          ...(status.email !== undefined ? { email: status.email } : {}),
          ...(status.subscriptionType !== undefined ? { subscriptionType: status.subscriptionType } : {}),
        };
      },
      start: ({ dir, email, browserLauncher }) => {
        const proc = spawnLogin({
          dir,
          email,
          ...(browserLauncher !== undefined ? { browserLauncher } : {}),
        });
        return {
          onUrl: (fn) =>
            proc.onData((chunk) => {
              const url = extractOauthUrl(chunk);
              if (url !== undefined) fn(url);
            }),
          onExit: (fn) => proc.onExit(fn),
          writeCode: (code) => proc.write(`${code}\r`),
          kill: () => proc.kill(),
          get ptyCaptured() {
            return proc.ptyCaptured;
          },
        };
      },
    },
    {
      browserSession: {
        launcherFor: (email) => browser.launcherFor('claude', email),
        // Fire-and-forget: the open waits briefly for the shim's relayed url, and a login
        // must never block on a browser window (docs/adr/0020).
        openUrl: (email, url) => void browser.openUrl('claude', email, url),
        removeProfile: (email) => browser.removeProfile(email),
      },
    },
  );
  return {
    ...buildConsoleHandlers({
      capState: (sessionId) => handle.governance.capState(sessionId),
      flagsForUser: (scope) => handle.flags.flagsForUser(scope),
      readDecision: (id) => handle.governance.decisionLog.read(id),
      decisionsByTarget: (target) => handle.governance.decisionLog.findByTarget(target),
      listTimeline: () => handle.kernel.listTimeline(),
    }),
    ...buildAuthHandlers({
      accounts,
      web: new WebConfigStore(homedir()),
      keys: new KeyStateStore(homedir()),
      console: consoleState,
      loginManager,
      browser,
    }),
  };
}

/** The sweep scope for a reconciling producer's full-set recompute (any non-golden scope). */
const RECONCILE_SWEEP: ProducerInput = { kind: 'scope', scope: '' };

/**
 * R-3 — register M4's producers into M3 (each gated by the CF-6 `validateProducer`
 * stamp inside `registerProducer`) and drive them off the kernel feed: M3 is a
 * projection-owning consumer, so it subscribes **from cursor 0** (replay-from-0)
 * and every change-event — historical on replay, then live — runs each producer
 * over `{ kind: 'change', event }`, ingesting the flags it emits. With no
 * producers configured the pipeline stays inert (the D85 strict-superset floor:
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

/** Resolve a Piece, degrading a missing/ambiguous ref to `undefined` (SC-1, never a throw). */
function resolvePieceSafely(kernel: ChangeKernel, ref: PieceRef) {
  try {
    return kernel.resolvePiece(ref);
  } catch {
    return undefined;
  }
}

/**
 * Wire M6's governed tools to the live daemon singletons: Retrieve/enrich read
 * the resident kernel index/graph, Mutate routes writes through the kernel spine
 * (producer ①) and the worktree's disk, and Inspect reads M7's cap + Decision
 * log and M3's flag pipeline. The not-yet-built halves degrade to a floor (D85):
 * the graph outline/dependents reads, the M4 assembled-context/spec store, and
 * the reconciler's precise-write expectation. The worktree is the configured root
 * (the per-session worktree manager is later); confinement runs in POSIX path
 * space, so the root is normalized to forward slashes.
 */
function governedToolDeps(
  kernel: ChangeKernel,
  governance: Governance,
  flags: FlagPipeline,
  root: string,
): GovernedToolDeps {
  const worktreeRoot = root.replace(/\\/g, '/');
  return {
    sessionId: 'daemon',
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
      decisionsByTarget: (target) => governance.decisionLog.findByTarget(target),
      readDecision: (id) => governance.decisionLog.read(id),
    },
    enrich: {
      oracle: {
        lookup: (name) => kernel.lookup(name),
        fuzzyMatch: (name, limit) => kernel.fuzzyMatch(name, limit),
        walPosition: () => kernel.walPosition(),
      },
      flagsForAgent: (scope) => flags.flagsForAgent(scope),
    },
  };
}

/**
 * Wire the pure-API base-tool ports (Read/Glob/Grep/Write/Edit/Bash) to real disk +
 * process I/O: `@vscode/ripgrep`'s bundled binary backs `searchFiles`, `tinyglobby`
 * backs `listFiles`, and `exec` wraps `spawnSync` so a spawn failure degrades to a
 * non-zero exit rather than throwing (SC-1). Mirrors `governedToolDeps` — same
 * kernel, same forward-slash-normalized worktree root.
 */
/** Always-ignored noise, regardless of the worktree's `.gitignore` (S-1-adjacent: keeps tool results sane). */
const ALWAYS_IGNORE_GLOBS: readonly string[] = ['**/node_modules/**', '**/.git/**'];

/**
 * Translate `.gitignore` lines into `tinyglobby` `ignore` globs. A reasonable, not
 * exhaustive, translation: comments (`#…`) and blank lines are dropped; a
 * leading-slash (root-anchored) entry becomes a root-relative glob; a bare or
 * trailing-slash directory name becomes a recursive "anywhere under a dir named
 * this" ignore; anything else (e.g. `*.log`) passes through unchanged. Never throws.
 */
export function gitignoreToIgnoreGlobs(lines: readonly string[]): string[] {
  const globs: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (line.startsWith('/')) {
      const rest = line.slice(1).replace(/\/$/, '');
      globs.push(`${rest}/**`);
      continue;
    }
    if (line.endsWith('/')) {
      globs.push(`**/${line.slice(0, -1)}/**`);
      continue;
    }
    if (!line.includes('/') && !line.includes('*') && !line.includes('.')) {
      // A bare name with no extension-like dot or glob char: treat as a directory name.
      globs.push(`**/${line}/**`);
      continue;
    }
    globs.push(line);
  }
  return globs;
}

/** Read `<worktreeRoot>/.gitignore` (if present) and merge it with the always-ignore set. Never throws. */
function ignoreGlobsFor(worktreeRoot: string): string[] {
  try {
    const text = readFileSync(join(worktreeRoot, '.gitignore'), 'utf8');
    return [...ALWAYS_IGNORE_GLOBS, ...gitignoreToIgnoreGlobs(text.split('\n'))];
  } catch {
    return [...ALWAYS_IGNORE_GLOBS];
  }
}

/**
 * The `listFiles` port body: glob under `baseAbsolute`, excluding node_modules/.git
 * plus anything the worktree's `.gitignore` names. Exported for focused unit
 * testing without a full `baseToolDeps`/kernel setup.
 */
export function listFilesFor(
  pattern: string,
  baseAbsolute: string,
  worktreeRoot?: string,
): string[] {
  const ignore = ignoreGlobsFor(worktreeRoot ?? baseAbsolute);
  return globSync(pattern, { cwd: baseAbsolute, absolute: true, dot: false, ignore });
}

/**
 * Build the pure-API catalogue: governance + base tools, plus the web tools
 * (`WebSearch`/`WebFetch`) whenever `options.web` is configured — the free
 * floor (D85) guarantees `buildWebToolDeps` always returns deps in that case,
 * so `includeWebTools` is set whenever a `web` block is present. WebFetch's
 * summarizer is composed here from `web.fetch.summarizer` (a DeepSeek
 * `complete()` bound to a cheap model) and injected as `opts.summarizer`;
 * absent config or an unresolved key degrades to `undefined` (raw markdown).
 */
function buildBaseCatalogue(
  kernel: ChangeKernel,
  governance: Governance,
  flags: FlagPipeline,
  options: DaemonCoreOptions,
) {
  const summarizer = options.web ? buildFetchSummarizer(options.web, governance) : undefined;
  const web = options.web
    ? buildWebToolDeps(options.web, process.env, { ...(summarizer ? { summarizer } : {}) })
    : undefined;
  return buildGovernedTools(
    {
      ...governedToolDeps(kernel, governance, flags, options.root ?? '.'),
      base: baseToolDeps(kernel, options.root ?? '.'),
      ...(web ? { web } : {}),
    },
    { includeBaseTools: true, ...(web ? { includeWebTools: true } : {}) },
  );
}

/**
 * Compose the WebFetch summarizer (§5) from `web.fetch.summarizer`: a minimal
 * `makeSummarizer` over the DeepSeek `complete()` primitive, model config-driven,
 * cost recorded to the M7 ledger. Absent config or an unresolved key ⇒ `undefined`
 * (D85 raw-markdown floor). Runs only on non-clean content (the handler decides).
 */
export function buildFetchSummarizer(
  web: WebConfig,
  governance: Governance,
): Summarizer | undefined {
  const cfg = web.fetch?.summarizer;
  if (cfg === undefined || cfg.provider !== 'deepseek') return undefined;
  const apiKey = resolveEnvVar(cfg.credential);
  if (apiKey === undefined) return undefined;
  return makeSummarizer({
    complete: makeDeepSeekComplete({ apiKey, model: cfg.model }),
    // Audited (ledger) but NOT charged to the M7 cost-cap this increment — a scoped deferral (see spec Deferred + OPEN.md).
    recordCost: (usage) => governance.record({ scope: 'web_fetch_summarizer', ...usage }),
  });
}

/** Resolve an env-var locator against `process.env`; other kinds ⇒ `undefined` (env-only for now). */
function resolveEnvVar(locator: Locator): string | undefined {
  if (locator.type !== 'env-var') return undefined;
  const value = process.env[locator.name];
  return value !== undefined && value !== '' ? value : undefined;
}

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
    searchFiles: ({ pattern, baseAbsolute, glob, mode }) => {
      const args = [
        mode === 'files' ? '--files-with-matches' : '--line-number',
        ...(glob ? ['--glob', glob] : []),
        '--',
        pattern,
        baseAbsolute,
      ];
      const out = spawnSync(rgPath, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      const lines = (out.stdout ?? '').split('\n').filter((line) => line.length > 0);
      if (mode === 'files') return lines.map((file) => ({ file: file.replace(/\\/g, '/') }));
      return lines.map((line) => {
        const m = /^(.*?):(\d+):(.*)$/.exec(line);
        return m && m[1] !== undefined && m[2] !== undefined && m[3] !== undefined
          ? { file: m[1].replace(/\\/g, '/'), line: Number(m[2]), text: m[3] }
          : { file: line.replace(/\\/g, '/') };
      });
    },
    exec: (command, opts) => {
      const out = spawnSync(command, {
        cwd: opts.cwd,
        shell,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
      });
      return {
        stdout: out.stdout ?? '',
        stderr: out.stderr ?? (out.error ? String(out.error.message) : ''),
        exitCode: out.status ?? (out.error ? -1 : 0),
      };
    },
    emit: (draft) => kernel.emit(draft),
  };
}
