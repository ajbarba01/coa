import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveTokens, tokensToCss, SEMANTIC_TOKEN_NAMES } from './tokens.js';

describe('design tokens', () => {
  it('resolves every semantic token to a non-empty value in both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      const map = resolveTokens(theme, 'compact');
      for (const name of SEMANTIC_TOKEN_NAMES) {
        expect(map[name], `${theme}/${name}`).toBeTruthy();
      }
    }
  });

  it('pins the locked forge/brass dark values', () => {
    const dark = resolveTokens('dark', 'compact');
    expect(dark['--color-bg-base']).toBe('#14100d');
    expect(dark['--color-accent']).toBe('#c39a3e');
    expect(dark['--color-danger']).toBe('#c0432f');
  });

  it('emits a :root block containing the accent var', () => {
    expect(tokensToCss('dark', 'compact')).toContain('--color-accent: #c39a3e;');
  });

  it('sets Fira Code as the mono font with ligatures enabled', () => {
    const css = readFileSync(fileURLToPath(new URL('../theme.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/--font-mono:[^;]*Fira Code Variable/);
    expect(css).toMatch(/font-feature-settings:\s*['"]liga['"]\s*1,\s*['"]calt['"]\s*1/);
  });
});
