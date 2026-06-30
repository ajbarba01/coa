import type { FlagRecord } from '@coa/shared';
import { LADDER, maxSeverity } from './severity.js';

/**
 * CF-7 cross-producer dedup. Two producers flagging the **same underlying
 * problem** (the same `concernKey` — `(normalized-location, problem-kind)`)
 * collapse to **one** flag carrying all contributing `ruleId`s, surfaced once and
 * tiered at the **highest** contributing severity/confidence, gate-eligible if any
 * contributor is deterministic. The collapse is conservative — the caller groups
 * by exact `concernKey`, so a wrong merge is preferred-against over occasional
 * under-dedup.
 */
export function mergeConcern(group: FlagRecord[]): FlagRecord {
  // The base record is the highest-priority contributor (severity, then
  // gate-eligibility, then confidence), tie-broken by fingerprint for determinism.
  const base = [...group].sort(byPriority)[0];
  if (base === undefined) throw new Error('mergeConcern: empty group');
  if (group.length === 1) return base;

  const ruleIds = unique(group.flatMap((f) => flatten(f.ruleId)));
  const severity = group.reduce<FlagRecord['severity']>(
    (m, f) => maxSeverity(m, f.severity),
    'low',
  );
  const type = group.some((f) => f.type === 1) ? (1 as const) : (2 as const);
  const confidence = group.some((f) => f.confidence === 'high') ? 'high' : 'low';
  // Prefer a deterministic auto-patch from a Type-1 contributor.
  const fix = group.find((f) => f.type === 1 && f.fix !== undefined)?.fix ?? base.fix;

  return {
    ...base,
    ruleId: ruleIds.length === 1 ? (ruleIds[0] ?? base.ruleId) : ruleIds,
    severity,
    type,
    confidence,
    ...(fix !== undefined ? { fix } : {}),
  };
}

function byPriority(a: FlagRecord, b: FlagRecord): number {
  const sev = LADDER.indexOf(b.severity) - LADDER.indexOf(a.severity);
  if (sev !== 0) return sev;
  if (a.type !== b.type) return a.type - b.type; // Type-1 first
  const conf = rankConfidence(b.confidence) - rankConfidence(a.confidence);
  if (conf !== 0) return conf;
  return a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0;
}

function rankConfidence(c: 'high' | 'low'): number {
  return c === 'high' ? 1 : 0;
}

function flatten(ruleId: string | string[]): string[] {
  return Array.isArray(ruleId) ? ruleId : [ruleId];
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
