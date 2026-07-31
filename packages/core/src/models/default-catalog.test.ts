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

  /**
   * A retired id is worse than a missing one: it reaches the backend and 404s, so the
   * failure lands mid-session instead of at the picker. Retired 2026-02-19.
   */
  it('ships no retired ids', () => {
    expect(defaultCatalog('claude').map((m) => m.id)).not.toContain('claude-haiku-3-5');
  });

  /**
   * Adaptive is the ONLY on-mode for opus 4.7 — an entry claiming effort without adaptive
   * describes a model that cannot think, and the assembler would offer the wrong controls.
   */
  it('marks adaptive thinking on the models whose only on-mode it is', () => {
    expect(catalogDescriptor('claude', 'claude-opus-4-7')?.supportsAdaptiveThinking).toBe(true);
  });

  /** Sonnet 4.6 carries adaptive + effort; xhigh arrived later, on opus 4.7. */
  it('gives sonnet 4.6 its effort range without xhigh', () => {
    const d = catalogDescriptor('claude', 'claude-sonnet-4-6');
    expect(d?.supportsAdaptiveThinking).toBe(true);
    expect(d?.supportsEffort).toBe(true);
    expect(d?.supportedEffortLevels).toContain('max');
    expect(d?.supportedEffortLevels).not.toContain('xhigh');
  });

  /**
   * `deepseek-chat` / `deepseek-reasoner` are deprecated 2026-07-24 15:59 UTC and error
   * after it. The V4 ids replace them; both carry thinking (it is DeepSeek's default mode).
   */
  it('ships the deepseek v4 ids, not the retiring aliases', () => {
    const ids = defaultCatalog('deepseek').map((m) => m.id);
    expect(ids).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
    expect(catalogDescriptor('deepseek', 'deepseek-v4-pro')?.supportsThinking).toBe(true);
  });

  /**
   * The catalogue's id has to match the pricing table's key or the zero floor silently
   * bills every turn at $0 — LongCat's platform documents `LongCat-2.0`.
   */
  it('offers the longcat id its price table actually keys', () => {
    expect(defaultCatalog('longcat').map((m) => m.id)).toContain('LongCat-2.0');
  });
});
