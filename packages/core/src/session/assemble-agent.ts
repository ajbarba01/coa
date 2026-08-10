import type { AgentPackage, CapabilityFrame, Piece, Role } from '@coa/shared';
import {
  baselineStablePieces,
  baselineVolatilePieces,
  modelPromptOf,
  type BaselineContext,
} from './baseline-pieces.js';
import type { AssemblePiecesContext } from './session.js';

/**
 * The agent-assembly resolver (the session layer) — turn a {@link Role} (+ ad-hoc skills, minus
 * any excluded packages) into compile-ready Pieces + a deduped tool
 * {@link CapabilityFrame} + the external MCP servers to enable + the list of
 * advised-but-absent packages to nudge on.
 *
 * Inclusion (nothing is mandatory; an empty selection degrades to the plain floor): every `default` package is included
 * unless the spec excludes it; `opt-in` packages come in only when the role lists
 * them. The `core` package (which carries the coa scaffold, see below) is a normal
 * `default` package — excluding it degrades the agent to the raw loop.
 *
 * Ordering: package Pieces (defaults in registry order, then the role's opt-ins) →
 * role Pieces → skill Pieces → the volatile baseline tail (model/env, injected
 * only when `core` is included so it lands last, cache-friendly). The
 * `core` package's own Pieces (identity/tone/tool-use) lead because it
 * is the first default. Tools + mcps are set-unions (never doubled); Pieces are
 * deduped by name (first wins). Unknown/excluded ids are dropped, never thrown
 * (degrade, don't cage).
 *
 * Output is a neutral frame (intent). Mapping each tool ref to a backend
 * transport — a Claude built-in vs an `mcp__coa__*` tool vs a loop-driver
 * executor — is the backend port's `renderNative` job, not this resolver's.
 */

/** The package that carries the coa scaffold (its Pieces + the volatile model/env tail). A normal `default` package. */
export const CORE_PACKAGE_ID = 'core';

export interface AgentSpec {
  /** The chosen roles (their opt-in packages + role Pieces), unioned. Empty ⇒ defaults only. */
  roles: readonly Role[];
  /** Opt-in packages the user turned on beyond the roles' (unioned with each role's `packageIds`). */
  packageIds?: readonly string[];
  /** Extra skill Pieces layered on top of the roles (user-added / CHAT-10). */
  skills?: readonly Piece[];
  /** Package ids to turn off (a `default` package the user removed). Authoritative over inclusion. */
  exclude?: readonly string[];
}

export interface AgentAssembly {
  pieces: Piece[];
  frame: CapabilityFrame;
  /** External MCP servers to enable for the session (deduped). */
  mcpServers: string[];
  /** Advised packages that ended up absent — a nudge list for the console/agent (never a block). */
  advisories: string[];
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Keep the first Piece per name, preserving order (an earlier package wins a name collision). */
function dedupeByName(pieces: readonly Piece[]): Piece[] {
  const seen = new Set<string>();
  const out: Piece[] = [];
  for (const piece of pieces) {
    if (seen.has(piece.name)) continue;
    seen.add(piece.name);
    out.push(piece);
  }
  return out;
}

/** Resolve a role + skills − exclusions against the package registry into an {@link AgentAssembly}. */
export function assembleAgent(
  spec: AgentSpec,
  registry: ReadonlyMap<string, AgentPackage>,
  ctx: BaselineContext,
): AgentAssembly {
  const excluded = new Set(spec.exclude ?? []);
  const all = [...registry.values()];
  const defaultIds = all.filter((pkg) => pkg.inclusion === 'default').map((pkg) => pkg.id);

  const rolePackageIds = spec.roles.flatMap((r) => r.packageIds);
  const includedIds = dedupe([...defaultIds, ...rolePackageIds, ...(spec.packageIds ?? [])]).filter(
    (id) => registry.has(id) && !excluded.has(id),
  );
  const included = includedIds
    .map((id) => registry.get(id))
    .filter((pkg): pkg is AgentPackage => pkg !== undefined);

  const toolRefs = dedupe(included.flatMap((pkg) => pkg.toolRefs));
  const mcpServers = dedupe(included.flatMap((pkg) => pkg.mcpServers ?? []));

  const volatile = includedIds.includes(CORE_PACKAGE_ID) ? baselineVolatilePieces(ctx) : [];
  const rolePieces = spec.roles.flatMap((r) => r.pieces ?? []);
  const pieces = dedupeByName([
    ...included.flatMap((pkg) => pkg.pieces),
    ...rolePieces,
    ...(spec.skills ?? []),
    ...volatile,
  ]);

  const advisories = all
    .filter((pkg) => pkg.advise === true && !includedIds.includes(pkg.id))
    .map((pkg) => pkg.id);

  return { pieces, frame: { allow: toolRefs, deny: [] }, mcpServers, advisories };
}

/** ISO `YYYY-MM-DD` in UTC (deterministic — no locale/timezone drift in the prompt). */
function isoDateUtc(when: Date): string {
  return when.toISOString().slice(0, 10);
}

/**
 * Build an `assemblePieces` implementation backed by the package/role registries.
 * **Known** roles are resolved through {@link assembleAgent} — their packages shape
 * the pieces + the (restricting) tool frame, unioned across every role. **Unknown
 * or unset** roles are the permissive floor: the baseline scaffold with an empty
 * frame (every backend tool stays available), so callers that
 * don't pick a role (e.g. the CLI's `coa run`) behave exactly as before.
 * `ctx.roles` is preferred when present; otherwise the single `ctx.role` is used
 * (back-compat). `platform`/`now` are injected so the function stays testable.
 * Skills + exclusions ride the console path later.
 */
export function createRegistryAssemblePieces(deps: {
  roles: ReadonlyMap<string, Role>;
  packages: ReadonlyMap<string, AgentPackage>;
  platform: string;
  shell: string;
  now?: () => Date;
}): (ctx: AssemblePiecesContext) => {
  pieces: Piece[];
  frame: CapabilityFrame;
  mcpServers: string[];
} {
  const now = deps.now ?? ((): Date => new Date());
  return (ctx) => {
    const baselineCtx: BaselineContext = {
      platform: deps.platform,
      shell: deps.shell,
      date: isoDateUtc(now()),
      model: modelPromptOf(ctx),
    };
    const ids = ctx.roles ?? (ctx.role !== undefined && ctx.role !== '' ? [ctx.role] : []);
    const roles = ids.map((id) => deps.roles.get(id)).filter((r): r is Role => r !== undefined);
    if (roles.length === 0) {
      // The permissive floor still injects user-added skills — a roleless session
      // (an agent with no role) must not silently drop what the library resolved
      // for it. Skills sit between the stable head and the volatile tail, the same
      // position `assembleAgent` gives them, so the cache-warm ordering holds.
      return {
        pieces: [
          ...baselineStablePieces(),
          ...(ctx.skills ?? []),
          ...baselineVolatilePieces(baselineCtx),
        ],
        frame: { allow: [], deny: [] },
        mcpServers: [],
      };
    }
    const spec: AgentSpec = {
      roles,
      ...(ctx.packageIds !== undefined ? { packageIds: ctx.packageIds } : {}),
      ...(ctx.exclude !== undefined ? { exclude: ctx.exclude } : {}),
      ...(ctx.skills !== undefined ? { skills: ctx.skills } : {}),
    };
    const { pieces, frame, mcpServers } = assembleAgent(spec, deps.packages, baselineCtx);
    return { pieces, frame, mcpServers };
  };
}
