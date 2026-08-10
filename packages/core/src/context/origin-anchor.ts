import type { FlagRecord, Producer, ProducerInput } from '@coa/shared';
import type { DegradedRelation, GenerationRelation } from './ssot-constraint.js';

/**
 * L-DET (PD-6) — the `origin_anchor` mechanical notice, the sound floor of the
 * detection sub-layer. It is the home for generation relations L-GEN **refused** a
 * Type-1 constraint (binary / non-canonicalizable output, or a non-reproducible
 * generator): coa cannot byte-compare them, so it asserts no staleness — it records
 * the source→artifact anchor and, when the source or the artifact changes, raises a
 * **Type-2, never-blocking** "this generated artifact may be stale — coa cannot
 * verify it; eyeball it" notice. It is purely mechanical (no model call): the
 * one model spend on L-DET's fast path is the G5 confirm, which is not built here.
 *
 * It is `deterministic` in mechanism (a change to an anchored path is a fact) but
 * stamps **Type-2** flags because it cannot prove the artifact is actually stale —
 * so it never gate-blocks (PD-7), and its `low` confidence keeps it on the
 * human "eyeball it" path (CF-1) rather than injected into the agent.
 */

/** A generation relation L-GEN could not verify, paired with why (the degraded reason). */
export interface UnverifiableRelation {
  readonly relation: GenerationRelation;
  readonly reason: DegradedRelation['reason'];
}

const RULE_PREFIX = 'origin-anchor';
const GOLDEN_GOOD = '__coa_origin_anchor_golden_good__';
const GOLDEN_BAD = '__coa_origin_anchor_golden_bad__';

/**
 * Build the origin-anchor producer over the relations L-GEN could not verify. With
 * none it still validates (its golden pair is self-contained), but assembly only
 * registers it when there is something to anchor.
 */
export function createOriginAnchorProducer(
  unverifiable: readonly UnverifiableRelation[],
): Producer {
  return {
    id: 'origin-anchor',
    kind: 'deterministic',
    activation: 'on-source-change',
    run: (input) => run(input, unverifiable),
    golden: {
      good: { kind: 'scope', scope: GOLDEN_GOOD },
      bad: { kind: 'scope', scope: GOLDEN_BAD },
    },
  };
}

function run(input: ProducerInput, unverifiable: readonly UnverifiableRelation[]): FlagRecord[] {
  if (input.kind === 'scope') {
    if (input.scope === GOLDEN_GOOD) return [];
    if (input.scope === GOLDEN_BAD) return [notice(goldenUnverifiable())];
    return unverifiable.map(notice);
  }
  if (input.kind === 'change') {
    const path = 'path' in input.event ? input.event.path : undefined;
    return unverifiable
      .filter((u) => u.relation.source === path || u.relation.target === path)
      .map(notice);
  }
  return [];
}

/** The Type-2, never-blocking, no-fix mechanical notice for an unverifiable anchored artifact. */
function notice({ relation, reason }: UnverifiableRelation): FlagRecord {
  const ruleId = `${RULE_PREFIX}:${relation.name}`;
  return {
    ruleId,
    location: relation.target,
    severity: 'low',
    message: `${relation.target} is generated from ${relation.source} but coa cannot canonicalize it (${reason}); it changed — review it by hand.`,
    fingerprint: `${ruleId}:${relation.target}`,
    type: 2,
    confidence: 'low',
    concernKey: ruleId,
  };
}

function goldenUnverifiable(): UnverifiableRelation {
  return {
    relation: {
      name: '__golden__',
      source: '__golden.src__',
      target: '__golden.bin__',
      lang: 'plain',
    },
    reason: 'non-canonicalizable',
  };
}
