import { z } from 'zod';

/**
 * Health/"spaghettiness" record shapes. This package owns the record
 * shape only; the health producer computes the values/thresholds and the spine owns the
 * live projections. The profile is a non-compensatory vector, never a
 * single rolled-up score.
 */

/** The health signals. A PROFILE, never summed. */
export const metricIdSchema = z.enum([
  'cycle',
  'propagation-cost',
  'core-size',
  'cbo',
  'rfc',
  'fan-in',
  'fan-out',
  'cognitive-complexity',
  'churn',
  'hotspot',
  'change-coupling',
  'size-loc',
  'instability',
  'lcom4',
]);
export type MetricId = z.infer<typeof metricIdSchema>;

/** The four tiers a metric reports at. */
export const metricGranularitySchema = z.enum(['symbol', 'file', 'scope', 'system']);
export type MetricGranularity = z.infer<typeof metricGranularitySchema>;

export const metricSampleSchema = z.object({
  metric: metricIdSchema,
  granularity: metricGranularitySchema,
  /** Node id / scope ref. */
  target: z.string(),
  value: z.number(),
  /** Always reported alongside as the size confound control. */
  sizeLoc: z.number(),
  /** Where computed. */
  basis: z.enum(['graph', 'ast', 'wal', 'graph+wal']),
  /** `low` where the parser/edge is partial. */
  confidence: z.enum(['high', 'low']),
  walPosition: z.number(),
});
export type MetricSample = z.infer<typeof metricSampleSchema>;

/** A non-compensatory vector. `worst` names the signals that drive the advisory — no weighted sum can hide a hotspot. */
export const healthProfileSchema = z.object({
  target: z.string(),
  granularity: metricGranularitySchema,
  samples: z.array(metricSampleSchema),
  worst: z.array(metricIdSchema),
});
export type HealthProfile = z.infer<typeof healthProfileSchema>;
