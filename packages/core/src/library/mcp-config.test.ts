import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  normalizeMcpServer,
  parseClaudeUserConfig,
  parseMcpJson,
} from './mcp-config.js';

describe('normalizeMcpServer', () => {
  it('defaults a command-bearing entry to stdio (type omitted, the common on-disk shape)', () => {
    const result = normalizeMcpServer({
      command: 'npx',
      args: ['-y', 'server-x'],
      env: { A: '1' },
    });
    expect(result).toMatchObject({
      ok: true,
      entry: { transport: 'stdio', command: 'npx', args: ['-y', 'server-x'], env: { A: '1' } },
    });
  });

  it('normalizes sse and http entries with url/headers', () => {
    expect(normalizeMcpServer({ type: 'sse', url: 'https://x/sse' })).toMatchObject({
      ok: true,
      entry: { transport: 'sse', url: 'https://x/sse' },
    });
    expect(
      normalizeMcpServer({ type: 'http', url: 'https://x/mcp', headers: { A: 'b' } }),
    ).toMatchObject({ ok: true, entry: { transport: 'http', url: 'https://x/mcp' } });
  });

  it('keeps unmodeled keys verbatim in extra (round-trip, never dropped)', () => {
    const result = normalizeMcpServer({ command: 'node', startup_timeout_sec: 120 });
    expect(result).toMatchObject({ ok: true, entry: { extra: { startup_timeout_sec: 120 } } });
  });

  it('refuses a remote entry without a url and a stdio one without a command', () => {
    expect(normalizeMcpServer({ type: 'http' }).ok).toBe(false);
    expect(normalizeMcpServer({ type: 'stdio' }).ok).toBe(false);
    expect(normalizeMcpServer({}).ok).toBe(false);
    expect(normalizeMcpServer('not-an-object').ok).toBe(false);
  });
});

describe('parseMcpJson', () => {
  it('reads the .mcp.json mcpServers map', () => {
    const parsed = parseMcpJson('{"mcpServers":{"gh":{"command":"npx","args":["gh-server"]}}}');
    expect(Object.keys(parsed.servers)).toEqual(['gh']);
    expect(parsed.servers['gh']).toMatchObject({ ok: true, entry: { transport: 'stdio' } });
  });

  it('is empty (not a throw) when the file has no mcpServers key', () => {
    expect(parseMcpJson('{}').servers).toEqual({});
  });

  it('throws on non-JSON — the caller surfaces it as a diagnostic', () => {
    expect(() => parseMcpJson('nope')).toThrow();
  });
});

describe('parseClaudeUserConfig', () => {
  const samePath = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  const text = JSON.stringify({
    mcpServers: { global: { command: 'g' } },
    projects: {
      'C:\\repo': { mcpServers: { local: { command: 'l' } } },
      '/other': { mcpServers: { other: { command: 'o' } } },
    },
    numStartups: 42,
  });

  it('splits the user layer from the matching project local layer', () => {
    const parsed = parseClaudeUserConfig(text, 'c:\\REPO', samePath);
    expect(Object.keys(parsed.user)).toEqual(['global']);
    expect(Object.keys(parsed.local)).toEqual(['local']);
  });

  it('has an empty local layer when no project key matches', () => {
    const parsed = parseClaudeUserConfig(text, '/nowhere', samePath);
    expect(parsed.local).toEqual({});
  });
});

describe('canonicalJson', () => {
  it('is stable under key order — formatting churn never reads as drift', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    );
  });

  it('does not sort arrays — argument order is content', () => {
    expect(canonicalJson({ args: ['b', 'a'] })).not.toBe(canonicalJson({ args: ['a', 'b'] }));
  });
});
