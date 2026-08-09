import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelMetadataCatalog } from '../models/metadata-catalog.js';
import { buildModelMetadataHandlers } from './model-metadata-handlers.js';
import { dispatch } from './router.js';

let home: string;
let catalog: ModelMetadataCatalog;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-model-metadata-rpc-'));
  catalog = new ModelMetadataCatalog({ home });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('modelMetadata verb', () => {
  it('serves the catalog view with no params', async () => {
    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'modelMetadata' },
      buildModelMetadataHandlers(catalog),
    );
    expect(res?.jsonrpc).toBe('2.0');
    const result = (res as { result: { entries: { id: string; provider: string }[] } }).result;
    expect(result.entries.some((m) => m.id === 'claude-sonnet-5' && m.provider === 'claude')).toBe(
      true,
    );
  });

  it('filters to one provider when asked', async () => {
    const res = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'modelMetadata', params: { provider: 'deepseek' } },
      buildModelMetadataHandlers(catalog),
    );
    const result = (res as { result: { entries: { provider: string }[] } }).result;
    expect(result.entries.every((m) => m.provider === 'deepseek')).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('never blocks on a network fetch — answers synchronously off the last-known merge', async () => {
    const start = Date.now();
    await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'modelMetadata' },
      buildModelMetadataHandlers(catalog),
    );
    expect(Date.now() - start).toBeLessThan(50);
  });
});
