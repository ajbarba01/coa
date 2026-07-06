import { z } from 'zod';
import {
  claudeReasoningSchema,
  packageSummarySchema,
  roleSummarySchema,
  type PackageSummary,
  type RoleSummary,
} from '@coa/shared';

/** The curated agent-identity vocabularies. The console-ui kit owns the visual
 *  mapping (glyph/classes); these are the wire names. An unknown name degrades to
 *  the default rather than failing the read (drop-unknown posture at the edge). */
export const AGENT_ICON_NAMES = [
  'bot',
  'hammer',
  'wrench',
  'flask',
  'shield',
  'book',
  'bug',
  'search',
  'pen',
  'branch',
  'terminal',
  'database',
  'layers',
  'eye',
  'compass',
  'sparkles',
] as const;
export const AgentIconSchema = z.enum(AGENT_ICON_NAMES).catch('bot');
export type AgentIcon = z.infer<typeof AgentIconSchema>;

/** Categorical identity colors — Okabe-Ito-anchored, theme-tuned in the kit's
 *  tokens. Brass is deliberately absent: an agent never dresses as the system. */
export const AGENT_COLOR_NAMES = [
  'slate',
  'sky',
  'blue',
  'teal',
  'green',
  'mauve',
  'violet',
  'coral',
] as const;
export const AgentColorSchema = z.enum(AGENT_COLOR_NAMES).catch('slate');
export type AgentColor = z.infer<typeof AgentColorSchema>;

/** An agent (= a Role, SPEC CON-1) as the console lists it. Mock today, shaped
 *  like the future `listRoles` read so the swap is a data-source change. `scope`
 *  is the personal-vs-project split: project agents live committed in `.coa/`
 *  (shared via git); personal agents are user-level, outside the repo. */
export const AgentSummarySchema = z.object({
  ref: z.string(),
  name: z.string(),
  icon: AgentIconSchema.default('bot'),
  color: AgentColorSchema.default('slate'),
  scope: z.enum(['project', 'personal']),
  model: z.string().optional(),
  /** The backend of the chosen model (set when a model is picked from the merged list); absent ⇒ default. */
  provider: z.string().optional(),
  /** The agent's faithful reasoning config; absent ⇒ the backend/SDK default depth. */
  reasoning: claudeReasoningSchema.optional(),
  /** The registry roles this agent runs as (`listRoles` ids); absent/empty ⇒ the
   *  permissive baseline floor (no role restriction). Drives the `roles` sent to
   *  `createSession`. */
  roles: z.array(z.string()).optional(),
  /** Opt-in packages the user added on top of the role's (`listPackages` ids). */
  packageIds: z.array(z.string()).optional(),
  /** Default packages the user turned off (authoritative over inclusion, like the resolver's). */
  exclude: z.array(z.string()).optional(),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const AgentListSchema = z.array(AgentSummarySchema);

/** The floor: what an agents file parses to when missing/corrupt/invalid.
 *  (matches `parseSettings`'s full-defaults-on-any-issue posture). */
export const DEFAULT_AGENT_LIST: AgentSummary[] = [];

/** Collapse agents sharing a `ref` (the identity/React key) to the first occurrence.
 *  The ref must be unique; a past creation bug could persist two agents under one ref,
 *  which renders as duplicate keys and cannot be individually deleted — reading dedupes
 *  so a corrupted store self-heals on the next load. */
function dedupeByRef(agents: AgentSummary[]): AgentSummary[] {
  const seen = new Set<string>();
  return agents.filter((a) => {
    if (seen.has(a.ref)) return false;
    seen.add(a.ref);
    return true;
  });
}

/** Parse a persisted agents blob; any invalid blob (or `undefined`) yields an
 *  empty list so the console boots to the clean "No agents yet" empty state —
 *  never to `MOCK_AGENTS`, never throwing. Degrades icon/color/scope via their
 *  own `.catch` defaults. */
export function parseAgents(raw: unknown): AgentSummary[] {
  const parsed = AgentListSchema.safeParse(raw ?? []);
  return parsed.success ? dedupeByRef(parsed.data) : DEFAULT_AGENT_LIST;
}

/** A conversation session pointer. Every session is bound to exactly one agent
 *  (createSession takes a role), which is what lets the chat rail and the session
 *  switcher stay one linked selection instead of two axes. Mock today (no
 *  session-list verb; rides the deferred conversation-store seam). */
export const SessionSummarySchema = z.object({
  id: z.string(),
  agentRef: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  /** The provider/model/reasoning this session is PINNED to (what it actually ran on).
   *  Absent until the first turn pins it. The console sends this back on the next turn
   *  so an existing conversation keeps routing to the backend its memory lives in,
   *  rather than silently re-deriving the selection from (mock) agent state. */
  provider: z.string().optional(),
  model: z.string().optional(),
  reasoning: claudeReasoningSchema.optional(),
  /** The source config (role selection + package selection) the session's RUNNING
   *  prompt was compiled from — surfaced so the console can flag prompt drift
   *  predictively (the config a send would use vs. what the live prompt reflects).
   *  Absent until the first turn freezes a prompt; cleared by a recompile. `roles`
   *  is a sorted copy (selection order never spuriously trips drift). */
  promptConfig: z
    .object({
      roles: z.array(z.string()).optional(),
      packageIds: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .optional(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionListSchema = z.array(SessionSummarySchema);

/** The persisted-user-agents file shape: a self-describing version + the list.
 *  The list is the authoritative agent catalogue; a missing/corrupt/unknown-version
 *  blob is rejected (the caller degrades to the empty floor, like `parseSettings`). */
export const PersistedAgentsSchema = z.object({
  schema_version: z.number().int().min(1).max(1).default(1),
  agents: AgentListSchema.default([]),
});
export type PersistedAgents = z.infer<typeof PersistedAgentsSchema>;

/** Parse a persisted-agents file blob; `undefined`/corrupt data **or** a version
 *  other than 1 yields `undefined` (caller degrades to `DEFAULT_AGENT_LIST`) —
 *  this is the quarantine posture, matching the WAL reader's "refuse to start
 *  on an unknown version, never silently downgrade" rule. */
export function parsePersistedAgents(raw: unknown): AgentSummary[] | undefined {
  // Quarantine requires an explicit, recognized envelope: a missing file (`undefined`),
  // a non-object, or an object with no `schema_version` at all is rejected rather than
  // silently defaulted to an empty list. Only a present-but-unknown version (or otherwise
  // invalid blob) is what the schema's `min(1).max(1)` then rejects.
  if (raw === null || typeof raw !== 'object' || !('schema_version' in raw)) return undefined;
  const parsed = PersistedAgentsSchema.safeParse(raw);
  return parsed.success ? dedupeByRef(parsed.data.agents) : undefined;
}

/** The agent-assembly catalogue the console picker reads — the real `listRoles`/
 *  `listPackages` wire shapes, re-exported from M0 so the edge validates the
 *  daemon's payload (not a hand-mirrored copy). Pieces are already dropped upstream. */
export { roleSummarySchema, packageSummarySchema, type RoleSummary, type PackageSummary };
export const RoleSummaryListSchema = z.array(roleSummarySchema);
export const PackageSummaryListSchema = z.array(packageSummarySchema);
