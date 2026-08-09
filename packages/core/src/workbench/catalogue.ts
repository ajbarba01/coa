/**
 * The tool catalogue manifest. The workbench's public surface IS the set of
 * tools the backend adapter registers into the rented loop. To keep the always-loaded tool-schema
 * footprint small (every loaded schema costs the agent context), the catalogue
 * is partitioned: a small KERNEL set of common edit/retrieve verbs is always
 * loaded, and the rest are ON-DEMAND — discovered via {@link findTools} and
 * pulled in via {@link loadTool} through the backend adapter's MCP proxy. Deferred tools
 * (AST-ops, fork, asset-invoke) are absent until their dependencies land.
 */
export type ToolPartition = 'kernel' | 'on-demand';

export interface ToolManifestEntry {
  name: string;
  partition: ToolPartition;
  description: string;
  /** Capability group for frame-level allow-listing (base tools + egress web tools). */
  group?: 'read' | 'write' | 'exec' | 'egress';
}

/** The buildable v1 catalogue, partitioned by the four-gate / schema-budget test. */
export const TOOL_CATALOGUE: readonly ToolManifestEntry[] = [
  // Kernel set — the common verbs worth their standing schema cost. The symbol-read
  // verbs (get_symbol / outline / find_references) are implemented but deliberately
  // unregistered: the symbol index they read has no producers yet, so they could only
  // return empty results. They rejoin the catalogue when the symbol layer is fed.
  {
    name: 'edit_symbol',
    partition: 'kernel',
    group: 'write',
    description: 'lenient localized diff edit (primary)',
  },
  {
    name: 'apply_patch',
    partition: 'kernel',
    group: 'write',
    description: 'whole-file / multi-hunk patch escape',
  },
  {
    name: 'spawn_agent',
    partition: 'kernel',
    // Not a file edit, but starting a subagent kicks off autonomous work coa cannot
    // preview the effects of — the same risk class as a shell command for F2's
    // permission-mode purposes.
    group: 'exec',
    description:
      'start a subagent by name; returns its id immediately — the subagent runs in the ' +
      'background and its result arrives separately, so do not wait for a report here. ' +
      'pass isolate:true to give it its own git worktree (a real, separate checkout) ' +
      'instead of sharing this one — use it for a subagent that will WRITE and whose ' +
      'changes should not collide with concurrent work; leave it off (default) for a ' +
      'read-only subagent or one whose edits this session wants to see land directly',
  },
  // On-demand — pulled in via find_tools/load_tool when needed.
  {
    name: 'get_piece',
    partition: 'on-demand',
    group: 'read',
    description: 'resolve a reference Knowledge Piece',
  },
  {
    name: 'run_checks',
    partition: 'on-demand',
    group: 'read',
    description: 'run the flag pipeline on demand',
  },
  {
    name: 'context_status',
    partition: 'on-demand',
    group: 'read',
    description: 'assembled-context and cap state',
  },
  {
    name: 'get_spec',
    partition: 'on-demand',
    group: 'read',
    description: 'governing spec for a symbol or scope',
  },
];

/** The always-loaded kernel set — the only schemas that cost standing context. */
export function kernelTools(): ToolManifestEntry[] {
  return TOOL_CATALOGUE.filter((tool) => tool.partition === 'kernel');
}

/** `find_tools` — discover on-demand tools by a query over name and description (via the discovery proxy). */
export function findTools(query: string): ToolManifestEntry[] {
  const needle = query.toLowerCase();
  return TOOL_CATALOGUE.filter(
    (tool) =>
      tool.partition === 'on-demand' &&
      (tool.name.includes(needle) || tool.description.toLowerCase().includes(needle)),
  );
}

/** `load_tool` — pull a tool's manifest entry by name so the backend adapter can register its schema. */
export function loadTool(name: string): ToolManifestEntry | undefined {
  return TOOL_CATALOGUE.find((tool) => tool.name === name);
}
