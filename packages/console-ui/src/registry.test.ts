import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allIntents } from './registry.js';
import { assertIntent } from './lib/intent.js';
import { generateCatalog } from './lib/catalog.js';

describe('component registry', () => {
  it('holds a valid, complete intent for every registered component', () => {
    for (const intent of allIntents) expect(() => assertIntent(intent)).not.toThrow();
  });

  it('has no duplicate component names', () => {
    const names = allIntents.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers every built family', () => {
    const families = new Set(allIntents.map((i) => i.family));
    for (const f of [
      'Foundations',
      'Actions',
      'Inputs',
      'Layout',
      'Data-display',
      'Feedback',
      'Overlays',
      'Dense/Viz',
    ]) {
      expect(families.has(f)).toBe(true);
    }
  });

  it('COMPONENTS.md is regenerated from the current intents (run gen-catalog if this fails)', () => {
    const path = fileURLToPath(new URL('../COMPONENTS.md', import.meta.url));
    const onDisk = readFileSync(path, 'utf8');
    expect(onDisk).toBe(generateCatalog(allIntents));
  });
});
