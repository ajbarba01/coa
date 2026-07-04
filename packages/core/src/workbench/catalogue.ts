/**
 * M6 — the tool catalogue manifest (D99/D100). M6's public surface IS the set of
 * tools M9 registers into the rented loop. To keep the always-loaded tool-schema
 * footprint small (every loaded schema costs the agent context), the catalogue
 * is partitioned: a small KERNEL set of common edit/retrieve verbs is always
 * loaded, and the rest are ON-DEMAND — discovered via {@link findTools} and
 * pulled in via {@link loadTool} through M9's MCP proxy. Deferred tools
 * (AST-ops, fork, asset-invoke) are absent until their dependencies land (D85).
 */
export type ToolPartition = 'kernel' | 'on-demand';

export interface ToolManifestEntry {
  name: string;
  partition: ToolPartition;
  description: string;
  /** Capability group for frame-level allow-listing (base tools + egress web tools). */
  group?: 'read' | 'write' | 'exec' | 'egress';
}

/** The buildable v1 catalogue, partitioned by the D99 four-gate / D100 schema-budget test. */
export const TOOL_CATALOGUE: readonly ToolManifestEntry[] = [
  // Kernel set — the common verbs worth their standing schema cost.
  { name: 'get_symbol', partition: 'kernel', description: 'distilled symbol slice by name or ref' },
  { name: 'outline', partition: 'kernel', description: 'structural outline of a file' },
  { name: 'find_references', partition: 'kernel', description: 'reference sites of a symbol' },
  {
    name: 'edit_symbol',
    partition: 'kernel',
    description: 'lenient localized diff edit (primary)',
  },
  { name: 'apply_patch', partition: 'kernel', description: 'whole-file / multi-hunk patch escape' },
  // On-demand — pulled in via find_tools/load_tool when needed.
  { name: 'get_piece', partition: 'on-demand', description: 'resolve a reference Knowledge Piece' },
  { name: 'run_checks', partition: 'on-demand', description: 'run the flag pipeline on demand' },
  {
    name: 'context_status',
    partition: 'on-demand',
    description: 'assembled-context and cap state',
  },
  { name: 'why', partition: 'on-demand', description: 'rationale for a constraint or decision' },
  { name: 'get_spec', partition: 'on-demand', description: 'governing spec for a symbol or scope' },
  { name: 'get_decision', partition: 'on-demand', description: 'a numbered decision-log entry' },
];

/** The always-loaded kernel set (D100) — the only schemas that cost standing context. */
export function kernelTools(): ToolManifestEntry[] {
  return TOOL_CATALOGUE.filter((tool) => tool.partition === 'kernel');
}

/** `find_tools` — discover on-demand tools by a query over name and description (D100 proxy). */
export function findTools(query: string): ToolManifestEntry[] {
  const needle = query.toLowerCase();
  return TOOL_CATALOGUE.filter(
    (tool) =>
      tool.partition === 'on-demand' &&
      (tool.name.includes(needle) || tool.description.toLowerCase().includes(needle)),
  );
}

/** `load_tool` — pull a tool's manifest entry by name so M9 can register its schema. */
export function loadTool(name: string): ToolManifestEntry | undefined {
  return TOOL_CATALOGUE.find((tool) => tool.name === name);
}
