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

/** The agent-assembly catalogue the console picker reads — the real `listRoles`/
 *  `listPackages` wire shapes, re-exported from M0 so the edge validates the
 *  daemon's payload (not a hand-mirrored copy). Pieces are already dropped upstream. */
export { roleSummarySchema, packageSummarySchema, type RoleSummary, type PackageSummary };
export const RoleSummaryListSchema = z.array(roleSummarySchema);
export const PackageSummaryListSchema = z.array(packageSummarySchema);
