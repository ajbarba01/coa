import { describe, expect, it } from 'vitest';
import { agentFileSchema } from './agent.js';
import {
  libraryRecordSchema,
  libraryStoreFileSchema,
  mcpServerEntrySchema,
  skillFileSchema,
} from './library.js';

describe('skillFileSchema', () => {
  it('keeps foreign front-matter verbatim in ccKeys', () => {
    const parsed = skillFileSchema.parse({
      name: 'drawio',
      description: 'diagrams',
      body: '# Draw',
      ccKeys: { license: 'MIT', metadata: { nested: true } },
    });
    expect(parsed.ccKeys).toEqual({ license: 'MIT', metadata: { nested: true } });
  });

  it('requires a name but allows an empty description', () => {
    expect(skillFileSchema.safeParse({ name: '', description: 'x', body: '' }).success).toBe(false);
    expect(skillFileSchema.safeParse({ name: 'a', description: '', body: '' }).success).toBe(true);
  });
});

describe('mcpServerEntrySchema', () => {
  it('accepts a stdio server with command/args/env', () => {
    const parsed = mcpServerEntrySchema.parse({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server-github'],
      env: { TOKEN: 'x' },
    });
    expect(parsed.transport).toBe('stdio');
  });

  it('requires a url for remote transports and a command for stdio', () => {
    expect(mcpServerEntrySchema.safeParse({ transport: 'http', url: 'https://x' }).success).toBe(
      true,
    );
    expect(mcpServerEntrySchema.safeParse({ transport: 'http' }).success).toBe(false);
    expect(mcpServerEntrySchema.safeParse({ transport: 'stdio' }).success).toBe(false);
  });

  it('carries unmodeled source keys in extra rather than dropping them', () => {
    const parsed = mcpServerEntrySchema.parse({
      transport: 'stdio',
      command: 'node',
      extra: { startup_timeout_sec: 120 },
    });
    expect(parsed.extra).toEqual({ startup_timeout_sec: 120 });
  });
});

describe('libraryRecordSchema', () => {
  it('accepts a reference record and defaults enabled to true', () => {
    const parsed = libraryRecordSchema.parse({
      name: 'commits',
      kind: 'skill',
      mode: 'reference',
      source: { path: '/home/.claude/skills/commits/SKILL.md' },
    });
    expect(parsed.enabled).toBe(true);
  });

  it('rejects a copy without provenance', () => {
    const result = libraryRecordSchema.safeParse({
      name: 'commits',
      kind: 'skill',
      mode: 'copy',
      source: { path: '/src/SKILL.md' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an mcp copy without a materialized config', () => {
    const result = libraryRecordSchema.safeParse({
      name: 'github',
      kind: 'mcp',
      mode: 'copy',
      source: { path: '/repo/.mcp.json', serverName: 'github' },
      provenance: { sourcePath: '/repo/.mcp.json', contentHash: 'abc' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an mcp record whose source names no server', () => {
    const result = libraryRecordSchema.safeParse({
      name: 'github',
      kind: 'mcp',
      mode: 'reference',
      source: { path: '/repo/.mcp.json' },
    });
    expect(result.success).toBe(false);
  });

  it('carries no scope — the store directory supplies it', () => {
    const parsed = libraryRecordSchema.parse({
      name: 'commits',
      kind: 'skill',
      mode: 'reference',
      source: { path: '/x/SKILL.md' },
    });
    expect('scope' in parsed).toBe(false);
  });
});

describe('libraryStoreFileSchema', () => {
  it('defaults to an empty versioned store', () => {
    const parsed = libraryStoreFileSchema.parse({});
    expect(parsed.version).toBe(1);
    expect(parsed.records).toEqual([]);
  });
});

describe('agentFileSchema skills', () => {
  it('is additive: absent skills parse exactly as before', () => {
    const parsed = agentFileSchema.parse({ name: 'Worker', description: 'does work' });
    expect(parsed.skills).toBeUndefined();
  });

  it('defaults each skill delivery to auto', () => {
    const parsed = agentFileSchema.parse({
      name: 'Worker',
      description: 'does work',
      skills: [{ name: 'commits' }, { name: 'brainstorming', delivery: 'disclosure' }],
    });
    expect(parsed.skills?.[0]?.delivery).toBe('auto');
    expect(parsed.skills?.[1]?.delivery).toBe('disclosure');
  });
});
