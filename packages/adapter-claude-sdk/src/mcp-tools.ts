import {
  createSdkMcpServer,
  tool,
  type McpServerConfig,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import type { RegisteredTool } from '@coa/spi';

/**
 * The M6↔M9 tool bridge: turn M6's governed {@link RegisteredTool}s into the
 * Claude Agent SDK's in-process MCP surface. coa registers them under one SDK MCP
 * server (`createSdkMcpServer`), so each tool's handler runs in the daemon
 * process — which is exactly why M6 already Zod-validates and path-confines every
 * call (the SDK OS sandbox does NOT confine in-process MCP tools). Each SDK tool
 * just awaits the governed `invoke` (validate → dispatch → enrich) and serializes
 * the enriched {@link import('@coa/shared').ToolResponse} as the tool result; all
 * policy stays in the core.
 */

const SERVER_NAME = 'coa';

/** The SDK-visible name of a registered tool (`mcp__<server>__<tool>`); the allow-list entry. */
export function mcpToolName(name: string): string {
  return `mcp__${SERVER_NAME}__${name}`;
}

/** The MCP allow-list M9 adds to `allowedTools` so the governed tools are callable. */
export function mcpToolNames(tools: readonly RegisteredTool[]): string[] {
  return tools.map((registered) => mcpToolName(registered.name));
}

/** Wrap one governed tool as an SDK MCP tool definition (kernel set is always-loaded, D100). */
export function coaSdkTool(registered: RegisteredTool): SdkMcpToolDefinition {
  return tool(
    registered.name,
    registered.description,
    registered.inputSchema,
    async (args) => {
      const response = await registered.invoke(args);
      return { content: [{ type: 'text', text: JSON.stringify(response) }] };
    },
    { alwaysLoad: registered.partition === 'kernel' },
  );
}

/** Build the single in-process `coa` MCP server carrying the governed catalogue. */
export function toCoaMcpServer(tools: readonly RegisteredTool[]): McpServerConfig {
  return createSdkMcpServer({ name: SERVER_NAME, tools: tools.map(coaSdkTool) });
}
