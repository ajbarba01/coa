import { invocableSkillSchema, libraryViewSchema } from '@coa/shared';
import { z } from 'zod';

/**
 * The skills/MCP library wire shapes the console edge validates — re-exported
 * from the shared wire package (the daemon owns the stores; `listLibrary` is the
 * ONE read the Library surface renders), so the console can never drift into a
 * hand-mirrored copy. Only the envelope shapes the RPC verbs wrap around them
 * (`listSkills`' `{skills}` row list, `unlinkLibrary`'s `{removed}`) live here.
 */
export {
  agentSkillConfigSchema,
  discoveredMcpServerSchema,
  discoveredSkillSchema,
  invocableSkillSchema,
  libraryDiagnosticSchema,
  libraryEntryViewSchema,
  librarySummarySchema,
  libraryViewSchema,
  mcpServerEntrySchema,
  skillFileSchema,
  type AgentSkillConfig,
  type DiscoveredMcpServer,
  type DiscoveredSkill,
  type InvocableSkill,
  type LibraryDiagnostic,
  type LibraryDrift,
  type LibraryEntryView,
  type LibraryKind,
  type LibraryRecord,
  type LibraryScope,
  type LibrarySummary,
  type LibraryView,
  type McpLayer,
  type McpServerEntry,
  type SkillFile,
  type SkillOrigin,
} from '@coa/shared';

/** `listLibrary`/`rescanLibrary`'s reply — the one read the Library surface renders. */
export const LibraryViewResultSchema = libraryViewSchema;

/** `listSkills`' reply: the effective (enabled, resolvable, scope-folded) skill rows
 *  the composer's slash popover and the per-agent picker both draw from. */
export const ListSkillsResultSchema = z.object({ skills: z.array(invocableSkillSchema) });
export type ListSkillsResult = z.infer<typeof ListSkillsResultSchema>;

/** `unlinkLibrary`'s reply — `removed: false` means there was nothing there to
 *  remove (a second unlink is a no-op, not an error). */
export const UnlinkLibraryResultSchema = z.object({ removed: z.boolean() });
export type UnlinkLibraryResult = z.infer<typeof UnlinkLibraryResultSchema>;
