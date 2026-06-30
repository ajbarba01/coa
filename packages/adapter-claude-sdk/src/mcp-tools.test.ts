import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { RegisteredTool } from '@coa/spi';
import { coaSdkTool, mcpToolNames, toCoaMcpServer } from './mcp-tools.js';

function fakeTool(over: Partial<RegisteredTool> = {}): RegisteredTool {
  return {
    name: 'get_symbol',
    description: 'distilled symbol slice',
    partition: 'kernel',
    inputSchema: { ref: z.string() },
    invoke: async (args) => ({ result: args, handle: 'h', pointer: 'p' }),
    ...over,
  };
}

describe('mcp-tools', () => {
  test('mcpToolNames namespaces each tool under the coa server', () => {
    const names = mcpToolNames([
      fakeTool({ name: 'get_symbol' }),
      fakeTool({ name: 'edit_symbol' }),
    ]);
    expect(names).toEqual(['mcp__coa__get_symbol', 'mcp__coa__edit_symbol']);
  });

  test('coaSdkTool carries the name/description and routes the handler through invoke', async () => {
    const def = coaSdkTool(
      fakeTool({
        name: 'why',
        description: 'rationale',
        invoke: async () => ({ result: { ok: true }, handle: 'why:t', pointer: 't' }),
      }),
    );
    expect(def.name).toBe('why');
    expect(def.description).toBe('rationale');
    const out = await def.handler({ target: 't' }, undefined);
    expect(out.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({ result: { ok: true }, handle: 'why:t', pointer: 't' }),
      },
    ]);
  });

  test('toCoaMcpServer builds an in-process sdk server named coa', () => {
    const server = toCoaMcpServer([fakeTool()]);
    expect(server.type).toBe('sdk');
    expect(server.name).toBe('coa');
  });
});
