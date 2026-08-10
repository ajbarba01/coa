import { pieceSchema } from '@coa/shared';
import type {
  AgentSkillConfig,
  CapabilityFrame,
  InvocableSkill,
  LibraryScope,
  LibraryView,
  McpServerEntry,
  Piece,
  SkillFile,
} from '@coa/shared';
import { skillToPiece } from './skill-piece.js';

/**
 * The library → session injection seam: fold a {@link LibraryView} into the
 * per-session facts the daemon needs — the effective (enabled, resolvable,
 * scope-folded) skill and MCP sets, an agent's configured skills resolved to
 * injectable Pieces, a slash invocation's one-turn body, and the external MCP
 * server map handed to the backend. All pure functions over the view; the one
 * stateful edge ({@link createSessionLibraryPort}) closes over the live
 * `LibraryService` read so every turn resolves fresh from disk (the library's
 * no-cache posture — an edit in another window is visible on the next send).
 *
 * Scope precedence is PROJECT over PERSONAL, by case-folded library name — the
 * same most-specific-wins fold `agent-defs.ts` uses for agent definitions
 * (adapted from VS Code's per-scope extension precedence: a workspace-level
 * install shadows the user-level one of the same identity).
 */

/** One skill as sessions see it after the scope fold. `name` is the LIBRARY identity. */
export interface EffectiveSkill {
  name: string;
  scope: LibraryScope;
  skill: SkillFile;
}

/** One MCP server as sessions see it after the scope fold. `name` is the LIBRARY identity. */
export interface EffectiveMcpServer {
  name: string;
  scope: LibraryScope;
  config: McpServerEntry;
}

/**
 * The library skills a session may consume: enabled, resolvable (`status
 * 'ok'` with content), project shadowing personal on a name collision. Sorted
 * by name so every consumer sees one deterministic order.
 */
export function effectiveSkills(view: LibraryView): EffectiveSkill[] {
  const byName = new Map<string, EffectiveSkill>();
  for (const entry of view.entries) {
    if (entry.record.kind !== 'skill' || !entry.record.enabled) continue;
    if (entry.status !== 'ok' || entry.skill === undefined) continue;
    const key = entry.record.name.toLowerCase();
    const existing = byName.get(key);
    if (existing === undefined || (existing.scope === 'personal' && entry.scope === 'project')) {
      byName.set(key, { name: entry.record.name, scope: entry.scope, skill: entry.skill });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The library MCP servers a session may consume — same fold as {@link effectiveSkills}. */
export function effectiveMcpServers(view: LibraryView): EffectiveMcpServer[] {
  const byName = new Map<string, EffectiveMcpServer>();
  for (const entry of view.entries) {
    if (entry.record.kind !== 'mcp' || !entry.record.enabled) continue;
    if (entry.status !== 'ok' || entry.mcp === undefined) continue;
    const key = entry.record.name.toLowerCase();
    const existing = byName.get(key);
    if (existing === undefined || (existing.scope === 'personal' && entry.scope === 'project')) {
      byName.set(key, { name: entry.record.name, scope: entry.scope, config: entry.mcp });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The composer's `/skill` picker rows: every effective skill's name + description. */
export function listInvocableSkills(view: LibraryView): InvocableSkill[] {
  return effectiveSkills(view).map((e) => ({
    name: e.name,
    description: e.skill.description,
    scope: e.scope,
  }));
}

/**
 * An agent's configured skills resolved against the library — what the session
 * layer injects and what the drift key records.
 */
export interface ResolvedSkillSet {
  /** One Piece per resolved skill (delivery-mapped push/pull, keyed by the LIBRARY
   *  name), plus — when any skill is `disclosure` — the one aggregated index Piece
   *  that advertises the pullable set in the prompt. */
  pieces: Piece[];
  /** The drift-key slice: exactly the skills that RESOLVED (the compiled prompt
   *  reflects reality, so a skill appearing/vanishing in the library IS drift). */
  selection: AgentSkillConfig[];
  /** Configured names that did not resolve (unknown / disabled / broken source) —
   *  surfaced by the caller, never silently dropped. */
  missing: string[];
}

/** The aggregated advertisement Piece's name (deduped like any other Piece name). */
export const SKILL_INDEX_PIECE_NAME = 'library-skills-index';

/** The governed catalogue tool the advertisement below names as the pull channel. */
const PIECE_PULL_TOOL = 'get_piece';

/**
 * The progressive-disclosure advertisement: `pull` Pieces route to the neutral
 * config's `onDemandPullable` (names only — no renderer folds them into the
 * prompt), so without this index a disclosure skill would be invisible. One
 * aggregated push Piece carries every disclosure skill's name + description and
 * points the model at the EXISTING `get_piece` tool for the body — the pull
 * channel the Piece axes already model, not a parallel mechanism. (The
 * vanilla-SKILL.md disclosure floor, per Claude Code's own skill preamble
 * convention: advertise name+description, load the body on demand.)
 *
 * Built optimistically here — resolution runs before assembly, so the session's
 * tool frame is not known yet. {@link reconcileSkillIndex} is what makes the
 * claim true: it drops this Piece on a session whose frame carries no pull tool.
 */
function skillIndexPiece(skills: readonly { name: string; description: string }[]): Piece {
  const rows = skills
    .map((s) => `- ${s.name}${s.description === '' ? '' : ` — ${s.description}`}`)
    .join('\n');
  return pieceSchema.parse({
    name: SKILL_INDEX_PIECE_NAME,
    description: 'the on-demand skills available to this agent',
    body: `The following skills are available on demand. When one's description matches the task at hand, load its full instructions with the get_piece tool (ref = the skill name) before proceeding.\n\n${rows}`,
    axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
  });
}

/**
 * Resolve an agent's skill configs against the library. Duplicate config names
 * (case-folded) keep the first occurrence; each resolved skill's Piece is keyed
 * by the LIBRARY name so config, invocation, and `get_piece` all agree on one
 * identity even when the SKILL.md front-matter names itself differently.
 */
export function resolveSkillConfigs(
  view: LibraryView,
  configs: readonly AgentSkillConfig[],
): ResolvedSkillSet {
  const effective = new Map(effectiveSkills(view).map((e) => [e.name.toLowerCase(), e]));
  const pieces: Piece[] = [];
  const selection: AgentSkillConfig[] = [];
  const missing: string[] = [];
  const disclosed: { name: string; description: string }[] = [];
  const seen = new Set<string>();

  for (const config of configs) {
    const key = config.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const found = effective.get(key);
    if (found === undefined) {
      missing.push(config.name);
      continue;
    }
    pieces.push(skillToPiece({ ...found.skill, name: found.name }, config.delivery));
    selection.push({ name: found.name, delivery: config.delivery });
    if (config.delivery === 'disclosure') {
      disclosed.push({ name: found.name, description: found.skill.description });
    }
  }

  if (disclosed.length > 0) pieces.push(skillIndexPiece(disclosed));
  return { pieces, selection, missing };
}

/**
 * Does this session's resolved frame actually carry the pull tool the
 * advertisement names? An EMPTY `allow` is the unrestricted floor (every
 * catalogue tool is registered); a restricting frame carries exactly the tools it
 * names, and `get_piece` rides only on the packages that list it. So an agent
 * whose roles bring none of them has no pull channel at all.
 */
export function grantsPiecePull(frame: CapabilityFrame): boolean {
  if (frame.deny.includes(PIECE_PULL_TOOL)) return false;
  return frame.allow.length === 0 || frame.allow.includes(PIECE_PULL_TOOL);
}

/**
 * Keep the disclosure advertisement honest against the frame the session actually
 * resolved: drop the index Piece when this session carries no `get_piece`, and
 * name the skills that went unadvertised so the caller can surface them.
 *
 * Advertising a tool the session does not have would fail the pull as
 * tool-not-found with nothing surfaced — the model would be told to reach for a
 * hole. The alternative degrade (silently promoting `disclosure` to `push`) was
 * rejected: it rewrites the user's per-skill delivery choice, inflates the prompt
 * without asking, and leaves the recorded skill selection describing a prompt that
 * was never compiled. Saying nothing and surfacing why is the honest floor — the
 * skill stays `/name`-invocable, and the user can add a granting package or flip
 * the delivery themselves.
 *
 * Only the compile path can run this: the frame exists only once assembly has
 * resolved, and a frozen turn already carries a prompt this ran against.
 */
export function reconcileSkillIndex(
  pieces: readonly Piece[],
  frame: CapabilityFrame,
): { pieces: Piece[]; unadvertised: string[] } {
  const advertised = pieces.some((p) => p.name === SKILL_INDEX_PIECE_NAME);
  if (!advertised || grantsPiecePull(frame)) return { pieces: [...pieces], unadvertised: [] };
  return {
    pieces: pieces.filter((p) => p.name !== SKILL_INDEX_PIECE_NAME),
    unadvertised: pieces
      .filter((p) => p.name !== SKILL_INDEX_PIECE_NAME && p.axes.delivery === 'pull')
      .map((p) => p.name),
  };
}

/** A slash invocation's resolved payload: the body that reaches that one turn's context. */
export interface InvokedSkillPayload {
  name: string;
  body: string;
}

/** Resolve one explicitly invoked skill (case-insensitive); `undefined` = not invocable. */
export function resolveInvocation(
  view: LibraryView,
  name: string,
): InvokedSkillPayload | undefined {
  const key = name.toLowerCase();
  const found = effectiveSkills(view).find((e) => e.name.toLowerCase() === key);
  return found === undefined ? undefined : { name: found.name, body: found.skill.body };
}

/** The external MCP server map a session delivers to its backend (name → config). */
export function resolveMcpServers(view: LibraryView): Record<string, McpServerEntry> {
  return Object.fromEntries(effectiveMcpServers(view).map((e) => [e.name, e.config]));
}

/** The live library reads the session port closes over. */
export interface SessionLibraryDeps {
  /** A FRESH library view (the `LibraryService.list()` read — never cached). */
  list: () => LibraryView;
  /**
   * Register a resolved skill Piece into the kernel piece store, so the governed
   * `get_piece` tool can serve a disclosure skill's body on demand (the pull
   * channel's other half). Registration is an idempotent overwrite of an
   * in-memory projection; absent ⇒ disclosure degrades to the advertisement +
   * slash invocation only.
   */
  registerPiece?: (piece: Piece) => void;
}

/** The one library port the {@link import('../session/session-service.js').SessionService} consumes. */
export interface SessionLibraryPort {
  resolveSkills: (configs: readonly AgentSkillConfig[]) => ResolvedSkillSet;
  invoke: (name: string) => InvokedSkillPayload | undefined;
  mcpServers: () => Record<string, McpServerEntry>;
}

/** Bind the pure resolution functions to the live library read (+ the kernel's piece store). */
export function createSessionLibraryPort(deps: SessionLibraryDeps): SessionLibraryPort {
  return {
    resolveSkills: (configs) => {
      const resolved = resolveSkillConfigs(deps.list(), configs);
      if (deps.registerPiece !== undefined) {
        for (const piece of resolved.pieces) deps.registerPiece(piece);
      }
      return resolved;
    },
    invoke: (name) => resolveInvocation(deps.list(), name),
    mcpServers: () => resolveMcpServers(deps.list()),
  };
}
