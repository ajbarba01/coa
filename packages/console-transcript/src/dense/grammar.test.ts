import { describe, expect, it } from 'vitest';
import { ALIASES, GRAMMARS, grammarForTag, languageForPath } from './grammar.js';

describe('grammarForTag', () => {
  it('has no alias shadowing a registered grammar id', () => {
    // A registered id is matched before the alias table, so an entry keyed by one is
    // either dead config or — worse — a redirect that silently never happens. That the
    // registration map itself matches GRAMMARS is enforced by the compiler, not here.
    const shadowed = Object.keys(ALIASES).filter((tag) =>
      (GRAMMARS as readonly string[]).includes(tag),
    );
    expect(shadowed).toEqual([]);
  });

  it('resolves the short names a fence is actually written with', () => {
    expect(grammarForTag('ts')).toBe('typescript');
    expect(grammarForTag('tsx')).toBe('typescript');
    expect(grammarForTag('js')).toBe('javascript');
    expect(grammarForTag('py')).toBe('python');
    expect(grammarForTag('rs')).toBe('rust');
    expect(grammarForTag('yml')).toBe('yaml');
    expect(grammarForTag('md')).toBe('markdown');
    expect(grammarForTag('html')).toBe('xml');
  });

  it('treats shell transcript tags as bash', () => {
    // These three were the divergence between the two tables this module replaced.
    expect(grammarForTag('sh')).toBe('bash');
    expect(grammarForTag('shell')).toBe('bash');
    expect(grammarForTag('console')).toBe('bash');
  });

  it('is case-insensitive', () => {
    expect(grammarForTag('TS')).toBe('typescript');
    expect(grammarForTag('Python')).toBe('python');
  });

  it('returns undefined for a name no registered grammar answers to', () => {
    expect(grammarForTag('mermaid')).toBeUndefined();
    expect(grammarForTag('')).toBeUndefined();
  });
});

describe('languageForPath', () => {
  it('maps known extensions to hljs languages', () => {
    expect(languageForPath('src/auth.ts')).toBe('typescript');
    expect(languageForPath('a.tsx')).toBe('typescript');
    expect(languageForPath('main.py')).toBe('python');
    expect(languageForPath('README.md')).toBe('markdown');
    expect(languageForPath('data.json')).toBe('json');
    expect(languageForPath('run.sh')).toBe('bash');
    expect(languageForPath('lib.rs')).toBe('rust');
  });

  it('ignores directories and is case-insensitive', () => {
    expect(languageForPath('deep/nested/dir/File.TS')).toBe('typescript');
    expect(languageForPath('C:\\win\\path\\x.PY')).toBe('python');
  });

  it('returns undefined for unknown/absent extensions and dotfiles', () => {
    expect(languageForPath('Makefile')).toBeUndefined();
    expect(languageForPath('binary.xyz')).toBeUndefined();
    expect(languageForPath('.gitignore')).toBeUndefined();
    expect(languageForPath('noext')).toBeUndefined();
  });

  it('reads a path through the same vocabulary as a fence tag', () => {
    // One table serves both; this is what stops them drifting again.
    expect(languageForPath('deploy.shell')).toBe(grammarForTag('shell'));
    expect(languageForPath('mod.mts')).toBe(grammarForTag('mts'));
  });
});
