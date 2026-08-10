import { z } from 'zod';
import { patchSchema } from './patch.js';

/**
 * The SARIF-subset flag record and its two audience views. This package owns the
 * fields; the flag pipeline assigns `severity` / `confidence` / `type` / `concernKey`.
 */

export const severitySchema = z.enum(['crit', 'high', 'med', 'low']);
export type Severity = z.infer<typeof severitySchema>;

export const flagRecordSchema = z.object({
  /** One or more contributing rule ids (concern dedup collapses producers onto one record). */
  ruleId: z.union([z.string(), z.array(z.string())]),
  location: z.string(),
  severity: severitySchema,
  message: z.string(),
  /** Optional deterministic auto-patch payload. */
  fix: patchSchema.optional(),
  /** Stable identity for baselining/suppression. */
  fingerprint: z.string(),
  /** Producer-stamped: 1 = deterministic, gate-eligible; 2 = judgment/advisory, never blocks. */
  type: z.union([z.literal(1), z.literal(2)]),
  confidence: z.enum(['high', 'low']),
  /** The cross-producer dedup key. */
  concernKey: z.string(),
});
export type FlagRecord = z.infer<typeof flagRecordSchema>;

/** The user audience view: crit/high expanded; med/low collapsed-but-counted, never hidden. */
export const feedViewSchema = z.object({
  expanded: z.array(flagRecordSchema),
  collapsed: z.array(z.object({ concernKey: z.string(), count: z.number(), severity: z.string() })),
});
export type FeedView = z.infer<typeof feedViewSchema>;

/** The agent audience view: high-confidence ∧ (crit|high) only, grouped by concernKey. */
export const injectionBundleSchema = z.object({
  groups: z.array(z.object({ concernKey: z.string(), flags: z.array(flagRecordSchema) })),
  countLine: z.string().optional(),
});
export type InjectionBundle = z.infer<typeof injectionBundleSchema>;
