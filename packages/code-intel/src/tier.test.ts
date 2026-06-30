import { describe, expect, it } from 'vitest';
import { tierFor } from './tier.js';

describe('tierFor', () => {
  it('resolves a bounded-grammar tier (2) for TypeScript by extension', () => {
    expect(tierFor({ path: 'src/charge.ts' })).toBe(2);
    expect(tierFor({ path: 'src/app.tsx' })).toBe(2);
  });

  it('resolves a bounded-grammar tier (2) for JavaScript by extension', () => {
    expect(tierFor({ path: 'lib/index.js' })).toBe(2);
    expect(tierFor({ path: 'lib/index.mjs' })).toBe(2);
    expect(tierFor({ path: 'lib/index.cjs' })).toBe(2);
    expect(tierFor({ path: 'lib/widget.jsx' })).toBe(2);
  });

  it('falls to the neutral floor (0) for unknown or plain files', () => {
    expect(tierFor({ path: 'README.md' })).toBe(0);
    expect(tierFor({ path: 'data.csv' })).toBe(0);
    expect(tierFor({ path: 'Makefile' })).toBe(0);
  });

  it('honors an explicit lang over the path', () => {
    expect(tierFor({ lang: 'typescript' })).toBe(2);
    expect(tierFor({ lang: 'javascript' })).toBe(2);
    expect(tierFor({ lang: 'gdscript' })).toBe(0);
  });

  it('accepts a CanonicalizationProfile (lang-bearing) as input', () => {
    expect(tierFor({ lang: 'tsx', stripBanner: true })).toBe(2);
  });
});
