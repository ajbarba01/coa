import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebConfigStore, webConfigPath, webKeyFilePath } from './web-config-store.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-web-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('WebConfigStore', () => {
  it('reads a missing file as empty (never throws)', () => {
    expect(new WebConfigStore(home).read()).toEqual({});
  });

  it('reads a corrupt/wrong-shape file as empty', () => {
    const path = webConfigPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'search: not-an-object\n');
    expect(new WebConfigStore(home).read()).toEqual({});
  });

  it('addCredential lands a search key in the search chain only', () => {
    const store = new WebConfigStore(home);
    store.addCredential('search', 'tavily', { type: 'env-var', name: 'TAVILY_KEY_1' });
    const cfg = store.read();
    expect(cfg.search?.providers).toEqual([
      {
        kind: 'tavily',
        disabled: false,
        credentials: [{ locator: { type: 'env-var', name: 'TAVILY_KEY_1' }, disabled: false }],
      },
    ]);
    expect(cfg.fetch).toBeUndefined();
  });

  it('appends multiple keys to the same provider entry, in order', () => {
    const store = new WebConfigStore(home);
    store.addCredential('fetch', 'firecrawl', { type: 'env-var', name: 'FC1' });
    store.addCredential('fetch', 'firecrawl', { type: 'env-var', name: 'FC2' });
    expect(store.read().fetch?.providers[0]?.credentials).toEqual([
      { locator: { type: 'env-var', name: 'FC1' }, disabled: false },
      { locator: { type: 'env-var', name: 'FC2' }, disabled: false },
    ]);
  });

  it('rejects a wrong-chain kind (parallel under fetch)', () => {
    expect(() =>
      new WebConfigStore(home).addCredential('fetch', 'parallel', { type: 'env-var', name: 'X' }),
    ).toThrow(/not a valid fetch provider/);
  });

  it('is credential-blind — the written YAML holds only the pointer, never a secret', () => {
    const store = new WebConfigStore(home);
    store.addCredential('search', 'firecrawl', {
      type: 'key-file',
      path: webKeyFilePath(home, 'fc1'),
    });
    const yaml = readFileSync(webConfigPath(home), 'utf8');
    expect(yaml).toContain('web-fc1'); // the pointer (path) is stored
    expect(yaml).toContain('key-file');
    expect(yaml).not.toMatch(/fc-[a-z0-9]/i); // no secret shape — the store never sees the key
  });

  it('removeCredential drops an env-var credential and prunes the empty provider', () => {
    const store = new WebConfigStore(home);
    store.addCredential('search', 'parallel', { type: 'env-var', name: 'PARALLEL_API_KEY' });
    expect(store.removeCredential('search', 'PARALLEL_API_KEY')).toEqual([]); // no file to unlink
    expect(store.read().search?.providers ?? []).toEqual([]);
  });

  it('setCredentialDisabled benches an env-var credential by id', () => {
    const store = new WebConfigStore(home);
    store.addCredential('search', 'tavily', { type: 'env-var', name: 'TAVILY_KEY_1' });
    store.setCredentialDisabled('search', 'TAVILY_KEY_1', true);
    expect(store.read().search?.providers[0]?.credentials[0]?.disabled).toBe(true);
  });

  it('setCredentialDisabled benches a key-file credential by its label id', () => {
    const store = new WebConfigStore(home);
    store.addCredential('search', 'firecrawl', {
      type: 'key-file',
      path: webKeyFilePath(home, 'fc1'),
    });
    store.setCredentialDisabled('search', 'fc1', true);
    expect(store.read().search?.providers[0]?.credentials[0]?.disabled).toBe(true);
  });

  it('setCredentialDisabled is a no-op when the chain is absent', () => {
    const store = new WebConfigStore(home);
    expect(() => store.setCredentialDisabled('fetch', 'nope', true)).not.toThrow();
    expect(store.read().fetch).toBeUndefined();
  });

  it('setProviderDisabled benches an entire provider entry by kind', () => {
    const store = new WebConfigStore(home);
    store.addCredential('search', 'tavily', { type: 'env-var', name: 'TAVILY_KEY_1' });
    store.setProviderDisabled('search', 'tavily', true);
    expect(store.read().search?.providers[0]?.disabled).toBe(true);
  });

  it('setProviderDisabled is a no-op when the chain or entry is absent', () => {
    const store = new WebConfigStore(home);
    expect(() => store.setProviderDisabled('search', 'tavily', true)).not.toThrow();
    expect(store.read().search).toBeUndefined();
  });

  it('returns a key-file path for unlink only once it is unreferenced by EITHER chain', () => {
    const store = new WebConfigStore(home);
    const loc = { type: 'key-file' as const, path: webKeyFilePath(home, 'shared') };
    store.addCredential('search', 'firecrawl', loc);
    store.addCredential('fetch', 'firecrawl', loc);
    // still referenced by fetch → nothing to unlink yet
    expect(store.removeCredential('search', 'shared')).toEqual([]);
    // removed from fetch too → now safe to unlink
    expect(store.removeCredential('fetch', 'shared')).toEqual([webKeyFilePath(home, 'shared')]);
  });
});
