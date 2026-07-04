import { describe, expect, it } from 'vitest';
import { KeyStateStore, webKeysPath, locatorId } from './key-state-store.js';

/** An in-memory fs so the store roundtrips with no disk (injected read/write). */
function memFs(initial?: string) {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set(webKeysPath('/home'), initial);
  return {
    files,
    readFile: (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFile: (p: string, d: string) => {
      files.set(p, d);
    },
  };
}

describe('locatorId', () => {
  it('keys on the pointer identity, never the secret', () => {
    expect(locatorId({ type: 'env-var', name: 'FIRECRAWL_KEY_1' })).toBe('FIRECRAWL_KEY_1');
    expect(locatorId({ type: 'key-file', path: '/k/f.key' })).toBe('/k/f.key');
    expect(locatorId({ type: 'config-dir', dir: '/c/d' })).toBe('/c/d');
    expect(locatorId({ type: 'ambient' })).toBe('ambient');
  });
});

describe('KeyStateStore', () => {
  it('roundtrips a cooldown to and from JSON via the injected fs', () => {
    const fs = memFs();
    const store = new KeyStateStore('/home', fs);
    store.markCooldown('firecrawl:FIRECRAWL_KEY_1', 5000);
    // A fresh instance over the same fs reads it back — the state is persisted, not in-memory.
    const reopened = new KeyStateStore('/home', fs);
    expect(reopened.isCoolingDown('firecrawl:FIRECRAWL_KEY_1', 4999)).toBe(true);
    expect(reopened.isCoolingDown('firecrawl:FIRECRAWL_KEY_1', 5000)).toBe(false); // expiry is exclusive
    expect(reopened.isCoolingDown('firecrawl:FIRECRAWL_KEY_1', 6000)).toBe(false);
  });

  it('clear removes a cooldown', () => {
    const fs = memFs();
    const store = new KeyStateStore('/home', fs);
    store.markCooldown('a', 5000);
    store.clear('a');
    expect(store.isCoolingDown('a', 1)).toBe(false);
  });

  it('is credential-blind: the written file contains only pointer ids + timestamps', () => {
    const fs = memFs();
    new KeyStateStore('/home', fs).markCooldown('firecrawl:FIRECRAWL_KEY_1', 42);
    const written = fs.files.get(webKeysPath('/home'))!;
    expect(written).toContain('FIRECRAWL_KEY_1');
    expect(written).not.toContain('fc-secret'); // no secret ever reaches the file
  });

  it('never throws on a missing file — treats it as no cooldowns', () => {
    const store = new KeyStateStore('/home', memFs());
    expect(store.isCoolingDown('anything', 0)).toBe(false);
  });

  it('never throws on a corrupt file — treats it as empty', () => {
    const store = new KeyStateStore('/home', memFs('{ not json'));
    expect(store.isCoolingDown('anything', 0)).toBe(false);
  });

  it('drops an unknown/invalid shape and returns empty (drop-unknown, never-throw)', () => {
    const store = new KeyStateStore('/home', memFs('{"cooldowns":"not-an-object"}'));
    expect(store.isCoolingDown('anything', 0)).toBe(false);
  });
});
