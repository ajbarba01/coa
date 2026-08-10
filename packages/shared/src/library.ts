import { z } from 'zod';

/**
 * The library domain — coa's first-class management surface for **skills** and
 * **MCP servers**. The stores are declarative files (the store IS the source of
 * truth, surfaces render it — Bruno's filesystem-as-database posture); these are
 * the wire/record types the stores, the scanner, and the console all agree on.
 *
 * Two link modes: `reference` (the default — a pointer to the source path,
 * reads always resolve the source live) and `copy` (materialized into the
 * project store, committable, carrying provenance so drift against the source
 * is computable on demand — no file watcher, hash-on-rescan only).
 */

export const libraryKindSchema = z.enum(['skill', 'mcp']);
export type LibraryKind = z.infer<typeof libraryKindSchema>;

/** `personal` lives under the user's coa home (`~/.coa/library`); `project` under `<root>/.coa/library`. */
export const libraryScopeSchema = z.enum(['personal', 'project']);
export type LibraryScope = z.infer<typeof libraryScopeSchema>;

export const libraryLinkModeSchema = z.enum(['reference', 'copy']);
export type LibraryLinkMode = z.infer<typeof libraryLinkModeSchema>;

/**
 * A parsed `SKILL.md`. `name`/`description` are the two keys coa reads (Claude
 * Code's convention: `name` falls back to the skill's directory name); every
 * OTHER front-matter key rides through verbatim in `ccKeys` (the same
 * round-trip posture as {@link import('./piece.js').pieceSchema}).
 */
export const skillFileSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  /** The markdown body below the front-matter block, verbatim. */
  body: z.string(),
  /** Foreign front-matter keys kept verbatim — never interpreted, never dropped. */
  ccKeys: z.record(z.string(), z.unknown()).optional(),
});
export type SkillFile = z.infer<typeof skillFileSchema>;

/**
 * One MCP server config, normalized from the on-disk shapes (`.mcp.json`,
 * `~/.claude.json`): a stdio server (`command`/`args`/`env`; the default when
 * the source omits `type`) or a remote one (`sse`/`http` + `url`/`headers`).
 * `extra` carries any source keys coa does not model (round-trip, never a lie).
 */
export const mcpServerEntrySchema = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    transport: z.literal('sse'),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    transport: z.literal('http'),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type McpServerEntry = z.infer<typeof mcpServerEntrySchema>;

/**
 * Where a library entry came from: the `SKILL.md` file path (skills) or the
 * config file path + the server's key inside it (MCP). Present on BOTH modes —
 * a reference resolves through it live; a copy keeps it as the drift baseline.
 */
export const librarySourceSchema = z.object({
  path: z.string().min(1),
  /** MCP only — the server's name inside the config file. */
  serverName: z.string().optional(),
});
export type LibrarySource = z.infer<typeof librarySourceSchema>;

/** Copy provenance: where the bytes came from and their hash at copy time (the drift baseline). */
export const libraryProvenanceSchema = z.object({
  sourcePath: z.string().min(1),
  /** sha-256 hex of the source content at copy time (skill: the SKILL.md bytes; mcp: the canonical-JSON server entry). */
  contentHash: z.string().min(1),
});
export type LibraryProvenance = z.infer<typeof libraryProvenanceSchema>;

/**
 * A library entry's name must be a single safe path segment: a copied skill's
 * name becomes a directory under the store, and unlink removes that directory
 * recursively. Enforced HERE, at the schema, so a crafted name (`../…`, drive
 * letters, separators) in a store file — a committed, clone-carried artifact —
 * never loads as a live record, not just refused at the link/copy API edge.
 */
export const LIBRARY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * One record in a store file. Deliberately scope-free: the store's directory IS
 * the scope (the same posture as agent definitions — a record cannot disagree
 * with where it lives). `name` is the identity within (kind, store).
 */
export const libraryRecordSchema = z
  .object({
    name: z
      .string()
      .regex(LIBRARY_NAME_PATTERN, 'a library name must be a single safe path segment'),
    kind: libraryKindSchema,
    mode: libraryLinkModeSchema,
    /** Off ⇒ excluded from injection/session wiring, still listed (a pass-through, never a cage). */
    enabled: z.boolean().default(true),
    source: librarySourceSchema,
    /** Copies only. */
    provenance: libraryProvenanceSchema.optional(),
    /** MCP copies only — the materialized server config (the store is the source of truth). */
    mcp: mcpServerEntrySchema.optional(),
  })
  .superRefine((record, ctx) => {
    if (record.mode === 'copy' && record.provenance === undefined) {
      ctx.addIssue({ code: 'custom', message: 'a copy record must carry provenance' });
    }
    if (record.mode === 'copy' && record.kind === 'mcp' && record.mcp === undefined) {
      ctx.addIssue({ code: 'custom', message: 'an mcp copy must materialize its server config' });
    }
    if (record.kind === 'mcp' && record.source.serverName === undefined) {
      ctx.addIssue({ code: 'custom', message: 'an mcp record must name its server in the source' });
    }
  });
export type LibraryRecord = z.infer<typeof libraryRecordSchema>;

/** The on-disk store file (`.coa/library/library.json`), one per scope. */
export const libraryStoreFileSchema = z.object({
  version: z.literal(1).default(1),
  records: z.array(libraryRecordSchema).default([]),
});
export type LibraryStoreFile = z.infer<typeof libraryStoreFileSchema>;

/** A record plus the scope its store directory supplies (the wire/list form). */
export const librarySummarySchema = z.object({
  record: libraryRecordSchema,
  scope: libraryScopeSchema,
});
export type LibrarySummary = z.infer<typeof librarySummarySchema>;

/** Where a discovered skill was found on disk. */
export const skillOriginSchema = z.enum(['claude-user', 'claude-project', 'codex-user']);
export type SkillOrigin = z.infer<typeof skillOriginSchema>;

/** A skill found by the scanner, not (yet) in any store. `path` is its SKILL.md. */
export const discoveredSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  path: z.string().min(1),
  origin: skillOriginSchema,
});
export type DiscoveredSkill = z.infer<typeof discoveredSkillSchema>;

/**
 * The MCP config layers, in precedence order (Claude Code's rule: local >
 * project > user — a name claimed by a more local layer shadows the rest).
 * `claude-local` = `projects[<root>].mcpServers` inside `~/.claude.json`;
 * `project-mcp` = `<root>/.mcp.json`; `claude-user` = `~/.claude.json` top level.
 */
export const mcpLayerSchema = z.enum(['claude-local', 'project-mcp', 'claude-user']);
export type McpLayer = z.infer<typeof mcpLayerSchema>;

/** An MCP server found in a config layer, not (yet) in any store. */
export const discoveredMcpServerSchema = z.object({
  name: z.string().min(1),
  configPath: z.string().min(1),
  layer: mcpLayerSchema,
  config: mcpServerEntrySchema,
  /** Set when a higher-precedence layer defines the same name (this one is inert). */
  shadowedBy: mcpLayerSchema.optional(),
});
export type DiscoveredMcpServer = z.infer<typeof discoveredMcpServerSchema>;

/** A scan/load/resolve problem, surfaced rather than swallowed — never a silent pick. */
export const libraryDiagnosticSchema = z.object({
  /** Absent when the problem precedes knowing the kind (an unreadable store file/record). */
  kind: libraryKindSchema.optional(),
  path: z.string(),
  problem: z.enum(['invalid', 'duplicate', 'missing-source']),
  detail: z.string(),
  /** Store-side problems carry the scope; scan-side ones have none. */
  scope: libraryScopeSchema.optional(),
  name: z.string().optional(),
});
export type LibraryDiagnostic = z.infer<typeof libraryDiagnosticSchema>;

/**
 * A copy's drift verdict, computed on demand (rescan/list — stat+hash, no
 * watcher): the recorded provenance hash vs the source's CURRENT hash.
 */
export const libraryDriftSchema = z.enum(['in-sync', 'drifted', 'source-missing']);
export type LibraryDrift = z.infer<typeof libraryDriftSchema>;

/**
 * One store entry as the console renders it: the record, its resolved content
 * (live for references, materialized for copies), and its health. A failed
 * resolution keeps the entry (status + diagnostic) rather than dropping it.
 */
export const libraryEntryViewSchema = z.object({
  record: libraryRecordSchema,
  scope: libraryScopeSchema,
  status: z.enum(['ok', 'source-missing', 'invalid-source']),
  skill: skillFileSchema.optional(),
  mcp: mcpServerEntrySchema.optional(),
  /** Copies only. */
  drift: libraryDriftSchema.optional(),
});
export type LibraryEntryView = z.infer<typeof libraryEntryViewSchema>;

/** The one read the library UI needs: every entry + everything discovered + every problem. */
export const libraryViewSchema = z.object({
  entries: z.array(libraryEntryViewSchema),
  discovered: z.object({
    skills: z.array(discoveredSkillSchema),
    mcpServers: z.array(discoveredMcpServerSchema),
  }),
  diagnostics: z.array(libraryDiagnosticSchema),
});
export type LibraryView = z.infer<typeof libraryViewSchema>;

/**
 * Per-agent skill wiring: which library skills an agent carries and how each is
 * delivered — `auto` injects the body into the prompt (a push Piece);
 * `disclosure` advertises name+description and pulls the body on demand.
 */
export const agentSkillConfigSchema = z.object({
  name: z.string().min(1),
  delivery: z.enum(['auto', 'disclosure']).default('auto'),
});
export type AgentSkillConfig = z.infer<typeof agentSkillConfigSchema>;

/**
 * One skill the composer can invoke by name (`/skill` — an explicit one-turn
 * load): the `listSkills` verb's row. `name` is the LIBRARY identity (the store
 * record's name, which the scope fold already deduplicated), not the SKILL.md
 * front-matter name — invocation and per-agent config both key on it.
 */
export const invocableSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  scope: libraryScopeSchema,
});
export type InvocableSkill = z.infer<typeof invocableSkillSchema>;
