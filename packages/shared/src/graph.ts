import { z } from 'zod';

/**
 * The typed-dependency-graph and symbol-table schema (types only; M1 owns the
 * live runtime). Defining these in M0 lets M2 and every consumer compile against
 * the schema without depending on M1.
 */

/**
 * Edge types (D16 + GRF-4). `generated-from`/`governed-by` are the L-GEN/L-GND
 * seam edges; `calls`/`inherits` are the symbol-level coupling edges feeding the
 * health metrics and the cycle finder.
 */
export const edgeTypeSchema = z.enum([
  'documents',
  'covers',
  'imports',
  'derived-from',
  'depends-on',
  'watches',
  'generated-from',
  'governed-by',
  'calls',
  'inherits',
]);
export type EdgeType = z.infer<typeof edgeTypeSchema>;

/**
 * How an edge was learned (GRF-3). `convention` = a deterministic per-ecosystem
 * extractor (codegen markers / registry call-sites / build-config), distinct
 * from a bare AST `inferred` import.
 */
export const edgeProvenanceSchema = z.enum(['declared', 'inferred', 'convention', 'gated']);
export type EdgeProvenance = z.infer<typeof edgeProvenanceSchema>;

/** Node kinds. The architectural/module granularity tier (GRF-2) is the `scope` node, not a new kind. */
export const graphNodeKindSchema = z.enum([
  'piece',
  'file',
  'constraint',
  'code',
  'version',
  'artifact',
  'work',
  'scope',
  'symbol',
]);
export type GraphNodeKind = z.infer<typeof graphNodeKindSchema>;

export const graphNodeSchema = z.object({
  id: z.string(),
  kind: graphNodeKindSchema,
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: edgeTypeSchema,
  provenance: edgeProvenanceSchema,
  why: z.string().optional(),
  /** GRF-4 coupling weight (e.g. call count); default 1; consumed by health metrics, never by staleness. */
  weight: z.number().optional(),
  /** GRF-1 SCC id, present iff this edge is inside a cycle — retained, never deleted by collapse (collapse is a VIEW). */
  inScc: z.string().optional(),
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

/** The per-symbol fact. The resident table that indexes the graph is M1's; M2 emits these byte-local. */
export const symbolRecordSchema = z.object({
  name: z.string(),
  signature: z.string().optional(),
  definedIn: z.string(),
  scope: z.string().optional(),
  kind: z.string().optional(),
  generated: z.boolean().optional(),
});
export type SymbolRecord = z.infer<typeof symbolRecordSchema>;

/** A fuzzy-match candidate (M1.fuzzyMatch), each carrying an explicit confidence. */
export const rankedCandidateSchema = z.object({
  symbol: symbolRecordSchema,
  confidence: z.number(),
  why: z.string(),
});
export type RankedCandidate = z.infer<typeof rankedCandidateSchema>;

/**
 * The read-only graph query surface (minor-pin F). The concrete query methods
 * live on M1's runtime; M0 fixes only that consumers receive a read-only handle.
 */
export type GraphView = Record<string, never>;
