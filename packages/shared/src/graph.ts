import { z } from 'zod';

/**
 * The typed-dependency-graph and symbol-table schema (types only; the change-event
 * spine owns the live runtime). Defining these here lets the code-intel layer and
 * every consumer compile against the schema without depending on the spine.
 */

/**
 * Edge types. `generated-from`/`governed-by` are the generation/authority
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
 * How an edge was learned. `convention` = a deterministic per-ecosystem
 * extractor (codegen markers / registry call-sites / build-config), distinct
 * from a bare AST `inferred` import.
 */
export const edgeProvenanceSchema = z.enum(['declared', 'inferred', 'convention', 'gated']);
export type EdgeProvenance = z.infer<typeof edgeProvenanceSchema>;

/** Node kinds. The architectural/module granularity tier is the `scope` node, not a new kind. */
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
  /** Coupling weight (e.g. call count); default 1; consumed by health metrics, never by staleness. */
  weight: z.number().optional(),
  /** SCC id, present iff this edge is inside a cycle — retained, never deleted by collapse (collapse is a VIEW). */
  inScc: z.string().optional(),
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

/** The per-symbol fact. The resident table that indexes the graph is the spine's; the code-intel layer emits these byte-local. */
export const symbolRecordSchema = z.object({
  name: z.string(),
  signature: z.string().optional(),
  definedIn: z.string(),
  scope: z.string().optional(),
  kind: z.string().optional(),
  generated: z.boolean().optional(),
});
export type SymbolRecord = z.infer<typeof symbolRecordSchema>;

/**
 * The read-only graph query surface. The concrete query methods
 * live on the spine's runtime; this package fixes only that consumers receive a read-only handle.
 */
export type GraphView = Record<string, never>;
