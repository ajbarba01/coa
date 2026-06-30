import { ulid } from 'ulid';
import type {
  ChangeEvent,
  EdgeType,
  GovernancePayload,
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
import { reparseSymbols } from './graph/reparse.js';
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
 * This is the floor. The GRF-* graph hardening (cycle/coupling/temporal views,
 * convention extractors, SCIP) and the SCO-* scope tier are a follow-up batch.
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
  private nextSeq = 0;
  private fuzzyDirty = false;

  constructor(options: ChangeKernelOptions) {
    this.worktree = options.worktree ?? 'main';
    this.root = options.root ?? process.cwd();
    this.wal = new Wal(options.walPath);
    this.projection = new ProjectionDb(options.projectionPath ?? ':memory:', PROJECTOR_VERSION);

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

  appendGovernance(payload: GovernancePayload): number {
    return this.emit({
      worktree: this.worktree,
      actor: 'session',
      op_id: ulid(),
      provenance: 'declared',
      cause: null,
      kind: 'governance',
      payload,
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

  /** Drive M2 to (re)index a file's symbols into the resident table. */
  indexFile(path: string, lang: string, bytes: string): void {
    this.symbols.indexFile(path, reparseSymbols({ path, lang, bytes }));
    this.fuzzyDirty = true;
    this.idle.scheduleIdle(() => this.rebuildFuzzy(), { priority: 1, preemptible: true });
  }

  lookup(name: string): SymbolRecord | undefined {
    return this.symbols.lookup(name);
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
      case 'governance':
        break;
      default:
        this.graph.setNode(frame.path, 'file');
        this.projection.applyEvent(frame);
        break;
    }
    this.signals.record(signalOf(frame));
  }

  private rebuildFuzzy(): void {
    this.fuzzy.build(this.symbols.all());
    this.fuzzyDirty = false;
  }
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
