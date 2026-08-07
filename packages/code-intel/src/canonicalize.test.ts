import { describe, expect, it } from 'vitest';
import { canonicalFormSchema, type CanonicalizationProfile } from '@coa/shared';
import { canonicalize } from './canonicalize.js';

const eq = (a: string, b: string, profile: CanonicalizationProfile): boolean =>
  canonicalize(a, profile).canonicalBytes === canonicalize(b, profile).canonicalBytes;

const TS: CanonicalizationProfile = { lang: 'typescript' };

describe('canonicalize', () => {
  it('emits a schema-valid canonical form carrying the lang', () => {
    const form = canonicalize('const x = 1;', TS);
    expect(canonicalFormSchema.parse(form)).toBeTruthy();
    expect(form.lang).toBe('typescript');
  });

  it('reports two artifacts equal modulo formatting (whitespace/indentation)', () => {
    expect(eq('function f(a){return a+b;}', 'function  f ( a ) {\n  return a + b ;\n}', TS)).toBe(
      true,
    );
  });

  it('is insensitive to spacing around operators (token stream, not whitespace collapse)', () => {
    expect(eq('a+b', 'a + b', TS)).toBe(true);
  });

  it('distinguishes artifacts that differ in a token', () => {
    expect(eq('const x = 1;', 'const y = 1;', TS)).toBe(false);
  });

  it('blanks ignored byte regions so differences there do not matter', () => {
    const profile: CanonicalizationProfile = { lang: 'typescript', ignoreRegions: [[8, 11]] };
    expect(eq('let x = 111;', 'let x = 222;', profile)).toBe(true);
    // ...and without the carve-out they differ.
    expect(eq('let x = 111;', 'let x = 222;', TS)).toBe(false);
  });

  it('strips a leading banner comment when asked', () => {
    const profile: CanonicalizationProfile = { lang: 'typescript', stripBanner: true };
    expect(eq('// generated header\nconst x = 1;', 'const x = 1;', profile)).toBe(true);
  });

  it('falls back to a whitespace-collapsing floor for an ungrammared language', () => {
    const profile: CanonicalizationProfile = { lang: 'plain' };
    expect(eq('a  b\tc', 'a b c', profile)).toBe(true);
    expect(eq('a b c', 'a b d', profile)).toBe(false);
  });
});
