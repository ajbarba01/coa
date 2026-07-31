import { describe, expect, it } from 'vitest';
import { catalogDescriptor, defaultCatalog } from './default-catalog.js';

describe('defaultCatalog', () => {
  it('ships the hand-verified claude list, origin default', () => {
    const claude = defaultCatalog('claude');
    expect(claude.map((m) => m.id)).toContain('claude-fable-5');
    expect(claude.map((m) => m.id)).toContain('claude-sonnet-4-6');
    expect(claude.every((m) => m.origin === 'default')).toBe(true);
  });

  it('returns an empty list for an unknown provider (never throws)', () => {
    expect(defaultCatalog('nope')).toEqual([]);
  });

  it('returns fresh copies — mutating a result never corrupts the catalog', () => {
    const first = defaultCatalog('claude');
    first[0]!.hidden = true;
    expect(defaultCatalog('claude')[0]!.hidden).toBeUndefined();
  });

  it('catalogDescriptor carries claude effort caps for the shipped ids', () => {
    const d = catalogDescriptor('claude', 'claude-opus-4-8');
    expect(d?.supportsEffort).toBe(true);
    expect(d?.supportedEffortLevels).toContain('max');
  });

  it('catalogDescriptor is undefined off-catalog', () => {
    expect(catalogDescriptor('claude', 'made-up')).toBeUndefined();
  });
});
