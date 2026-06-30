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
export { reparseSymbols, reparseFile } from './graph/reparse.js';
export { findCycles, type CycleComponent } from './graph/cycles.js';
export { computeCoupling, type CouplingFan } from './graph/coupling.js';
export {
  temporal,
  type FileTouch,
  type TemporalView,
  type TemporalOptions,
} from './graph/temporal.js';
export { extractImports } from './graph/extract-imports.js';
export { resolveImportSpecifier, importCandidates } from './graph/resolve-import.js';
export { exportScip, buildScipIndex, type ScipIndex, type ScipOptions } from './graph/scip.js';
export {
  ExtractorRegistry,
  STARTER_EXTRACTORS,
  codegenMarkerExtractor,
  registrySingletonExtractor,
  type ConventionExtractor,
  type ExtractionResult,
} from './graph/conventions.js';
export { Reconciler, scanWorktree, type ReconcilerDeps } from './reconcile/reconciler.js';
export {
  classifyObservation,
  type Observation,
  type PreciseOp,
  type PathState,
} from './reconcile/dedup.js';
export { matchGlob, globToRegExp } from './scope/glob.js';
export { resolveScope, type ScopeContext } from './scope/scope-resolver.js';
export { validateScopesConfig, loadScopesFile, type ScopesConfig } from './scope/scopes-config.js';
export { lintScopes, type ScopeLintFinding, type ScopeLintContext } from './scope/scope-linter.js';
export {
  FlagPipeline,
  type FlagPipelineOptions,
  type GateResult,
  type ToolDenyRule,
  type ToolDenyVerdict,
} from './flags/pipeline.js';
export {
  validateProducer,
  type Producer,
  type ProducerInput,
  type ValidationResult,
} from './flags/producer.js';
export {
  assignSeverity,
  assignConfidence,
  maxSeverity,
  type FlagSignals,
} from './flags/severity.js';
export { mergeConcern } from './flags/dedup.js';
export {
  resolutionFor,
  type FeedbackReason,
  type FeedbackRecord,
  type FeedbackResolution,
} from './flags/feedback.js';
export { ReminderPolicy, type AuthorityRule } from './flags/reminder.js';
export {
  groupSelection,
  contextKeyOf,
  type Verdict,
  type ValidatorJudge,
  type ValidatorGroup,
  type ValidatorVerdict,
  type ValidatorRun,
} from './flags/validator.js';
export { AutoPatcher, type AutoPatchPlan } from './flags/autopatch.js';
export { Governance, type GovernanceOptions } from './governance/governance.js';
export { CostCap, type CapState, type CostCapOptions } from './governance/cost-cap.js';
export { Ledger, redactLedgerEvent, type LedgerRecord } from './governance/ledger.js';
export {
  GovernanceLog,
  type GovernanceSpine,
  type DecisionEntry,
  type VouchEntry,
  type SubtractiveEntry,
  type Principal,
} from './governance/governance-log.js';
export {
  sandboxPolicy,
  DENY_READ_GLOBS,
  SECRETS_GLOB,
  type SessionTrustCtx,
  type SandboxOptions,
} from './governance/sandbox.js';
export {
  selfModGuard,
  type SelfModVerdict,
  type Promotion,
  type EvalResult,
} from './governance/selfmod.js';
export { compile } from './compiler/compile.js';
export { ground, type SymbolOracle } from './context/grounding.js';
export {
  createSsotConstraintProducer,
  type GenerationRelation,
  type GenerationRunner,
  type RegenOutput,
  type DegradedRelation,
  type SsotConstraintProducer,
} from './context/ssot-constraint.js';
export { ProjectionDb, type FileState } from './projection.js';
export { IdleScheduler, type IdleHandle, type IdleOptions } from './idle.js';
export { SignalBus, type SignalEvent } from './signal-bus.js';
export { Timeline, rewindPathspec, type Checkpoint } from './checkpoint.js';
