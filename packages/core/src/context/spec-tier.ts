import type { ToolCall } from '@coa/shared';

/**
 * L-GND — the SPEC-CONFORMANCE tier (CL-9), the deterministic coverage half.
 * It answers one question for a symbol-naming tool call: which **registered**
 * constraints govern it? Coverage comes ONLY from the deterministic `governed-by`
 * edge (G-3: "coverage only from a deterministic edge, never a name-mention
 * guess") — the unforgeable authority link L-GEN publishes. Zero model tokens.
 *
 * This resolves coverage and carries the contract on edit; it does not re-implement
 * the conformance check. The verdict is the governing constraint's own — it is a
 * registered flag producer that runs deterministically and flags through the flag pipeline's normal
 * pipeline (e.g. the SSOT staleness constraint). The spec tier just routes a touched
 * symbol to the checks that own it. Governance is resolved at file granularity
 * (the `governed-by` edge's endpoint), so a touched symbol maps through its defining
 * file; per-symbol edges wait for symbols to become first-class graph nodes.
 */

/** Coverage for a touched node: the registered constraints that govern it. */
export interface GovernanceCoverage {
  /** The governed node (the symbol's defining file). */
  readonly target: string;
  /** The registered constraint ids governing it (its `governed-by` edge targets). */
  readonly governedBy: readonly string[];
}

/** The read-surface spec-tier coverage needs (composed from the kernel's graph + symbol table at wiring). */
export interface GovernanceOracle {
  /** The registered constraints governing a node — its outgoing `governed-by` edges. */
  governedBy(node: string): string[];
  /** The file a named symbol is defined in (for bare-name refs), or `undefined`. */
  fileOfSymbol(name: string): string | undefined;
}

/**
 * Resolve the registered constraints governing the symbol a tool call names, or
 * `undefined` when the call names none, the symbol's file is unknown, or no
 * `governed-by` edge covers it (fail toward proceed — never a guess).
 */
export function governanceFor(
  call: ToolCall,
  oracle: GovernanceOracle,
): GovernanceCoverage | undefined {
  const node = governedNode(call.ref, oracle);
  if (node === undefined) return undefined;
  const governedBy = oracle.governedBy(node);
  if (governedBy.length === 0) return undefined;
  return { target: node, governedBy };
}

/** The file node a call's ref resolves to: its path, or a bare name's defining file. */
function governedNode(ref: ToolCall['ref'], oracle: GovernanceOracle): string | undefined {
  if (ref === undefined) return undefined;
  if ('path' in ref) return ref.path;
  return oracle.fileOfSymbol(ref.name);
}
