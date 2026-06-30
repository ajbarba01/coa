/**
 * @coa/core (M1) — the Change Kernel: the narrow waist and only shared mutable
 * substrate. Producers and consumers point only here. This is the floor (WAL +
 * typed graph + symbol/fuzzy/piece index + reconciler + projections +
 * checkpoint/rewind + signal bus); the GRF-* graph hardening and SCO-* scope
 * tier are a follow-up batch.
 */

export { ChangeKernel, type ChangeKernelOptions } from './kernel.js';
export { type ChangeEventDraft, stampFrame } from './event.js';
export { Wal } from './wal/wal.js';
export { readFrames, serializeFrame, type ReadResult, type QuarantineNotice } from './wal/frame.js';
export { TypedGraph } from './graph/graph.js';
export { SymbolTable } from './graph/symbol-table.js';
export { FuzzyIndex } from './graph/fuzzy-index.js';
export { PieceStore, resolvePiece } from './graph/resolve-piece.js';
export { reparseSymbols } from './graph/reparse.js';
export { Reconciler, scanWorktree, type ReconcilerDeps } from './reconcile/reconciler.js';
export {
  classifyObservation,
  type Observation,
  type PreciseOp,
  type PathState,
} from './reconcile/dedup.js';
export { ProjectionDb, type FileState } from './projection.js';
export { IdleScheduler, type IdleHandle, type IdleOptions } from './idle.js';
export { SignalBus, type SignalEvent } from './signal-bus.js';
export { Timeline, rewindPathspec, type Checkpoint } from './checkpoint.js';
