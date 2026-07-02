import { z } from 'zod';
import { pieceSchema } from './piece.js';

/**
 * The agent-assembly composition model (TAX-6). An {@link AgentPackage} is a
 * reusable capability bundle — a named set of **skills** (Pieces) + **tools**
 * (individual grants) + **mcps** (whole external MCP servers) it pulls in. A
 * {@link Role} is a *composition of packages* plus its own role data (role-level
 * Pieces). The resolver unions everything and dedupes, so a tool is never doubly
 * defined; tools/mcps are REFERENCED by name (each is defined once elsewhere).
 *
 * Nothing is mandatory (D85 strict-superset / SC-1 "help never cage"): a package
 * is either `default` (on unless excluded) or `opt-in` (off unless a role adds
 * it), and `advise` marks a package coa recommends — the resolver reports advised
 * packages that are absent so the console/agent can nudge, never force. This is
 * the lean runtime model M8's resolver consumes; the heavier versioned form is
 * {@link BundleManifest}. M0 owns the types; the resolver is M8's.
 */

export const agentPackageSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** `default` = on unless excluded; `opt-in` = off unless a role lists it. Never mandatory. */
  inclusion: z.enum(['default', 'opt-in']),
  /** coa recommends this package: if it ends up absent, the resolver reports it as an advisory (a nudge, not a block). */
  advise: z.boolean().optional(),
  /** Behavior/knowledge Pieces ("skills") this package contributes. */
  pieces: z.array(pieceSchema),
  /** Individual tool grants — references into the catalogue / built-in set; deduped at assembly. */
  toolRefs: z.array(z.string()),
  /** Whole external MCP servers this package pulls in — references, resolved to configs at wiring. */
  mcpServers: z.array(z.string()).optional(),
});
export type AgentPackage = z.infer<typeof agentPackageSchema>;

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** The opt-in packages this role turns on (default packages come in on their own unless excluded). */
  packageIds: z.array(z.string()),
  /** Role-level Pieces — the "role data" a role contributes beyond its packages. */
  pieces: z.array(pieceSchema).optional(),
});
export type Role = z.infer<typeof roleSchema>;

/**
 * The picker-facing projections of a {@link Role}/{@link AgentPackage} — the shape
 * the `listRoles`/`listPackages` verbs return so the console can offer an
 * assembly UI. Pieces (the full prompt bodies) are dropped: the console picks by
 * id/description, not by inspecting prompt text. Kept as their own wire types so
 * the console never takes a piece-carrying payload it cannot render.
 */
export const roleSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  packageIds: z.array(z.string()),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

export const packageSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  inclusion: z.enum(['default', 'opt-in']),
  advise: z.boolean().optional(),
  toolRefs: z.array(z.string()),
  mcpServers: z.array(z.string()).optional(),
});
export type PackageSummary = z.infer<typeof packageSummarySchema>;
