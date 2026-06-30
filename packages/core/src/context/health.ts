import type { MetricGranularity, MetricId, MetricSample, HealthProfile } from '@coa/shared';
import type { CycleComponent } from '../graph/cycles.js';
import type { CouplingFan } from '../graph/coupling.js';
import type { TemporalView } from '../graph/temporal.js';
import { composeProfile, type WorstPredicate } from './health-profile.js';

/**
 * M4 / L-HLT — the code-health producer floor: the cheap, sound, language-agnostic
 * signals that ride M1's already-built projections (cycles, coupling, the WAL
 * temporal view) before the AST cognitive-complexity layer (HLT-6, degrades where
 * no grammar). It composes them into a non-compensatory {@link HealthProfile}
 * (worst-of, never a score — HLT-2) and is a Type-2 advisory read that NEVER
 * blocks (HLT-7 / SC-1). `size-loc` rides along every profile as the HLT-3
 * confound control.
 *
 * Deferred (seams kept): the AST `cognitive-complexity` (HLT-6, needs M2
 * `extractMetrics`), the system-tier `propagation-cost` / `core-size` (needs a
 * graph-closure pass), `cbo`/`rfc` headline scoring, and the `instability`/`lcom4`
 * refactoring hints. The numerology deny-list (HLT-4) is honored by omission —
 * none of those metrics are computed here.
 */

/** The M1 read-surface health needs (the kernel + graph helpers satisfy it at the wiring layer). */
export interface HealthSource {
  cycles(): CycleComponent[];
  coupling(node: string): CouplingFan;
  temporal(node: string): TemporalView;
  sizeLoc(node: string): number;
  walPosition(): number;
}

/** Per-metric breach cut-points — a D107 knob the v0 spike calibrates (HLT, conservative defaults). */
export interface HealthThresholds {
  churn: number;
  hotspot: number;
  fanIn: number;
  fanOut: number;
  cbo: number;
}

/** Conservative starting cut-points (HLT — "calibratable by the v0 spike", not numerology). */
export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  churn: 10,
  hotspot: 10,
  fanIn: 12,
  fanOut: 12,
  cbo: 16,
};

/** The floor signal set per tier — what each granularity can soundly compute this round. */
const SIGNALS: Readonly<Record<MetricGranularity, readonly MetricId[]>> = {
  file: ['size-loc', 'churn', 'hotspot', 'cycle'],
  symbol: ['size-loc', 'cycle', 'fan-in', 'fan-out', 'cbo'],
  scope: ['size-loc', 'cycle', 'fan-in', 'fan-out'],
  system: ['size-loc'],
};

/** Compute the health profile for `target` at `granularity` (HLT-1). Pure over the injected source. */
export function health(
  target: string,
  granularity: MetricGranularity,
  source: HealthSource,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): HealthProfile {
  const sizeLoc = source.sizeLoc(target);
  const walPosition = source.walPosition();
  const view = source.temporal(target);
  const fan = source.coupling(target);
  const tangle = cycleSize(target, source.cycles());

  const value: Partial<Record<MetricId, number>> = {
    'size-loc': sizeLoc,
    churn: view.churn,
    hotspot: view.hotspot,
    cycle: tangle,
    'fan-in': fan.fanIn,
    'fan-out': fan.fanOut,
    cbo: fan.cbo,
  };

  const samples: MetricSample[] = SIGNALS[granularity].map((metric) => ({
    metric,
    granularity,
    target,
    value: value[metric] ?? 0,
    sizeLoc,
    basis: basisOf(metric),
    confidence: 'high',
    walPosition,
  }));

  return composeProfile(target, granularity, samples, worstPredicate(thresholds));
}

/** The tangle size of the cycle `target` belongs to (its SCC member count), or 0 if it is in none. */
function cycleSize(target: string, cycles: CycleComponent[]): number {
  const component = cycles.find((cycle) => cycle.members.includes(target));
  return component ? component.members.length : 0;
}

/** HLT-1 basis tags: WAL-native churn, the graph+wal hotspot, everything else graph. */
function basisOf(metric: MetricId): MetricSample['basis'] {
  if (metric === 'churn') return 'wal';
  if (metric === 'hotspot') return 'graph+wal';
  return 'graph';
}

/** A threshold breach test (HLT-2). `cycle` is threshold-free structural (any tangle ≥ 2 flags). */
function worstPredicate(thresholds: HealthThresholds): WorstPredicate {
  return (sample) => {
    switch (sample.metric) {
      case 'cycle':
        return sample.value >= 2;
      case 'churn':
        return sample.value >= thresholds.churn;
      case 'hotspot':
        return sample.value >= thresholds.hotspot;
      case 'fan-in':
        return sample.value >= thresholds.fanIn;
      case 'fan-out':
        return sample.value >= thresholds.fanOut;
      case 'cbo':
        return sample.value >= thresholds.cbo;
      default:
        return false;
    }
  };
}
