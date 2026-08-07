import { z } from 'zod';
import {
  agentColorSchema,
  agentDiagnosticSchema,
  agentFileSchema,
  agentIconSchema,
  agentScopeSchema,
  agentSummarySchema,
  claudeReasoningSchema,
  packageSummarySchema,
  roleSummarySchema,
  AGENT_COLOR_NAMES,
  AGENT_ICON_NAMES,
  type AgentColor,
  type AgentDiagnostic,
  type AgentFile,
  type AgentIcon,
  type AgentScope,
  type AgentSummary,
  type PackageSummary,
  type RoleSummary,
} from '@coa/shared';

/** The agent-identity vocabulary, the agent wire shapes, and the scope/diagnostic
 *  types live in the shared wire package now — the daemon owns the registry (`listAgents`/`saveAgent`/
 *  `deleteAgent`), so this re-exports the shared schemas rather than defining a
 *  console-local copy that could drift from them. */
export {
  AGENT_ICON_NAMES,
  AGENT_COLOR_NAMES,
  agentIconSchema,
  agentColorSchema,
  agentFileSchema,
  agentSummarySchema,
  agentScopeSchema,
  agentDiagnosticSchema,
  type AgentIcon,
  type AgentColor,
  type AgentFile,
  type AgentSummary,
  type AgentScope,
  type AgentDiagnostic,
};

export const AgentListSchema = z.array(agentSummarySchema);

/** The floor: what an agents list parses to when missing/corrupt/invalid.
 *  (matches `parseSettings`'s full-defaults-on-any-issue posture). */
export const DEFAULT_AGENT_LIST: AgentSummary[] = [];

/** Parse the daemon's `listAgents` payload at the edge; any invalid payload
 *  degrades to the empty floor so the console boots to "No agents yet" — never to
 *  a mock, never throwing. The daemon guarantees unique refs across the merged
 *  built-in/personal/project scopes, so no client-side dedupe is needed here. */
export function parseAgents(raw: unknown): AgentSummary[] {
  const parsed = AgentListSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data : DEFAULT_AGENT_LIST;
}

/** The daemon's full `listAgents` envelope: the merged agent list PLUS any load
 *  diagnostics (a duplicate ref, an invalid file, a file that tries to name its own
 *  ref) — reported, never swallowed. `saveAgent`/`deleteAgent` widen it further; the
 *  IPC boundary and the renderer both validate against this same shape so neither
 *  can drift into trusting a bare array again. */
export const ListAgentsResultSchema = z.object({
  agents: AgentListSchema,
  diagnostics: z.array(agentDiagnosticSchema),
});
export type ListAgentsResult = z.infer<typeof ListAgentsResultSchema>;

/** The floor for the full envelope: both halves empty. */
export const DEFAULT_LIST_AGENTS_RESULT: ListAgentsResult = {
  agents: DEFAULT_AGENT_LIST,
  diagnostics: [],
};

/** Parse the daemon's `listAgents` envelope at the edge — the list AND its
 *  diagnostics, so a malformed or duplicated agent file surfaces as a reason
 *  instead of the agent just silently not being there. An invalid payload degrades
 *  both halves to their empty floor, matching `parseAgents`'s posture. */
export function parseAgentsResult(raw: unknown): ListAgentsResult {
  const parsed = ListAgentsResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_LIST_AGENTS_RESULT;
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
  /** The session that spawned this one (mirrors `SessionMeta.parent`); absent ⇒ a
   *  root session a person started — the overwhelming common case. */
  parent: z.string().optional(),
  /** This session's family-tree root — itself, for a root; the SAME id at every
   *  depth below it (mirrors `SessionMeta.root`). Stored rather than derived, since
   *  a `parent` chain can cycle and a stored root cannot — see `session-tree.ts`. */
  root: z.string().optional(),
  /** This session's own recorded spend so far; absent ⇒ not tracked. A family
   *  tree's total is the sum of every session's `costUsd` that shares its root
   *  (`session-tree.ts`'s `groupSessionTree`), never just the root's own. */
  costUsd: z.number().optional(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionListSchema = z.array(SessionSummarySchema);

/** The agent-assembly catalogue the console picker reads — the real `listRoles`/
 *  `listPackages` wire shapes, re-exported from the shared wire package so the edge validates the
 *  daemon's payload (not a hand-mirrored copy). Pieces are already dropped upstream. */
export { roleSummarySchema, packageSummarySchema, type RoleSummary, type PackageSummary };
export const RoleSummaryListSchema = z.array(roleSummarySchema);
export const PackageSummaryListSchema = z.array(packageSummarySchema);
