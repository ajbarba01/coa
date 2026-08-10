import { mcpServerEntrySchema, type McpServerEntry } from '@coa/shared';
import { z } from 'zod';

/**
 * Byte-correct parsing of the MCP config formats coa discovers, and the
 * normalization onto {@link McpServerEntry}. Two files carry three layers:
 *
 *  - `<root>/.mcp.json` — the project layer: `{ "mcpServers": { name: cfg } }`.
 *  - `~/.claude.json` — Claude Code's user config: the SAME `mcpServers` map at
 *    the top level (user layer) and again under `projects[<root>]` (local layer).
 *
 * A server config's `type` is optional and defaults to `stdio` when a `command`
 * is present (Claude Code's own rule); `sse`/`http` require a `url`. Keys coa
 * does not model ride through verbatim in `extra` — the cross-client
 * discover-and-link data model follows MCPM's (servers are named entries in a
 * client config; the entry's config object is the unit that is linked/copied).
 *
 * Pure text-in/values-out; the scanner owns the filesystem.
 */

/** One raw server object as found on disk — loose by design, normalized below. */
const rawServerSchema = z.looseObject({
  type: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const mcpFileSchema = z.looseObject({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
});

const claudeUserConfigSchema = z.looseObject({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
  projects: z
    .record(z.string(), z.looseObject({ mcpServers: z.record(z.string(), z.unknown()).optional() }))
    .optional(),
});

/** The keys the normalizer consumes; everything else lands in `extra`. */
const MODELED = new Set(['type', 'command', 'args', 'env', 'url', 'headers']);

export type NormalizedServer =
  | { ok: true; entry: McpServerEntry; raw: Record<string, unknown> }
  | { ok: false; error: string };

/** Normalize one raw server config onto the typed entry, keeping the raw object for hashing. */
export function normalizeMcpServer(value: unknown): NormalizedServer {
  const parsed = rawServerSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: 'not a server config object' };
  const raw = parsed.data;
  // looseObject keeps unknown keys, so the parsed value IS the raw object (hash-faithful).
  const rawRecord: Record<string, unknown> = parsed.data;
  const extra = Object.fromEntries(Object.entries(rawRecord).filter(([key]) => !MODELED.has(key)));
  const withExtra = Object.keys(extra).length > 0 ? { extra } : {};

  const transport = raw.type ?? (raw.command !== undefined ? 'stdio' : undefined);
  if (transport === 'stdio') {
    if (raw.command === undefined || raw.command === '') {
      return { ok: false, error: 'a stdio server needs a command' };
    }
    return {
      ok: true,
      raw: rawRecord,
      entry: mcpServerEntrySchema.parse({
        transport: 'stdio',
        command: raw.command,
        ...(raw.args !== undefined ? { args: raw.args } : {}),
        ...(raw.env !== undefined ? { env: raw.env } : {}),
        ...withExtra,
      }),
    };
  }
  if (transport === 'sse' || transport === 'http') {
    if (raw.url === undefined || raw.url === '') {
      return { ok: false, error: `an ${transport} server needs a url` };
    }
    return {
      ok: true,
      raw: rawRecord,
      entry: mcpServerEntrySchema.parse({
        transport,
        url: raw.url,
        ...(raw.headers !== undefined ? { headers: raw.headers } : {}),
        ...withExtra,
      }),
    };
  }
  return { ok: false, error: `unrecognized server shape (type: ${String(raw.type)})` };
}

export interface ParsedMcpServers {
  servers: Record<string, NormalizedServer>;
}

/** Parse a `.mcp.json`-shaped text (`{ mcpServers: {...} }`). Throws on non-JSON. */
export function parseMcpJson(text: string): ParsedMcpServers {
  const data = mcpFileSchema.parse(JSON.parse(text));
  return { servers: mapServers(data.mcpServers ?? {}) };
}

export interface ParsedClaudeUserConfig {
  /** The top-level `mcpServers` map — the user layer. */
  user: Record<string, NormalizedServer>;
  /** `projects[<root>].mcpServers` — the local (per-project) layer, highest precedence. */
  local: Record<string, NormalizedServer>;
}

/**
 * Parse `~/.claude.json`, resolving the project entry whose key names
 * `projectRoot`. Project keys are compared through the injected `samePath`
 * (path-resolve equality) so separator/casing differences between what Claude
 * Code wrote and what the daemon was launched with never lose the local layer.
 */
export function parseClaudeUserConfig(
  text: string,
  projectRoot: string,
  samePath: (a: string, b: string) => boolean,
): ParsedClaudeUserConfig {
  const data = claudeUserConfigSchema.parse(JSON.parse(text));
  const projects = data.projects ?? {};
  const localKey = Object.keys(projects).find((key) => samePath(key, projectRoot));
  const local = localKey !== undefined ? (projects[localKey]?.mcpServers ?? {}) : {};
  return {
    user: mapServers(data.mcpServers ?? {}),
    local: mapServers(local),
  };
}

function mapServers(raw: Record<string, unknown>): Record<string, NormalizedServer> {
  return Object.fromEntries(
    Object.entries(raw).map(([name, value]) => [name, normalizeMcpServer(value)]),
  );
}

/**
 * Deterministic JSON with sorted object keys — the canonical text an MCP
 * server entry is hashed over, so formatting/key-order churn in the source
 * config never reads as drift; only the entry's content does.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, sortKeys(inner)]),
    );
  }
  return value;
}
