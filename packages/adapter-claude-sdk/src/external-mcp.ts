import type { McpServerEntry } from '@coa/shared';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * Map coa's neutral library MCP entries onto the SDK's native `mcpServers`
 * option shapes — the pure half of external-MCP delivery on this backend
 * (composition happens in the adapter's `runLoop`, beside the in-process `coa`
 * server). coa manages CONFIG + surfacing only: the SDK owns the actual MCP
 * runtime (spawn/connect/health), per the compose-don't-reinvent rule.
 *
 * Field mapping verified against the installed SDK types (0.3.196):
 * stdio `{type?:'stdio', command, args?, env?}`, sse `{type:'sse', url,
 * headers?}`, http `{type:'http', url, headers?}`. `extra` keys (unmodeled
 * source config) are deliberately NOT forwarded — coa round-trips them in the
 * store but only hands the backend the fields it verified the SDK accepts.
 */
export function toSdkExternalServer(entry: McpServerEntry): McpServerConfig {
  switch (entry.transport) {
    case 'stdio':
      return {
        type: 'stdio',
        command: entry.command,
        ...(entry.args !== undefined ? { args: [...entry.args] } : {}),
        ...(entry.env !== undefined ? { env: { ...entry.env } } : {}),
      };
    case 'sse':
      return {
        type: 'sse',
        url: entry.url,
        ...(entry.headers !== undefined ? { headers: { ...entry.headers } } : {}),
      };
    case 'http':
      return {
        type: 'http',
        url: entry.url,
        ...(entry.headers !== undefined ? { headers: { ...entry.headers } } : {}),
      };
  }
}

/** Map a whole name→entry record; pure, key-preserving. */
export function toSdkExternalServers(
  entries: Readonly<Record<string, McpServerEntry>>,
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(entries).map(([name, entry]) => [name, toSdkExternalServer(entry)]),
  );
}
