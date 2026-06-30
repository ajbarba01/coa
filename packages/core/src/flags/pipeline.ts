import type { FeedView, FlagRecord, InjectionBundle, Severity } from '@coa/shared';
import { mergeConcern } from './dedup.js';
import { type Producer, type ProducerInput, validateProducer } from './producer.js';
import { assignConfidence, assignSeverity, type FlagSignals } from './severity.js';

/**
 * M3's one pluggable flag pipeline (P2). Every check is a producer emitting into
 * this single pipeline against the one M0 schema; there are no per-producer side
 * channels. `registerProducer` is the only add-path (gated by CF-6); `ingest` is
 * the only emit-path. On read the pipeline dedups by `concernKey` (CF-7), assigns
 * the two independent axes (CF-2 + D134), and fans out to the two audiences
 * (CF-1): the user sees everything (progressive disclosure), the agent gets a
 * gated, grouped injection. No model on any path (P1).
 */

/** A stored raw emission, before dedup/assignment. */
interface Stored {
  raw: FlagRecord;
  signals: FlagSignals;
  seq: number;
}

const HIGH = new Set<Severity>(['crit', 'high']);

export interface FlagPipelineOptions {
  /** SCO/D32 membership predicate; default = a path-prefix match (the floor, overridable by M8 wiring). */
  membership?: (location: string, scope: string) => boolean;
}

export class FlagPipeline {
  private readonly producers = new Map<string, Producer>();
  private readonly store = new Map<string, Stored>();
  private readonly membership: (location: string, scope: string) => boolean;
  private seq = 0;

  constructor(options: FlagPipelineOptions = {}) {
    this.membership = options.membership ?? ((location, scope) => location.startsWith(scope));
  }

  /** CF-6 — the only add-path; an unvalidated producer is quarantined (rejected), never admitted. */
  registerProducer(producer: Producer): void {
    const result = validateProducer(producer);
    if (!result.ok) {
      throw new Error(`producer ${producer.id} failed registration gate: ${result.reason}`);
    }
    this.producers.set(producer.id, producer);
  }

  registeredProducer(id: string): Producer | undefined {
    return this.producers.get(id);
  }

  /** Run a registered producer over an input and ingest each flag it emits. */
  runProducer(id: string, input: ProducerInput): void {
    const producer = this.producers.get(id);
    if (!producer) throw new Error(`unknown producer: ${id}`);
    for (const flag of producer.run(input)) this.ingest(flag);
  }

  /**
   * The one emit-path. Idempotent on `fingerprint` (R-14): a re-ingest replaces
   * the prior emission (most-recent direct ingest wins); cross-path ordering
   * follows `seq`.
   */
  ingest(flag: FlagRecord, signals: FlagSignals = {}): void {
    this.store.set(flag.fingerprint, { raw: flag, signals, seq: this.seq++ });
  }

  /** CF-1 user audience: crit/high expanded; med/low collapsed-but-counted, never hidden. */
  flagsForUser(scope?: string): FeedView {
    const expanded: FlagRecord[] = [];
    const collapsed: { concernKey: string; count: number; severity: string }[] = [];
    for (const { flag, count } of this.assigned(scope)) {
      if (HIGH.has(flag.severity)) expanded.push(flag);
      else collapsed.push({ concernKey: flag.concernKey, count, severity: flag.severity });
    }
    return { expanded, collapsed };
  }

  /** CF-1 agent audience: high-confidence ∧ (crit|high) only, grouped by concernKey; med/low ride a count line. */
  flagsForAgent(scope?: string): InjectionBundle {
    const groups: { concernKey: string; flags: FlagRecord[] }[] = [];
    let withheld = 0;
    for (const { flag } of this.assigned(scope)) {
      if (flag.confidence === 'high' && HIGH.has(flag.severity)) {
        groups.push({ concernKey: flag.concernKey, flags: [flag] });
      } else {
        withheld += 1;
      }
    }
    const bundle: InjectionBundle = { groups };
    if (withheld > 0) {
      const where = scope !== undefined ? ` in ${scope}` : '';
      bundle.countLine = `${withheld} lower-severity flag${withheld === 1 ? '' : 's'} open${where} — run_checks`;
    }
    return bundle;
  }

  /** The merged, axis-assigned flags (one per concernKey), with the contributing raw count. */
  private assigned(scope?: string): { flag: FlagRecord; count: number }[] {
    const groups = new Map<string, Stored[]>();
    for (const stored of this.store.values()) {
      if (scope !== undefined && !this.membership(stored.raw.location, scope)) continue;
      const group = groups.get(stored.raw.concernKey) ?? [];
      group.push(stored);
      groups.set(stored.raw.concernKey, group);
    }

    const out: { flag: FlagRecord; count: number }[] = [];
    for (const group of groups.values()) {
      const merged = mergeConcern(group.map((s) => s.raw));
      const corroboration = new Set(group.flatMap((s) => flatten(s.raw.ruleId))).size;
      const signals: FlagSignals = {
        ...combineSignals(group.map((s) => s.signals)),
        corroboration,
      };
      out.push({
        flag: {
          ...merged,
          severity: assignSeverity(merged, signals),
          confidence: assignConfidence(merged, signals),
        },
        count: group.length,
      });
    }
    out.sort((a, b) => firstSeq(groups, a.flag.concernKey) - firstSeq(groups, b.flag.concernKey));
    return out;
  }
}

/** Combine the per-flag structural signals into the strongest-leaning composite. */
function combineSignals(list: FlagSignals[]): FlagSignals {
  const out: FlagSignals = {};
  if (list.some((s) => s.structuralShake === true)) out.structuralShake = true;
  if (list.some((s) => s.evidenceDeterminism === true)) out.evidenceDeterminism = true;
  if (list.some((s) => s.inScope === true)) out.inScope = true;
  const precisions = list
    .map((s) => s.measuredPrecision)
    .filter((p): p is number => p !== undefined);
  if (precisions.length > 0) out.measuredPrecision = Math.max(...precisions);
  const ratios = list.flatMap((s) =>
    s.nodeSize !== undefined && s.linesChanged !== undefined
      ? [{ linesChanged: s.linesChanged, nodeSize: s.nodeSize }]
      : [],
  );
  const top = ratios.reduce<(typeof ratios)[number] | undefined>(
    (m, r) =>
      m === undefined || r.linesChanged / r.nodeSize > m.linesChanged / m.nodeSize ? r : m,
    undefined,
  );
  if (top !== undefined) {
    out.linesChanged = top.linesChanged;
    out.nodeSize = top.nodeSize;
  }
  return out;
}

function firstSeq(groups: Map<string, Stored[]>, concernKey: string): number {
  const group = groups.get(concernKey);
  return group ? Math.min(...group.map((s) => s.seq)) : Number.MAX_SAFE_INTEGER;
}

function flatten(ruleId: string | string[]): string[] {
  return Array.isArray(ruleId) ? ruleId : [ruleId];
}
