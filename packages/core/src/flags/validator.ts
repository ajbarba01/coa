import type { ContextSlice, FlagRecord } from '@coa/shared';

/**
 * CF-5 — the user-invoked flag-validator's pure grouping core. Nothing judges a
 * Type-2 flag un-prompted; the user points the validator at a selection and it
 * **auto-groups by shared context** before running: flags whose `envelope()`
 * overlaps batch into ONE judge call with the union of their context; flags that
 * need different slices are NOT lumped, even at the cost of more calls (correctness
 * beats token-saving). The model judge itself is M9's (injected) — user-invoked,
 * off the critical path (P1).
 */

export type Verdict = 'confirmed' | 'refuted' | 'uncertain';

export interface ValidatorVerdict {
  fingerprint: string;
  verdict: Verdict;
  confidence: 'high' | 'low';
  reason: string;
}

export interface ValidatorGroup {
  contextKey: string;
  flags: FlagRecord[];
  context: ContextSlice[];
}

/** The injected judge port — M9 runs the cheap model call over the grouped context. */
export type ValidatorJudge = (group: ValidatorGroup) => Promise<ValidatorVerdict[]>;

export interface ValidatorRun {
  groups: ValidatorGroup[];
  verdicts: ValidatorVerdict[];
}

/** The context-overlap key for a flag's bounded envelope (same artifact / changed-symbol slice / spec). */
export function contextKeyOf(slice: ContextSlice): string {
  const ref = slice.ref;
  if ('name' in ref) return `name:${ref.name}`;
  return ref.symbol !== undefined ? `path:${ref.path}#${ref.symbol}` : `path:${ref.path}`;
}

/**
 * Group a selection by its envelope's context key. A flag whose envelope cannot be
 * resolved groups alone under its own fingerprint (degraded — never lumped wrongly).
 */
export function groupSelection(
  flags: FlagRecord[],
  envelopeOf: (flag: FlagRecord) => ContextSlice | undefined,
): ValidatorGroup[] {
  const byKey = new Map<string, ValidatorGroup>();
  for (const flag of flags) {
    const slice = envelopeOf(flag);
    const key = slice !== undefined ? contextKeyOf(slice) : `fp:${flag.fingerprint}`;
    const group = byKey.get(key) ?? { contextKey: key, flags: [], context: [] };
    group.flags.push(flag);
    if (slice !== undefined && !group.context.some((c) => contextKeyOf(c) === key)) {
      group.context.push(slice);
    }
    byKey.set(key, group);
  }
  return [...byKey.values()];
}
