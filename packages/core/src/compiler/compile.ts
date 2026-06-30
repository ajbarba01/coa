import type {
  CapabilityFrame,
  ContentAxes,
  FlagRecord,
  NeutralConfig,
  OrderedPiece,
  Piece,
  Reminder,
} from '@coa/shared';

/**
 * M5 — the Pieces → config translation. `compile` is a pure, deterministic
 * front-end over the `NeutralConfig` slots (P1): a **TAX-4 normalization pre-pass**
 * coerces/validates incoherent axis combinations (returning a surfaced finding per
 * coercion — never silent), then **TAX-3 routing** sends each (normalized) Piece to
 * a delivery slot by the static function of its axes. The output is backend-NEUTRAL
 * — M9's `renderNative` turns it into backend-native form; M5 never imports M9.
 *
 * Purity is preserved by the **return-tuple**: the findings are returned alongside
 * the config rather than emitted through a side channel, so `compile` stays a pure
 * function of its inputs. The daemon ingests the findings into M3's one feed.
 *
 * Cache-stability holds by construction: slot membership is fixed here from the
 * (normalized) static axes, and the only runtime variability (`scopePushed`) lives
 * entirely in the post-prefix append region, so per-turn state never moves content
 * into or out of the byte-stable prefix (D105).
 *
 * The two cross-module checks are injected as narrow ports (the M3 constraint
 * registry, M1 `generated-from` edges); absent them, those rows are skipped (the
 * floor stays silent rather than guessing). Deferred TAX-4 rows: the
 * Piece-as-SSOT-authority drop (needs authority-relationship graph context),
 * volatile-content-in-prefix (needs a volatility marker), and the enforced-but-
 * invisible note (needs the constraint's Type-1/Type-2 from the registry).
 */

/** The injected cross-module checks the TAX-4 pre-pass needs (absent ⇒ that row is skipped). */
export interface CompileDeps {
  /** TAX-4 row 1 — is a `governed-by` target a registered constraint (an M3 producer)? */
  isRegistered?: (constraintId: string) => boolean;
  /** TAX-4 row 2 — does this Piece carry a `generated-from` edge (M1)? */
  hasGeneratedFrom?: (pieceName: string) => boolean;
}

export interface CompileResult {
  config: NeutralConfig;
  /** One Type-2 advisory finding per TAX-4 coercion/warning — surfaced, never silent. */
  findings: FlagRecord[];
}

export function compile(
  pieces: Piece[],
  frame: CapabilityFrame,
  deps: CompileDeps = {},
): CompileResult {
  const findings: FlagRecord[] = [];
  const normalized = pieces.map((piece) => normalize(piece, deps, findings));

  const prefixCandidates: Piece[] = [];
  const onDemandPullable: string[] = [];
  const scopePushed: Piece[] = [];

  for (const piece of normalized) {
    const { delivery, scope } = piece.axes;
    if (delivery === 'push' && scope === undefined) {
      prefixCandidates.push(piece);
    } else if (delivery === 'push') {
      scopePushed.push(piece);
    } else {
      onDemandPullable.push(piece.name);
    }
  }

  // D105 clause 1 — most-stable-first: order the byte-stable prefix head by content
  // volatility so the least-likely-to-change Pieces lead. `provenance` is the trust/
  // volatility axis (TAX-1): `authored` content is human-stable, `derived-from-code`
  // changes whenever the code does. A STABLE sort keeps equal-stability Pieces in input
  // order, so the prefix never reorders without a real change (clause 2, byte-stability).
  const ordered = prefixCandidates
    .map((piece, index) => ({ piece, index }))
    .sort((a, b) => stabilityRank(a.piece) - stabilityRank(b.piece) || a.index - b.index)
    .map(({ piece }) => piece);

  const prefixHead: OrderedPiece[] = ordered.map((piece, order) => ({ piece, order }));
  const systemReminders: Reminder[] = ordered
    .filter((piece) => piece.axes.salience !== 'never')
    .map((piece) => ({ rule: piece.name, reason: piece.description, tier: 0 }));

  return {
    config: { prefixHead, systemReminders, onDemandPullable, scopePushed, toolIntents: frame },
    findings,
  };
}

/** D105 — lower rank leads the prefix. Authored content is the most stable; derived-from-code is volatile. */
function stabilityRank(piece: Piece): number {
  return piece.axes.provenance === 'authored' ? 0 : 1;
}

/** TAX-4 — coerce one Piece's incoherent axis combinations, pushing a finding per coercion. */
function normalize(piece: Piece, deps: CompileDeps, findings: FlagRecord[]): Piece {
  let axes: ContentAxes = piece.axes;
  let governedBy = piece.governedBy;

  // Row 1 — drop `governed-by` links to an unregistered constraint (unforgeable link).
  if (governedBy !== undefined && deps.isRegistered !== undefined) {
    const isRegistered = deps.isRegistered;
    const kept = governedBy.filter((id) => {
      if (isRegistered(id)) return true;
      findings.push(governedByUnregistered(piece.name, id));
      return false;
    });
    governedBy = kept;
  }

  // Row 2 — `derived-from-code` with no `generated-from` edge → coerce to `authored` + notice.
  if (
    axes.provenance === 'derived-from-code' &&
    deps.hasGeneratedFrom !== undefined &&
    !deps.hasGeneratedFrom(piece.name)
  ) {
    axes = { ...axes, provenance: 'authored' };
    findings.push(derivedNoSource(piece.name));
  }

  // Row 4 — legit derived content pushed to the prefix as authoritative start → warn (allow).
  if (
    axes.provenance === 'derived-from-code' &&
    axes.delivery === 'push' &&
    axes.scope === undefined
  ) {
    findings.push(derivedAsAuthoritative(piece.name));
  }

  // Row 7 — a forceful push rule with no backing check → label "advisory (no backing check)".
  if (
    (governedBy === undefined || governedBy.length === 0) &&
    axes.salience !== 'never' &&
    axes.delivery === 'push'
  ) {
    findings.push(advisoryNoCheck(piece.name));
  }

  return { ...piece, axes, ...(governedBy !== undefined ? { governedBy } : {}) };
}

/** Row 1 — shares the reactive detector's `dangling-governance:<referrer>→<constraint>` concern (CF-7). */
function governedByUnregistered(piece: string, constraint: string): FlagRecord {
  const concernKey = `dangling-governance:${piece}→${constraint}`;
  return {
    ruleId: 'tax4:governed-by-unregistered',
    location: piece,
    severity: 'med',
    message: `${piece} declares governed-by "${constraint}", which is not a registered check — the authority link was dropped.`,
    fingerprint: concernKey,
    type: 2,
    confidence: 'high',
    concernKey,
  };
}

function derivedNoSource(piece: string): FlagRecord {
  const concernKey = `tax4:derived-no-source:${piece}`;
  return {
    ruleId: 'tax4:derived-no-source',
    location: piece,
    severity: 'med',
    message: `${piece} is derived-from-code but has no generated-from edge — coerced to authored (a vendored snapshot cannot masquerade as authored truth).`,
    fingerprint: concernKey,
    type: 2,
    confidence: 'high',
    concernKey,
  };
}

function derivedAsAuthoritative(piece: string): FlagRecord {
  const concernKey = `tax4:derived-as-authoritative:${piece}`;
  return {
    ruleId: 'tax4:derived-as-authoritative',
    location: piece,
    severity: 'low',
    message: `${piece} is derived-from-code yet pushed to the prefix as authoritative starting context — allowed, but grounding will not treat it as authoritative.`,
    fingerprint: concernKey,
    type: 2,
    confidence: 'high',
    concernKey,
  };
}

function advisoryNoCheck(piece: string): FlagRecord {
  const concernKey = `tax4:advisory-no-check:${piece}`;
  return {
    ruleId: 'tax4:advisory-no-check',
    location: piece,
    severity: 'low',
    message: `${piece} is a forceful (salient, pushed) rule with no backing check — labeled advisory (no backing check).`,
    fingerprint: concernKey,
    type: 2,
    confidence: 'high',
    concernKey,
  };
}
