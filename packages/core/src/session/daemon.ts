import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { FlagRecord, PieceRef, Producer, ProducerInput, SymbolRef } from '@coa/shared';
import { compile } from '../compiler/compile.js';
import { createGovernanceAnchorProducer } from '../context/governance-anchor.js';
import { FlagPipeline } from '../flags/pipeline.js';
import { Governance } from '../governance/governance.js';
import { ChangeKernel } from '../kernel.js';
import { Reconciler } from '../reconcile/reconciler.js';
import { buildGovernedTools, type GovernedToolDeps } from '../workbench/governed-tools.js';
import type { MessagingDeps } from '../workbench/messaging.js';
import type { SpawnDeps } from '../workbench/spawn.js';
import type { BaseToolDeps } from '../workbench/base-tools.js';
import { listFilesFor } from '../workbench/file-listing.js';
import { searchWithRipgrep } from '../workbench/ripgrep.js';
import { createExec } from '../workbench/exec.js';
import type { WebToolDeps } from '../workbench/web-tools.js';
import type { RuntimeUsage } from '@coa/spi';
import { resolveShell } from './shell.js';
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
   * Build the credential-gated web egress (`WebSearch`/`WebFetch`). The composition
   * root owns the user's key config, the environment it resolves credentials from,
   * and the summarizer's provider-specific `complete()` — so neither the backend
   * package nor the process environment enters core. Handed the ledger's cost
   * recorder for the summarizer's spend.
   *
   * Absent, or returning `undefined`, ⇒ the two tools are simply not offered (the
   * floor for a user who has configured no web keys). Deps that carry no summarizer
   * still offer WebFetch on its raw-markdown floor — no summarizer is a degradation,
   * never an error.
   */
  webTools?: (deps: { recordCost: (usage: RuntimeUsage) => void }) => WebToolDeps | undefined;
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
  // root degrades to a no-op rather than breaking every session.
  //
  // A failure HERE is the expected floor on a project that is not under git, so it is
  // quiet: there is nothing to tell anyone about a feature that was never going to run.
  // A failure once we are running is the opposite — observation was working and stopped,
  // which the person at the keyboard cannot see, since the symptom is only that changes
  // made outside coa's tools stop being recorded. See {@link observeChanges}.
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
  let consecutiveFailures = 0;
  const observeChanges = (): void => {
    if (reconciler === undefined) return;
    try {
      reconciler.reconcile();
      // A scan that got through clears the streak — the point of tolerating failures is
      // that the usual causes are momentary, so they must not accumulate toward a latch
      // across an otherwise healthy session.
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      // The everyday causes here clear on their own — a git index lock held by another
      // command, a file disappearing under the scan — so a scan is retried on the next
      // tool call rather than ending observation on the first stumble. Past the streak
      // it is treated as durable and latched off, because re-running a scan that keeps
      // failing spawns a git process per tool call for nothing.
      if (consecutiveFailures < RECONCILE_FAILURE_TOLERANCE) return;
      reconciler = undefined;
      flags.ingest(reconcilerStopped(options.root ?? '.', consecutiveFailures, error));
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
    catalogueFor: (sessionId, spawn, worktreeRoot, messaging) =>
      buildGovernedTools(
        governedToolDeps(
          kernel,
          governance,
          flags,
          worktreeRoot ?? options.root ?? '.',
          sessionId,
          spawn,
          messaging,
        ),
      ),
    baseCatalogueFor: (sessionId, spawn, worktreeRoot, messaging) =>
      buildBaseCatalogue(
        kernel,
        governance,
        flags,
        options,
        sessionId,
        spawn,
        worktreeRoot,
        messaging,
      ),
  };

  return { core, kernel, flags, governance };
}

/** The sweep scope for a reconciling producer's full-set recompute (any non-golden scope). */
const RECONCILE_SWEEP: ProducerInput = { kind: 'scope', scope: '' };

/** How many scans in a row may fail before file-change observation is latched off.
 *  Small on purpose: enough to ride out a lock or a mid-scan delete, not enough to
 *  keep paying for a scan that is never going to work again. */
const RECONCILE_FAILURE_TOLERANCE = 3;

/** The one concern the stopped observer reports under, so a re-ingest replaces it. */
const RECONCILER_STOPPED_CONCERN = 'reconciler-stopped';

/**
 * The user-visible notice that file-change observation has stopped. Type 2 (advisory):
 * it is a report that coverage was lost, and nothing about it should ever stop work —
 * the session keeps running, exactly as it does on a project with no git at all. It
 * rides the same flag feed the compile path's findings do, so it lands in the console's
 * flags feed without a second channel.
 */
function reconcilerStopped(root: string, failures: number, error: unknown): FlagRecord {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    ruleId: 'daemon:reconciler-stopped',
    location: root,
    severity: 'high',
    message: `File-change observation stopped after ${failures} failed scans — edits made outside coa's own tools are no longer being recorded for this session. Last failure: ${detail}`,
    fingerprint: RECONCILER_STOPPED_CONCERN,
    type: 2,
    confidence: 'high',
    concernKey: RECONCILER_STOPPED_CONCERN,
  };
}

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
 * the reconciler's precise-write expectation. `root` defaults to the daemon's
 * configured project root, but a caller passing its own (`catalogueFor`/
 * `baseCatalogueFor`, from a session's bound worktree) confines to that instead —
 * what lets an isolated session's Retrieve/Mutate/base tools genuinely operate
 * against its own git worktree; confinement runs in POSIX path space, so `root`
 * is normalized to forward slashes either way. The kernel's own symbol/graph
 * index stays project-wide regardless (reads may drift once an isolated
 * worktree's edits diverge from the shared tree — an accepted floor, not solved
 * here).
 *
 * `sessionId`/`spawn`/`messaging` default to the pre-existing daemon-wide floor (a
 * constant `'daemon'` stamp, no spawn or messaging port) so the ONE shared catalogue
 * built at daemon startup is unchanged; `catalogueFor`/`baseCatalogueFor`
 * (composition.ts) pass the real per-session values when a session-scoped catalogue is
 * being derived.
 */
function governedToolDeps(
  kernel: ChangeKernel,
  governance: Governance,
  flags: FlagPipeline,
  root: string,
  sessionId = 'daemon',
  spawn?: SpawnDeps,
  messaging?: MessagingDeps,
): GovernedToolDeps {
  const worktreeRoot = root.replace(/\\/g, '/');
  return {
    sessionId,
    ...(spawn !== undefined ? { spawn } : {}),
    ...(messaging !== undefined ? { messaging } : {}),
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
 * (`WebSearch`/`WebFetch`) whenever the injected `webTools` factory yields deps —
 * an absent factory or an `undefined` return leaves the two tools off the
 * catalogue, which is the floor for a user with no web keys configured. The
 * factory is handed the ledger's cost recorder for the summarizer it composes:
 * that spend is audited (recorded to the ledger) but not charged to the session
 * spend counter — a deliberate deferral.
 */
function buildBaseCatalogue(
  kernel: ChangeKernel,
  governance: Governance,
  flags: FlagPipeline,
  options: DaemonCoreOptions,
  sessionId = 'daemon',
  spawn?: SpawnDeps,
  worktreeRoot?: string,
  messaging?: MessagingDeps,
) {
  const web = options.webTools?.({
    recordCost: (usage) => governance.record({ scope: 'web_fetch_summarizer', ...usage }),
  });
  const root = worktreeRoot ?? options.root ?? '.';
  return buildGovernedTools(
    {
      ...governedToolDeps(kernel, governance, flags, root, sessionId, spawn, messaging),
      base: baseToolDeps(kernel, root),
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
