import type { Producer } from '@coa/shared';
import {
  createSsotConstraintProducer,
  type GenerationRelation,
  type GenerationRunner,
} from './ssot-constraint.js';
import { createOriginAnchorProducer, type UnverifiableRelation } from './origin-anchor.js';

/**
 * The producer-assembly entry point: turn the declared generation relations
 * plus a {@link GenerationRunner} into the flag producers the context layer registers. It assembles
 * the Type-1 SSOT-constraint producer (L-GEN / GEN-3) over the verifiable relations
 * and, for the relations the GEN-8 self-test refused a Type-1 constraint (binary /
 * non-canonicalizable / non-reproducible), the Type-2 `origin_anchor` notice
 * producer (L-DET / PD-6) so an unverifiable artifact still gets an "eyeball it"
 * notice instead of being dropped. With no relations the result is empty — the
 * daemon stays the inert floor, never worse than the raw loop.
 */
export function assembleProducers(
  relations: readonly GenerationRelation[],
  runner: GenerationRunner,
): Producer[] {
  if (relations.length === 0) return [];
  const { producer, degraded } = createSsotConstraintProducer(relations, runner);
  const producers = [producer];

  const byName = new Map(relations.map((relation) => [relation.name, relation]));
  const unverifiable = degraded.flatMap((d): UnverifiableRelation[] => {
    const relation = byName.get(d.name);
    return relation === undefined ? [] : [{ relation, reason: d.reason }];
  });
  if (unverifiable.length > 0) producers.push(createOriginAnchorProducer(unverifiable));

  return producers;
}
