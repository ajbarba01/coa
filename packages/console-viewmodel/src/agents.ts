import { z } from 'zod';
import { claudeReasoningSchema } from '@coa/shared';

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
  /** The agent's faithful reasoning config; absent ⇒ the backend/SDK default depth. */
  reasoning: claudeReasoningSchema.optional(),
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
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionListSchema = z.array(SessionSummarySchema);
