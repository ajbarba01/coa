import type { Producer } from '@coa/shared';
import {
  createSsotConstraintProducer,
  type GenerationRelation,
  type GenerationRunner,
} from './ssot-constraint.js';

/**
 * M4 / L-GEN — the producer-assembly entry point: turn the declared generation
 * relations plus a {@link GenerationRunner} into the M3 producers M4 registers.
 * Today that is the single Type-1 SSOT-constraint producer (GEN-3); as the other
 * runnable sub-layers land they assemble through here too. With no relations the
 * result is empty — the daemon stays the D85 inert floor, never worse than the
 * raw loop.
 *
 * Relations the GEN-8 reproducibility self-test refuses a Type-1 constraint are
 * **dropped** here (they belong to the detection-only L-DET / `origin_anchor`
 * path, which is not yet built) — coa would rather surface nothing for them than
 * ship a Type-1 it cannot prove.
 */
export function assembleProducers(
  relations: readonly GenerationRelation[],
  runner: GenerationRunner,
): Producer[] {
  if (relations.length === 0) return [];
  const { producer } = createSsotConstraintProducer(relations, runner);
  return [producer];
}
