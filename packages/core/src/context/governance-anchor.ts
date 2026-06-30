import type { FlagRecord, GraphEdge, Producer, ProducerInput } from '@coa/shared';

/**
 * M4 / L-DET — the reactive dangling-`governed-by` detector. A Piece/symbol that
 * declares `governed-by: X` is claiming a guarantee is enforced by a real check;
 * if X is not a registered constraint, that guarantee is **unbacked** (the
 * policy-theater failure). This producer raises a Type-2, never-blocking notice
 * per such claim, off the M1 change-event spine, at the earliest moment (SPEC's
 * "dangling refs become staleness flags").
 *
 * It is the event-time complement of TAX-4's compile-time `governed-by →
 * unregistered` check; it shares the `dangling-governance:<referrer>→<constraint>`
 * concern identity so the two surfaces collapse (CF-7) rather than double-report.
 *
 * **Rebuild-to-follow:** on every relevant input it returns the COMPLETE current
 * dangling set (a pure function of the graph × the registry), so the M8
 * reconciling driver can self-heal — a claim that becomes backed again (e.g. the
 * rule is restored, or an undo brings it back) simply drops out of the set and the
 * driver resolves the now-absent flag. The producer holds no state and makes no
 * model call (P1): "dangling" is the mechanical fact `edge.to ∉ registered`.
 * `kind:'deterministic'` in mechanism, but it stamps Type-2 because it cannot prove
 * the referrer is unsafe — so it never gate-blocks (SC-1) and rides the human feed.
 */

/** The injected reads: the current `governed-by` edges, and whether a constraint id resolves. */
export interface GovernanceGraph {
  governedByEdges(): GraphEdge[];
  isRegistered(constraintId: string): boolean;
}

const RULE_ID = 'dangling-governance';
const GOLDEN_GOOD = '__coa_dangling_governance_golden_good__';
const GOLDEN_BAD = '__coa_dangling_governance_golden_bad__';

export function createGovernanceAnchorProducer(graph: GovernanceGraph): Producer {
  return {
    id: 'governance-anchor',
    kind: 'deterministic',
    activation: 'on-change',
    run: (input) => run(input, graph),
    golden: {
      good: { kind: 'scope', scope: GOLDEN_GOOD },
      bad: { kind: 'scope', scope: GOLDEN_BAD },
    },
  };
}

function run(input: ProducerInput, graph: GovernanceGraph): FlagRecord[] {
  if (input.kind === 'scope') {
    if (input.scope === GOLDEN_GOOD) return [];
    if (input.scope === GOLDEN_BAD) return [notice('__golden__', '__missing__')];
    return danglingSet(graph);
  }
  if (input.kind === 'change') return danglingSet(graph);
  return [];
}

/** The complete current set of unbacked governance claims (referrer ⇒ unregistered constraint). */
function danglingSet(graph: GovernanceGraph): FlagRecord[] {
  return graph
    .governedByEdges()
    .filter((edge) => !graph.isRegistered(edge.to))
    .map((edge) => notice(edge.from, edge.to));
}

/** The Type-2, never-blocking, no-fix unbacked-guarantee notice for one referrer⇒constraint claim. */
function notice(referrer: string, constraint: string): FlagRecord {
  const concernKey = `${RULE_ID}:${referrer}→${constraint}`;
  return {
    ruleId: RULE_ID,
    location: referrer,
    severity: 'med',
    message: `${referrer} claims it is governed by "${constraint}", but no such registered check exists — the guarantee is unbacked.`,
    fingerprint: concernKey,
    type: 2,
    confidence: 'low',
    concernKey,
  };
}
