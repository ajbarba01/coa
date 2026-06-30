import type { GroundingBlock, RankedCandidate, SymbolRecord, ToolCall } from '@coa/shared';

/**
 * M4 / L-GND — the GROUNDING existence tier (CL-9 EXISTENCE), the highest
 * anti-drift priority (G-1). On a symbol-naming tool call it answers one
 * question against M1's live `name → SymbolRecord` index: is the name in the
 * project's visible symbol set? A hit (>95% of calls, one O(1) read) is silent —
 * the agent is on truth. A miss does NOT fail the call (SC-1 / G-2 help-not-cage):
 * it consults the idle-built fuzzy index and, only if a near match exists,
 * appends an advisory `grounding` block to the tool return (F6) — zero model
 * tokens, never a block. A genuinely new-looking name (no near match) gets no
 * correction at all (G-2 "fails toward proceed").
 *
 * Tier scope: EXISTENCE only — works for every parseable language because it
 * rides the symbol index alone (it needs no generation). The SIGNATURE/ARITY and
 * TYPES/SPEC tiers are language-gated follow-ups; the spec tier additionally
 * depends on L-GEN's `declared_symbols()` + `governed-by` seam and sequences
 * after it. External/3rd-party symbols (G-4) are out of scope by default — the
 * conservative fuzzy cutoff is the floor; stub-grounding is a later opt-in.
 */

/** The narrow M1 read-surface grounding needs (the kernel satisfies it structurally). */
export interface SymbolOracle {
  /** O(1) `name → SymbolRecord` lookup against the live symbol table (the hit path). */
  lookup(name: string): SymbolRecord | undefined;
  /** The miss-path nearest-match candidates, ranked with explicit confidence. */
  fuzzyMatch(name: string, limit?: number): RankedCandidate[];
  /** The WAL frontier the check ran against — the `checked_against` freshness stamp. */
  walPosition(): number;
}

/** A near match at/above this confidence is graded `stale` (a likely rename); below it, `weak`. */
const STALE_THRESHOLD = 0.7;

/**
 * Ground a tool call against the project symbol graph. Returns an advisory
 * `GroundingBlock` only on a miss that has a near match; otherwise `undefined`
 * (a hit, an un-named call, or a genuinely new name — all proceed silently).
 */
export function ground(call: ToolCall, oracle: SymbolOracle): GroundingBlock | undefined {
  const named = namedSymbol(call.ref);
  if (named === undefined) return undefined;
  if (oracle.lookup(named) !== undefined) return undefined;

  const candidates = oracle.fuzzyMatch(named);
  if (candidates.length === 0) return undefined;

  const top = candidates[0]?.confidence ?? 0;
  return {
    status: top >= STALE_THRESHOLD ? 'stale' : 'weak',
    named,
    checkedAgainst: `project-symbol-graph @ ${oracle.walPosition()}`,
    suggestions: candidates.map((candidate) => suggestionFrom(candidate)),
    ifIntentional: 'if you are creating a new symbol, proceed',
  };
}

/** The symbol a call names: a `{name}` ref, or the `symbol` of a `{path, symbol}` ref. */
function namedSymbol(ref: ToolCall['ref']): string | undefined {
  if (ref === undefined) return undefined;
  if ('name' in ref) return ref.name;
  return ref.symbol;
}

function suggestionFrom(candidate: RankedCandidate): GroundingBlock['suggestions'][number] {
  const { symbol } = candidate;
  return {
    symbol: symbol.name,
    ...(symbol.signature !== undefined ? { signature: symbol.signature } : {}),
    definedIn: symbol.definedIn,
    confidence: candidate.confidence,
    why: candidate.why,
  };
}
