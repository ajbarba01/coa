import { pieceSchema, type AgentSkillConfig, type Piece, type SkillFile } from '@coa/shared';

/**
 * Compile one library skill into the Piece the session resolver injects
 * (`AgentSpec.skills`) — the seam that makes skill execution coa-native on
 * EVERY backend rather than a Claude-only feature. The per-agent delivery
 * choice maps onto the Piece delivery axis: `auto` ⇒ `push` (the body rides in
 * the prompt), `disclosure` ⇒ `pull` (name+description advertised, body pulled
 * on demand — the vanilla-SKILL.md progressive-disclosure floor).
 *
 * Adapted from the archived bundle importer (`archive/bundle-importer/
 * import-bundle.ts`): its `disable-model-invocation` → `manualOnly` mapping is
 * kept; unlike it, ALL foreign front-matter stays verbatim in `ccKeys`
 * (round-trip first — the axis mapping reads, never consumes).
 */
export function skillToPiece(skill: SkillFile, delivery: AgentSkillConfig['delivery']): Piece {
  const manual = skill.ccKeys?.['disable-model-invocation'];
  return pieceSchema.parse({
    name: skill.name,
    description: skill.description,
    body: skill.body,
    axes: {
      delivery: delivery === 'auto' ? 'push' : 'pull',
      salience: 'never',
      provenance: 'authored',
      ...(typeof manual === 'boolean' ? { manualOnly: manual } : {}),
    },
    ...(skill.ccKeys !== undefined ? { ccKeys: skill.ccKeys } : {}),
  });
}
