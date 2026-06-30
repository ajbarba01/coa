import type { FeedView, FlagRecord, InjectionBundle, Severity } from '@coa/shared';
import { mergeConcern } from './dedup.js';
import { type FeedbackReason, type FeedbackRecord, resolutionFor } from './feedback.js';
import { type Producer, type ProducerInput, validateProducer } from './producer.js';
import { assignConfidence, assignSeverity, type FlagSignals } from './severity.js';
import {
  groupSelection,
  type ValidatorJudge,
  type ValidatorRun,
  type ValidatorVerdict,
} from './validator.js';

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

/** The close-gate verdict. M3 authors the deny `message`; M9 delivers it verbatim. */
export type GateResult = { allow: true } | { allow: false; message: string };

/** A per-tool advisory→deny rule M6 declares; M3 holds the policy, M9 only runs it. */
export interface ToolDenyRule {
  tool: string;
  matches(input: unknown): boolean;
  message: string;
}

/** The deny verdict M8 composes into the one `canUseTool` (after the cost-cap check). */
export type ToolDenyVerdict = { behavior: 'deny'; message: string };

export class FlagPipeline {
  private readonly producers = new Map<string, Producer>();
  private readonly store = new Map<string, Stored>();
  private readonly resolved = new Set<string>();
  private readonly baselined = new Set<string>();
  private readonly feedbackLog: FeedbackRecord[] = [];
  private readonly toolDenyRules: ToolDenyRule[] = [];
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
    // A re-ingest of a fingerprint is a fresh emission — it re-opens the concern.
    this.resolved.delete(flag.fingerprint);
  }

  /** Mark a concern resolved (its fix landed, or the validator refuted it) — drops it from every open set. */
  resolve(fingerprint: string): void {
    this.resolved.add(fingerprint);
  }

  /** D17 baseline/suppress — exclude a pre-existing violation so only NEW divergence blocks. Stays visible to the user. */
  baseline(fingerprint: string): void {
    this.baselined.add(fingerprint);
  }

  /**
   * D131 — the typed-reason triage channel. Records WHY a flag was acted on or
   * dismissed (seeding later constraint proposals) and applies the deterministic
   * effect: a wrong-guess resolves it, a won't-fix dismissal baselines it, a
   * too-blunt rule keeps it and only seeds a proposal. An optional `note` is
   * prose-bearing → WAL-local (DT-5), never on the sync-eligible ledger.
   */
  submitFeedback(flag: FlagRecord, reason: FeedbackReason, note?: string): void {
    this.feedbackLog.push({ fingerprint: flag.fingerprint, reason, ...(note ? { note } : {}) });
    const effect = resolutionFor(reason);
    if (effect === 'resolve') this.resolve(flag.fingerprint);
    else if (effect === 'baseline') this.baseline(flag.fingerprint);
  }

  /** The recorded feedback (audit + the seed for the deferred constraint-mining producer). */
  feedback(): FeedbackRecord[] {
    return [...this.feedbackLog];
  }

  /** Admit an M6-declared per-tool advisory→deny rule. M3 holds the policy; M9 runs it. */
  registerToolDeny(rule: ToolDenyRule): void {
    this.toolDenyRules.push(rule);
  }

  /**
   * CF-5 — the user-invoked validator over a selection of Type-2 flags. Auto-groups
   * by shared context (the union of each flag's producer envelope), runs the
   * injected judge once per group, and applies each verdict: a refuted flag
   * resolves, a confirmed/uncertain one stays. Type-1 flags are never judged. The
   * judge is M9's cheap model call — user-invoked and off the critical path (P1).
   */
  async runValidator(selection: FlagRecord[], judge: ValidatorJudge): Promise<ValidatorRun> {
    const targets = selection.filter((flag) => flag.type === 2);
    const groups = groupSelection(targets, (flag) => this.envelopeOf(flag));
    const verdicts: ValidatorVerdict[] = [];
    for (const group of groups) {
      for (const verdict of await judge(group)) {
        verdicts.push(verdict);
        if (verdict.verdict === 'refuted') this.resolve(verdict.fingerprint);
      }
    }
    return { groups, verdicts };
  }

  /**
   * The per-tool advisory→deny predicate M8 composes into the one `canUseTool`
   * (after the cost-cap check). It is policy M3 declares; M9 only runs it. This is
   * NOT one of the two system blocks — it is a demotable per-tool surface, not the
   * close-gate or the cost-cap.
   */
  perToolDeny(toolName: string, input: unknown): ToolDenyVerdict | undefined {
    for (const rule of this.toolDenyRules) {
      if (rule.tool === toolName && rule.matches(input)) {
        return { behavior: 'deny', message: rule.message };
      }
    }
    return undefined;
  }

  /**
   * The close-gate (D108 enforcement authority) — the one place coa blocks "done".
   * Blocks ONLY on an unresolved Type-1 ∧ high-severity flag; Type-2 advises but
   * never blocks. Spends zero model tokens (a deterministic projection read), so it
   * is not a third cost-gated stop. M9 calls this on the SDK `Stop` hook.
   */
  gate(): GateResult {
    const blocking = this.assigned(undefined, false).filter(
      ({ flag }) => flag.type === 1 && HIGH.has(flag.severity),
    );
    if (blocking.length === 0) return { allow: true };
    const where = blocking.map(({ flag }) => flag.location).join(', ');
    const noun = blocking.length === 1 ? 'check' : 'checks';
    return {
      allow: false,
      message: `Cannot close: ${blocking.length} unresolved high-severity ${noun} at ${where}. Resolve or baseline before finishing.`,
    };
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
    for (const { flag } of this.assigned(scope, false)) {
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

  /** Resolve a flag's bounded evidence slice from its producer (by ruleId → producer.id). */
  private envelopeOf(flag: FlagRecord): ReturnType<NonNullable<Producer['envelope']>> | undefined {
    for (const id of flatten(flag.ruleId)) {
      const producer = this.producers.get(id);
      if (producer?.envelope !== undefined) return producer.envelope(flag);
    }
    return undefined;
  }

  /**
   * The merged, axis-assigned flags (one per concernKey), with the contributing
   * raw count. Resolved fingerprints are always dropped; baselined ones are
   * dropped only when `includeBaselined` is false (the gate + agent injection), so
   * the user view stays honest (CF-1 never hides).
   */
  private assigned(scope?: string, includeBaselined = true): { flag: FlagRecord; count: number }[] {
    const groups = new Map<string, Stored[]>();
    for (const stored of this.store.values()) {
      if (this.resolved.has(stored.raw.fingerprint)) continue;
      if (!includeBaselined && this.baselined.has(stored.raw.fingerprint)) continue;
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
