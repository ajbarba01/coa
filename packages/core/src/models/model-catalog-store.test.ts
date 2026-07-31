import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultCatalog } from './default-catalog.js';
import { ModelCatalogStore, modelsPath } from './model-catalog-store.js';

let home: string;
let store: ModelCatalogStore;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-models-'));
  store = new ModelCatalogStore(home);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('ModelCatalogStore', () => {
  it('an untouched provider reads as its default catalog without writing the file', () => {
    expect(store.listFor('claude')).toEqual(defaultCatalog('claude'));
    expect(() => readFileSync(modelsPath(home))).toThrow(); // no file yet — strict-superset
  });

  it('the first write materialises the catalog, then mutates (seeding B)', () => {
    store.setHidden('claude', 'claude-haiku-3-5', true);
    const list = store.listFor('claude');
    expect(list.length).toBe(defaultCatalog('claude').length);
    expect(list.find((m) => m.id === 'claude-haiku-3-5')?.hidden).toBe(true);
    const onDisk = parse(readFileSync(modelsPath(home), 'utf8')) as { providers: Record<string, unknown[]> };
    expect(onDisk.providers['claude']?.length).toBe(list.length);
  });

  it('addFromDefaults adds only catalog ids not already present', () => {
    store.remove('claude', 'claude-opus-4-1');
    store.addFromDefaults('claude', ['claude-opus-4-1', 'claude-fable-5', 'not-in-catalog']);
    const ids = store.listFor('claude').map((m) => m.id);
    expect(ids).toContain('claude-opus-4-1');
    expect(ids.filter((id) => id === 'claude-fable-5').length).toBe(1);
    expect(ids).not.toContain('not-in-catalog');
  });

  it('addCustom appends origin custom and refuses a duplicate id', () => {
    store.addCustom('claude', { id: 'claude-opus-4-9', label: 'opus 4.9' });
    store.addCustom('claude', { id: 'claude-opus-4-9' });
    const matches = store.listFor('claude').filter((m) => m.id === 'claude-opus-4-9');
    expect(matches).toEqual([{ id: 'claude-opus-4-9', label: 'opus 4.9', origin: 'custom' }]);
  });

  it('edit patches label and reasoning; an empty label clears back to id', () => {
    store.edit('claude', 'claude-fable-5', { reasoning: { kind: 'effort', max: 'high' }, label: '' });
    const entry = store.listFor('claude').find((m) => m.id === 'claude-fable-5');
    expect(entry?.label).toBeUndefined();
    expect(entry?.reasoning).toEqual({ kind: 'effort', max: 'high' });
  });

  it('remove deletes the entry; removing every entry persists a legal empty list', () => {
    for (const m of store.listFor('claude')) store.remove('claude', m.id);
    expect(store.listFor('claude')).toEqual([]); // never re-seeds — empty is a state
  });

  it('a corrupt file reads as empty state, never throws', async () => {
    store.setHidden('claude', 'claude-fable-5', true);
    const fs = await import('node:fs');
    fs.writeFileSync(modelsPath(home), ':: not yaml ::');
    expect(store.listFor('claude')).toEqual(defaultCatalog('claude'));
  });

  it('edit with reasoning kind inherit clears a previously-set reasoning', () => {
    store.edit('claude', 'claude-fable-5', { reasoning: { kind: 'effort', max: 'high' } });
    const afterSet = store.listFor('claude').find((m) => m.id === 'claude-fable-5');
    expect(afterSet?.reasoning).toEqual({ kind: 'effort', max: 'high' });
    store.edit('claude', 'claude-fable-5', { reasoning: { kind: 'inherit' } });
    const afterClear = store.listFor('claude').find((m) => m.id === 'claude-fable-5');
    expect(afterClear?.reasoning).toBeUndefined();
  });
});
