import type { CapabilityFrame, NeutralConfig, OrderedPiece, Piece, Reminder } from '@coa/shared';

/**
 * M5 — the Pieces → config translation (TAX-3 axis→slot routing). `compile` is a
 * pure, deterministic front-end over the `NeutralConfig` slots (P1): each Piece
 * is routed to a delivery slot by the static function of its axes, and the
 * capability frame is packed as neutral allow/deny tool intents. The output is
 * backend-NEUTRAL — M9's `renderNative` turns it into backend-native form; M5
 * never imports M9.
 *
 * Cache-stability holds by construction: slot membership is fixed here from the
 * static axes, and the only runtime variability (`scopePushed`) lives entirely
 * in the post-prefix append region, so per-turn state never moves content into
 * or out of the byte-stable prefix (D105).
 *
 * Scope note: this is the TAX-3 routing floor. The TAX-4 normalization/coercion
 * pass (rejecting/coercing incoherent axis combos with surfaced findings) needs
 * the M3 constraint registry + M1 `generated-from` edges + a findings channel,
 * and lands as the next pass.
 */
export function compile(pieces: Piece[], frame: CapabilityFrame): NeutralConfig {
  const prefixHead: OrderedPiece[] = [];
  const systemReminders: Reminder[] = [];
  const onDemandPullable: string[] = [];
  const scopePushed: Piece[] = [];

  for (const piece of pieces) {
    const { delivery, scope, salience } = piece.axes;
    if (delivery === 'push' && scope === undefined) {
      prefixHead.push({ piece, order: prefixHead.length });
      if (salience !== 'never') {
        systemReminders.push({ rule: piece.name, reason: piece.description, tier: 0 });
      }
    } else if (delivery === 'push') {
      scopePushed.push(piece);
    } else {
      onDemandPullable.push(piece.name);
    }
  }

  return { prefixHead, systemReminders, onDemandPullable, scopePushed, toolIntents: frame };
}
