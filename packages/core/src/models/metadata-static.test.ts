import { describe, expect, it } from 'vitest';
import { modelMetadataSchema } from '@coa/shared';
import { defaultCatalog } from './default-catalog.js';
import { STATIC_MODEL_METADATA } from './metadata-static.js';

describe('STATIC_MODEL_METADATA', () => {
  it('every row parses as valid ModelMetadata', () => {
    for (const row of STATIC_MODEL_METADATA) {
      expect(() => modelMetadataSchema.parse(row)).not.toThrow();
    }
  });

  it('covers every id default-catalog ships, for every provider it ships one for', () => {
    for (const provider of ['claude', 'deepseek', 'longcat', 'openai']) {
      const shipped = defaultCatalog(provider).map((m) => m.id);
      const known = new Set(
        STATIC_MODEL_METADATA.filter((m) => m.provider === provider).map((m) => m.id),
      );
      for (const id of shipped) {
        expect(known.has(id), `${provider}:${id} has no static metadata row`).toBe(true);
      }
    }
  });

  it('has no duplicate (provider, id) rows', () => {
    const seen = new Set<string>();
    for (const row of STATIC_MODEL_METADATA) {
      const key = `${row.provider}:${row.id}`;
      expect(seen.has(key), `duplicate row ${key}`).toBe(false);
      seen.add(key);
    }
  });
});
