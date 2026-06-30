import type { HealthProfile, MetricGranularity, MetricId, MetricSample } from '@coa/shared';

/**
 * M4 / L-HLT — the HLT-2 non-compensatory composition (the field's #1 failure
 * mode: a weighted "spaghetti number" with arbitrary weights that lets a clean
 * file hide a 5,000-line hotspot). coa composes **worst-of, not weighted-sum**:
 * each signal flags independently, and the profile carries **no `score` field**
 * (M0 omits it by construction). `worst` names every breaching signal so no
 * average can mask a hotspot.
 *
 * Two metric classes never drive the advisory: `size-loc` is the HLT-3 confound
 * control (reported alongside every metric, never itself a health signal), and
 * the HLT-3 hint-only metrics (`instability` / `lcom4`) are labeled heuristic and
 * never scored. The per-metric breach test is injected (`isWorst`) — the
 * threshold cut-points are a D107 knob the v0 spike calibrates, kept out of this
 * composition law.
 */

/** HLT-3 — `size-loc` is the confound control, never a health signal. */
const CONTROL_METRICS: ReadonlySet<MetricId> = new Set<MetricId>(['size-loc']);

/** HLT-3 — shipped as labeled refactoring hints only, never as scored health. */
const HINT_METRICS: ReadonlySet<MetricId> = new Set<MetricId>(['instability', 'lcom4']);

/** Whether a sample breaches its (spike-calibrated) cut-point. Injected — the law here is threshold-free. */
export type WorstPredicate = (sample: MetricSample) => boolean;

/** Compose a non-compensatory {@link HealthProfile}: the full sample vector + the breaching signals (`worst`). */
export function composeProfile(
  target: string,
  granularity: MetricGranularity,
  samples: MetricSample[],
  isWorst: WorstPredicate,
): HealthProfile {
  const worst: MetricId[] = [];
  for (const sample of samples) {
    if (CONTROL_METRICS.has(sample.metric) || HINT_METRICS.has(sample.metric)) continue;
    if (isWorst(sample) && !worst.includes(sample.metric)) worst.push(sample.metric);
  }
  return { target, granularity, samples, worst };
}
