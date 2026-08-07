import { ulid } from 'ulid';
import type {
  ChangeEvent,
  EdgeType,
  GraphEdge,
  Piece,
  PieceRef,
  RankedCandidate,
  SymbolRecord,
} from '@coa/shared';
import { type ChangeEventDraft, stampFrame } from './event.js';
import { Wal } from './wal/wal.js';
import { TypedGraph } from './graph/graph.js';
import { SymbolTable } from './graph/symbol-table.js';
import { FuzzyIndex } from './graph/fuzzy-index.js';
import { PieceStore, resolvePiece } from './graph/resolve-piece.js';
import { reparseFile } from './graph/reparse.js';
import { extractImports } from './graph/extract-imports.js';
import { resolveImportSpecifier } from './graph/resolve-import.js';
import {
  ExtractorRegistry,
  STARTER_EXTRACTORS,
  type ConventionExtractor,
} from './graph/conventions.js';
import {
  temporal,
  type FileTouch,
  type TemporalOptions,
  type TemporalView,
} from './graph/temporal.js';
import { exportScip, type ScipOptions } from './graph/scip.js';
import { resolveScope, type ScopeContext } from './scope/scope-resolver.js';
import { lintScopes, type ScopeLintFinding } from './scope/scope-linter.js';
import { loadScopesFile, type ScopesConfig } from './scope/scopes-config.js';
import { matchGlob } from './scope/glob.js';
import type { EdgeProvenance, ScopeRef, ScopeResolution } from '@coa/shared';
import { ProjectionDb } from './projection.js';
import { IdleScheduler, type IdleHandle, type IdleOptions } from './idle.js';
import { SignalBus, type SignalEvent } from './signal-bus.js';
import { Timeline, rewindPathspec, type Checkpoint } from './checkpoint.js';

const PROJECTOR_VERSION = 1;

export interface ChangeKernelOptions {
  walPath: string;
  worktree?: string;
  root?: string;
  projectionPath?: string;
}

/**
 * M1 — the Change Kernel: the single source of truth for "what changed", and the
 * narrow waist every producer writes to and every consumer reads from. `emit` is
 * the one append path (P7); the typed write methods construct a frame and funnel
 * through it. On a change-event it appends synchronously to the WAL, updates the
 * in-memory hot graph synchronously, then the SQLite projection — exactly the
 * D120 event-sourced order. On startup it replays the WAL to rebuild every
 * projection (the log is the source of truth; everything else is derived).
 *
 * The graph carries the GRF-* hardening (cycle/coupling/temporal views,
 * convention extractors, the inferred import graph, SCIP export) and the SCO-*
 * scope tier (composable membership resolution, the scope linter).
 */
export class ChangeKernel {
  readonly graph = new TypedGraph();
  private readonly wal: Wal;
  private readonly worktree: string;
  private readonly root: string;
  private readonly symbols = new SymbolTable();
  private readonly fuzzy = new FuzzyIndex();
  private readonly pieces = new PieceStore();
  private readonly projection: ProjectionDb;
  private readonly idle = new IdleScheduler();
  private readonly signals = new SignalBus();
  private readonly timeline = new Timeline();
  private readonly frames: ChangeEvent[] = [];
  private readonly consumers: ((event: ChangeEvent) => void)[] = [];
  private readonly extractors = new ExtractorRegistry();
  private readonly indexedFiles = new Set<string>();
  private readonly knownPaths = new Set<string>();
  private readonly unresolvedSites = new Set<string>();
  private scopesConfig: ScopesConfig = { scopes: new Map(), tags: new Map() };
  private readonly scopeCache = new Map<string, { version: number; resolution: ScopeResolution }>();
  private materialVersion = 0;
  private nextSeq = 0;
  private fuzzyDirty = false;

  constructor(options: ChangeKernelOptions) {
    this.worktree = options.worktree ?? 'main';
    this.root = options.root ?? process.cwd();
    this.wal = new Wal(options.walPath);
    this.projection = new ProjectionDb(options.projectionPath ?? ':memory:', PROJECTOR_VERSION);
    for (const extractor of STARTER_EXTRACTORS) this.extractors.register(extractor);

    for (const frame of this.wal.read().frames) {
      this.frames.push(frame);
      this.applyFrame(frame);
    }
    this.nextSeq = this.frames.length;
  }

  // --- the one append path + the typed writers ---------------------------------

  /** The single append path (P7). Returns the authoritative `seq`. */
  emit(draft: ChangeEventDraft): number {
    if (draft.kind === 'assert-edge' && this.graph.wouldCreateCycle(edgeOf(draft))) {
      throw new Error(
        `declared-layer cycle rejected: ${draft.payload.from} -> ${draft.payload.to}`,
      );
    }
    const seq = this.nextSeq++;
    const frame = stampFrame(draft, seq, new Date().toISOString());
    this.wal.append(frame);
    this.wal.sync();
    this.frames.push(frame);
    this.applyFrame(frame);
    for (const consumer of this.consumers) consumer(frame);
    return seq;
  }

  assertEdge(edge: GraphEdge): number {
    return this.emit({
      worktree: this.worktree,
      actor: 'session',
      op_id: ulid(),
      provenance: edge.provenance === 'gated' ? 'gated' : 'declared',
      cause: null,
      kind: 'assert-edge',
      payload: {
        from: edge.from,
        to: edge.to,
        type: edge.type,
        ...(edge.why !== undefined ? { why: edge.why } : {}),
      },
    });
  }

  retractEdge(from: string, to: string, type: EdgeType): number {
    return this.emit({
      worktree: this.worktree,
      actor: 'session',
      op_id: ulid(),
      provenance: 'declared',
      cause: null,
      kind: 'retract-edge',
      payload: { from, to, type },
    });
  }

  declareSymbols(symbols: SymbolRecord[], from: string): number {
    return this.emit({
      worktree: this.worktree,
      actor: 'session',
      op_id: ulid(),
      provenance: 'declared',
      cause: null,
      kind: 'declare-symbols',
      payload: { symbols, from },
    });
  }

  // --- consumer feed -----------------------------------------------------------

  /** At-least-once + idempotent feed: replay from the cursor, then live deliver. */
  subscribe(cursor: number, consumerFn: (event: ChangeEvent) => void): void {
    for (const frame of this.frames) {
      if (frame.seq >= cursor) consumerFn(frame);
    }
    this.consumers.push(consumerFn);
  }

  // --- index / resolve reads ---------------------------------------------------

  /**
   * Drive M2 to (re)index a file: its symbols into the resident table, and its
   * derived (inferred import + convention) edges into the graph (local/rebuilt,
   * not WAL'd — D49). A reparse first clears the file's stale derived edges.
   */
  indexFile(path: string, lang: string, bytes: string): void {
    const { symbols, cst } = reparseFile({ path, lang, bytes });
    this.symbols.indexFile(path, symbols);
    this.indexedFiles.add(path);
    this.knownPaths.add(path);
    this.materialVersion++;
    this.fuzzyDirty = true;
    this.idle.scheduleIdle(() => this.rebuildFuzzy(), { priority: 1, preemptible: true });

    this.graph.removeDerivedEdgesFrom(path);
    clearPrefix(this.unresolvedSites, `${path}:`);
    if (cst !== null) {
      for (const edge of extractImports(cst, path, (spec, from) =>
        resolveImportSpecifier(spec, from, (p) => this.indexedFiles.has(p)),
      )) {
        this.graph.applyEdge(edge);
      }
    }
    const conventions = this.extractors.run({ path, lang, bytes });
    for (const edge of conventions.edges) this.graph.applyEdge(edge);
    for (const site of conventions.unresolved) this.unresolvedSites.add(`${path}:${site}`);
  }

  /** GRF-3 — admit a deterministic per-ecosystem convention extractor (runs on reparse). */
  registerExtractor(extractor: ConventionExtractor): void {
    this.extractors.register(extractor);
  }

  /** GRF-5 — the WAL⨝structure temporal view for a node. */
  temporal(node: string, options?: TemporalOptions): TemporalView {
    const touches: FileTouch[] = this.frames
      .filter((f): f is Extract<ChangeEvent, { path: string }> => 'path' in f)
      .map((f) => ({ seq: f.seq, path: f.path, ts: f.ts }));
    return temporal(node, touches, options ?? {});
  }

  /** GRF-3 — the anti-false-graph honesty read: per-provenance counts + unresolved sites. */
  coverage(): Record<EdgeProvenance, number> & { unresolved: number } {
    return { ...this.graph.provenanceCounts(), unresolved: this.unresolvedSites.size };
  }

  /** GRF-6 — the one-way SCIP export of the indexed symbol layer. */
  exportScip(options: ScipOptions): Uint8Array {
    return exportScip(this.symbols.all(), options);
  }

  // --- scope tier (SCO-*) ------------------------------------------------------

  /** Install a validated scope/tag config (the loaded `.coa/scopes.yaml`). */
  loadScopes(config: ScopesConfig): void {
    this.scopesConfig = config;
    this.materialVersion++;
  }

  /** Load + validate `.coa/scopes.yaml` from disk and install it. */
  loadScopesFromFile(path: string): void {
    this.loadScopes(loadScopesFile(path));
  }

  /** SCO-2 — resolve a scope to its member set, cached and re-resolved only on material change. */
  resolveScope(ref: ScopeRef): ScopeResolution {
    const scope = this.scopesConfig.scopes.get(ref);
    if (!scope) throw new Error(`scope not found: ${ref}`);
    const cached = this.scopeCache.get(ref);
    if (cached && cached.version === this.materialVersion) return cached.resolution;
    const resolution = resolveScope(scope, this.scopeContext());
    this.scopeCache.set(ref, { version: this.materialVersion, resolution });
    return resolution;
  }

  /** SCO-1 — the inverse membership read: which scopes a path belongs to. */
  scopesFor(path: string): ScopeRef[] {
    const names: ScopeRef[] = [];
    for (const name of this.scopesConfig.scopes.keys()) {
      if (this.resolveScope(name).members.includes(path)) names.push(name);
    }
    return names;
  }

  /** SCO-5 — lint the scope set for silent-failure leaves and rot. */
  lintScopes(): ScopeLintFinding[] {
    return lintScopes(this.scopesConfig.scopes.values(), {
      resolve: (scope) => this.resolveScope(scope.name),
      isPiece: (piece) => this.pieces.get(piece) !== undefined,
      isNode: (id) => this.graph.hasNode(id) || this.knownPaths.has(id),
    });
  }

  lookup(name: string): SymbolRecord | undefined {
    return this.symbols.lookup(name);
  }

  /** The current WAL frontier — a monotonic freshness stamp (e.g. L-GND's `checked_against`). */
  walPosition(): number {
    return this.nextSeq;
  }

  fuzzyMatch(name: string, limit?: number): RankedCandidate[] {
    if (this.fuzzyDirty) this.rebuildFuzzy();
    return this.fuzzy.match(name, limit);
  }

  registerPiece(piece: Piece): void {
    this.pieces.register(piece);
    this.graph.setNode(piece.name, 'piece');
  }

  resolvePiece(ref: PieceRef): Piece {
    return resolvePiece(ref, { store: this.pieces, graph: this.graph });
  }

  // --- idle / signals / timeline ----------------------------------------------

  scheduleIdle(job: () => void, options: IdleOptions): IdleHandle {
    return this.idle.scheduleIdle(job, options);
  }

  runIdle(): void {
    this.idle.flush();
  }

  signalsView(predicate?: (event: SignalEvent) => boolean): SignalEvent[] {
    return this.signals.query(predicate);
  }

  checkpoint(): Checkpoint {
    return this.timeline.checkpoint(this.nextSeq, this.worktree);
  }

  listTimeline(): Checkpoint[] {
    return this.timeline.listTimeline();
  }

  pin(id: string): void {
    this.timeline.pin(id);
  }

  unpin(id: string): void {
    this.timeline.unpin(id);
  }

  /** Scoped rewind: a git pathspec re-materialization (working tree only — D97). */
  rewind(scope: { source: string; pathspecs: string[] }): void {
    rewindPathspec(this.root, scope.source, scope.pathspecs);
  }

  /** The retention floor (compaction safety, D94). */
  retentionFloor(consumerCursors: number[]): number {
    return this.timeline.retentionFloor(consumerCursors);
  }

  /** The replayed/live frame log (test + introspection read). */
  read(): ChangeEvent[] {
    return [...this.frames];
  }

  close(): void {
    this.wal.close();
    this.projection.close();
  }

  // --- internals ---------------------------------------------------------------

  private applyFrame(frame: ChangeEvent): void {
    switch (frame.kind) {
      case 'assert-edge':
        this.graph.applyEdge(edgeOf(frame));
        break;
      case 'retract-edge':
        this.graph.retractEdge(frame.payload.from, frame.payload.to, frame.payload.type);
        break;
      case 'declare-symbols':
        this.symbols.indexFile(frame.payload.from, frame.payload.symbols);
        this.fuzzyDirty = true;
        break;
      default:
        this.graph.setNode(frame.path, 'file');
        this.projection.applyEvent(frame);
        if (frame.kind === 'delete') this.knownPaths.delete(frame.path);
        else this.knownPaths.add(frame.path);
        this.materialVersion++;
        break;
    }
    this.signals.record(signalOf(frame));
  }

  private rebuildFuzzy(): void {
    this.fuzzy.build(this.symbols.all());
    this.fuzzyDirty = false;
  }

  /** Build the live evaluation context the pure scope resolver reads. */
  private scopeContext(): ScopeContext {
    return {
      walPosition: this.nextSeq,
      paths: [...this.knownPaths],
      tagMembers: (tag) => {
        const globs = this.scopesConfig.tags.get(tag) ?? [];
        return [...this.knownPaths].filter((p) => globs.some((g) => matchGlob(g, p)));
      },
      forwardClosure: (node) => this.forwardClosure(node),
      getScope: (name) => this.scopesConfig.scopes.get(name),
    };
  }

  /** A node plus its transitive forward dependencies (depends-on/imports). */
  private forwardClosure(node: string): string[] {
    const seen = new Set<string>([node]);
    const stack = [node];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      for (const dep of this.graph.dependencies(current)) {
        if (!seen.has(dep)) {
          seen.add(dep);
          stack.push(dep);
        }
      }
    }
    return [...seen];
  }
}

/** Remove every set member starting with `prefix`. */
function clearPrefix(set: Set<string>, prefix: string): void {
  for (const value of set) if (value.startsWith(prefix)) set.delete(value);
}

/** Build a graph edge from an assert-edge frame/draft. */
function edgeOf(frame: {
  provenance: 'declared' | 'gated';
  payload: { from: string; to: string; type: EdgeType; why?: string | undefined };
}): GraphEdge {
  const { from, to, type, why } = frame.payload;
  return { from, to, type, provenance: frame.provenance, ...(why !== undefined ? { why } : {}) };
}

function signalOf(frame: ChangeEvent): SignalEvent {
  return {
    name: 'coa.change',
    ts: frame.ts,
    attributes: {
      'coa.kind': frame.kind,
      'coa.seq': frame.seq,
      ...('path' in frame ? { 'coa.path': frame.path } : {}),
    },
  };
}
