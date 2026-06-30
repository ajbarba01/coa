import type { FlagRecord, Severity } from '@coa/shared';

/**
 * M3's assignment logic for M0's `severity`/`confidence` slots (CF-2 two-axis +
 * D134 cheap structural projection). Pure and deterministic — no model on this
 * path (P1). M0 owns the fields; this owns the values.
 *
 * The two axes are independent: SEVERITY = how bad if real (drives the user's
 * prioritization and the gate); CONFIDENCE = how sure it is real (drives
 * agent-injection gating). The projection composes only cheap signals coa already
 * has — verdict-type, the D134 structural score, evidence-determinism,
 * cross-producer corroboration, measured per-rule precision, and scope match. The
 * cut-points are conservative starting numbers calibratable by the v0 spike (the
 * spike gates magnitude, not soundness).
 */

/** The cheap signals the projection composes. Producer-supplied except `corroboration` (the pipeline counts it from the concernKey group). */
export interface FlagSignals {
  /** D134: lines changed in the flagged edit. */
  linesChanged?: number;
  /** D134: size (in lines) of the enclosing node. */
  nodeSize?: number;
  /** D134: a signature/arity/export change outranks a body-only edit. */
  structuralShake?: boolean;
  /** CF-7: how many distinct producers corroborate this concern (>= 1). */
  corroboration?: number;
  /** CF-2: the producer has a deterministic basis (e.g. rename-provenance from the WAL). */
  evidenceDeterminism?: boolean;
  /** D135 ledger: measured per-rule precision in [0, 1], if known. */
  measuredPrecision?: number;
  /** D32: does the flag's location fall inside the active scope? */
  inScope?: boolean;
}

/** Severity ladder, low → crit. Tunable cut-points (the v0-spike knob). */
export const LADDER: readonly Severity[] = ['low', 'med', 'high', 'crit'];

/** The more-severe of two tiers (CF-7 tiers a collapsed concern at the highest contributor). */
export function maxSeverity(a: Severity, b: Severity): Severity {
  return LADDER.indexOf(a) >= LADDER.indexOf(b) ? a : b;
}
const BIG_CHANGE_RATIO = 0.5;
const LOW_PRECISION = 0.5;
const HIGH_PRECISION = 0.8;

/** CONFIDENCE {high/low}: Type-1 verdicts are facts; Type-2 confidence varies with its evidence. */
export function assignConfidence(flag: FlagRecord, signals: FlagSignals): 'high' | 'low' {
  if (flag.type === 1) return 'high';
  if (signals.evidenceDeterminism === true) return 'high';
  if ((signals.corroboration ?? 1) >= 2) return 'high';
  if ((signals.measuredPrecision ?? 0) >= HIGH_PRECISION) return 'high';
  return 'low';
}

/** SEVERITY {crit/high/med/low}: the producer biases a default; the system owns the final value (no self-stamped crit). */
export function assignSeverity(flag: FlagRecord, signals: FlagSignals): Severity {
  let index = LADDER.indexOf(flag.severity);

  if (structuralBump(signals)) index += 1;
  const corroboration = signals.corroboration ?? 1;
  if (corroboration >= 2) index += 1;
  if (signals.measuredPrecision !== undefined && signals.measuredPrecision < LOW_PRECISION) {
    index -= 1;
  }
  if (signals.inScope === false) index -= 1;

  index = clamp(index, 0, LADDER.length - 1);

  // CF-2 crit gate: crit is reachable only via cross-producer corroboration, so a
  // producer can never self-stamp it.
  if (corroboration < 2) index = Math.min(index, LADDER.indexOf('high'));

  return LADDER[index] ?? 'low';
}

/** D134: a structural shake, or a large change relative to node size, bumps severity. */
function structuralBump(signals: FlagSignals): boolean {
  if (signals.structuralShake === true) return true;
  if (
    signals.nodeSize !== undefined &&
    signals.linesChanged !== undefined &&
    signals.nodeSize > 0
  ) {
    return signals.linesChanged / signals.nodeSize >= BIG_CHANGE_RATIO;
  }
  return false;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
