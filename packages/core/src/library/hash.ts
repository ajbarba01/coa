import { createHash } from 'node:crypto';

/**
 * The library's one content-hash primitive: sha-256 hex over utf-8 text. A
 * skill hashes its SKILL.md bytes; an MCP server hashes the canonical JSON of
 * its raw config entry (see `mcp-config.ts#canonicalJson`). Drift is only ever
 * this hash compared on demand — no watcher, no timestamps.
 */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
