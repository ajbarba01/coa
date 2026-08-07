import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultCatalog } from '../models/default-catalog.js';
import { ModelCatalogStore } from '../models/model-catalog-store.js';
import { dispatch } from './router.js';
import { MODEL_PROVIDERS, buildModelHandlers, type ModelCatalogView } from './model-handlers.js';

let home: string;
let handlers: ReturnType<typeof buildModelHandlers>;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-mh-'));
  handlers = buildModelHandlers(new ModelCatalogStore(home), MODEL_PROVIDERS);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const call = async (verb: string, params?: unknown): Promise<ModelCatalogView> => {
  const res = await dispatch({ jsonrpc: '2.0', id: 1, method: verb, params }, handlers);
  if ('error' in res) throw new Error(res.error.message);
  return res.result as ModelCatalogView;
};

describe('buildModelHandlers', () => {
  it('modelCatalog returns every provider list + its default catalog', async () => {
    const view = await call('modelCatalog');
    expect(view.lists['claude']).toEqual(defaultCatalog('claude'));
    expect(view.catalog['deepseek']?.map((m) => m.id)).toContain('deepseek-v4-flash');
  });

  it('addCustomModel → the view carries the new entry; removeModel deletes it', async () => {
    const added = await call('addCustomModel', {
      providerId: 'claude',
      id: 'my-model',
      label: 'mine',
    });
    expect(added.lists['claude']?.find((m) => m.id === 'my-model')?.origin).toBe('custom');
    const removed = await call('removeModel', { providerId: 'claude', id: 'my-model' });
    expect(removed.lists['claude']?.some((m) => m.id === 'my-model')).toBe(false);
  });

  it('setModelHidden flips the flag; editModel patches reasoning', async () => {
    const hidden = await call('setModelHidden', {
      providerId: 'claude',
      id: 'claude-fable-5',
      hidden: true,
    });
    expect(hidden.lists['claude']?.find((m) => m.id === 'claude-fable-5')?.hidden).toBe(true);
    const edited = await call('editModel', {
      providerId: 'claude',
      id: 'claude-fable-5',
      reasoning: { kind: 'effort', max: 'high' },
    });
    expect(edited.lists['claude']?.find((m) => m.id === 'claude-fable-5')?.reasoning).toEqual({
      kind: 'effort',
      max: 'high',
    });
  });

  it('addModels re-adds a removed default from the catalog', async () => {
    await call('removeModel', { providerId: 'claude', id: 'claude-opus-4-1' });
    const view = await call('addModels', { providerId: 'claude', ids: ['claude-opus-4-1'] });
    expect(view.lists['claude']?.some((m) => m.id === 'claude-opus-4-1')).toBe(true);
  });

  it('rejects malformed params (M0-validated at the edge)', async () => {
    await expect(call('addCustomModel', { providerId: 'claude' })).rejects.toThrow();
  });
});
