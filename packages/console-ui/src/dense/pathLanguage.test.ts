import { describe, expect, it } from 'vitest';
import { languageForPath } from './pathLanguage.js';

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
});
