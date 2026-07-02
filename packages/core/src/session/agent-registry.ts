import type { AgentPackage, PackageSummary, Piece, Role, RoleSummary } from '@coa/shared';
import { CORE_PACKAGE_ID } from './assemble-agent.js';
import { baselineStablePieces } from './baseline-pieces.js';

/**
 * The built-in starter registry of {@link AgentPackage}s and {@link Role}s — the
 * first code-shipped set an agent can be assembled from (user-authored `.coa/`
 * packages come later). Tool names reference the M6 catalogue (governed tools) and
 * the backend built-in set (`Read`/`Bash`/…); each is defined once elsewhere and
 * only referenced here, so a tool is never doubled.
 *
 * Nothing is mandatory: `core` (the coa scaffold) and `coa-orientation` are
 * `default` + `advise` (on unless removed, recommended); everything else is
 * `opt-in`. `core` carries the stable baseline behaviors as its Pieces; the
 * resolver adds the volatile model/env tail whenever `core` is included.
 */

function behaviorPiece(name: string, description: string, body: string): Piece {
  return {
    name,
    description,
    body,
    axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
  };
}

export const STARTER_PACKAGES: readonly AgentPackage[] = [
  {
    id: CORE_PACKAGE_ID,
    name: 'Core',
    description:
      'The recommended floor — read, search, the governed kernel, and the baseline conduct.',
    inclusion: 'default',
    advise: true,
    // The stable baseline conduct (identity/safety/tool-use/quality); the resolver
    // adds the volatile model/env tail when this package is included.
    pieces: baselineStablePieces(),
    toolRefs: [
      'Read',
      'Glob',
      'Grep',
      'get_symbol',
      'outline',
      'find_references',
      'why',
      'get_decision',
    ],
  },
  {
    id: 'coa-orientation',
    name: 'coa orientation',
    description: 'A thin layer telling the agent it runs inside coa and how coa governs its work.',
    inclusion: 'default',
    advise: true,
    pieces: [
      behaviorPiece(
        'coa-orientation',
        'what coa is and how it governs',
        'You are running inside coa, a local governance layer over your agent loop. Your file changes are recorded on a change spine and may be flagged for review, and a human can watch and steer in a console. Prefer coa’s governed tools (get_symbol, find_references, edit_symbol) where they are available.',
      ),
    ],
    toolRefs: [],
  },
  {
    id: 'coding',
    name: 'Coding',
    description: 'Governed edits, patches, shell, and checks for writing code.',
    inclusion: 'opt-in',
    toolRefs: ['edit_symbol', 'apply_patch', 'Write', 'Edit', 'Bash', 'run_checks', 'get_spec'],
    pieces: [
      behaviorPiece(
        'pkg-coding',
        'coding conduct',
        'Make the smallest correct change. Prefer edit_symbol for localized edits and apply_patch for multi-hunk changes. Run checks after editing and fix what you break.',
      ),
    ],
  },
  {
    id: 'planning',
    name: 'Planning',
    description: 'Read the assembled context and plan multi-step work before acting.',
    inclusion: 'opt-in',
    toolRefs: ['context_status', 'get_piece'],
    pieces: [
      behaviorPiece(
        'pkg-planning',
        'planning conduct',
        'For multi-step work, outline the plan and surface tradeoffs before large changes. Check the assembled context and governance before editing.',
      ),
    ],
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Search the codebase and the web to gather context.',
    inclusion: 'opt-in',
    toolRefs: ['WebSearch', 'WebFetch', 'get_piece', 'find_references'],
    pieces: [
      behaviorPiece(
        'pkg-research',
        'research conduct',
        'Gather evidence before concluding and note where each fact came from. Prefer the codebase graph over guessing; use the web only for what the repo cannot answer.',
      ),
    ],
  },
  {
    id: 'coa-butler',
    name: 'coa butler',
    description:
      'Meta-capabilities: assemble and configure agents, packages, and roles on the user’s behalf.',
    inclusion: 'opt-in',
    // PLACEHOLDER: the coa-control tool family is not built yet; these are the
    // intended grants (a new governed tool family that acts on coa itself — R-13
    // self-mod territory, governed + audited).
    toolRefs: ['create_agent', 'configure_role', 'list_packages'],
    pieces: [
      behaviorPiece(
        'pkg-coa-butler',
        'butler conduct',
        'You can manage coa itself — assemble and configure agents, packages, and roles for the user. Confirm before creating or changing an agent; these actions are governed and audited.',
      ),
    ],
  },
];

export const STARTER_ROLES: readonly Role[] = [
  {
    id: 'swe',
    name: 'Software Engineer',
    description: 'Writes and edits code, with planning.',
    packageIds: ['coding', 'planning'],
  },
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Investigates and explains; no edits.',
    packageIds: ['research', 'planning'],
  },
];

/** Index a package list by id for the resolver (defaults to the starter set). */
export function packageRegistry(
  packages: readonly AgentPackage[] = STARTER_PACKAGES,
): Map<string, AgentPackage> {
  return new Map(packages.map((pkg) => [pkg.id, pkg]));
}

/** Index a role list by id (defaults to the starter set). */
export function roleRegistry(roles: readonly Role[] = STARTER_ROLES): Map<string, Role> {
  return new Map(roles.map((role) => [role.id, role]));
}

/** Project a {@link Role} to its picker summary (drops the prompt-carrying Pieces). */
export function toRoleSummary(role: Role): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    packageIds: role.packageIds,
  };
}

/** Project an {@link AgentPackage} to its picker summary (drops the prompt-carrying Pieces). */
export function toPackageSummary(pkg: AgentPackage): PackageSummary {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    inclusion: pkg.inclusion,
    ...(pkg.advise !== undefined ? { advise: pkg.advise } : {}),
    toolRefs: pkg.toolRefs,
    ...(pkg.mcpServers !== undefined ? { mcpServers: pkg.mcpServers } : {}),
  };
}

/** The picker summaries of every role in a registry (defaults to the starter set). */
export function roleSummaries(registry: ReadonlyMap<string, Role> = roleRegistry()): RoleSummary[] {
  return [...registry.values()].map(toRoleSummary);
}

/** The picker summaries of every package in a registry (defaults to the starter set). */
export function packageSummaries(
  registry: ReadonlyMap<string, AgentPackage> = packageRegistry(),
): PackageSummary[] {
  return [...registry.values()].map(toPackageSummary);
}
