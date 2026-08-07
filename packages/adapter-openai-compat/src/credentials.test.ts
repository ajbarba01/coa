import { describe, expect, it } from 'vitest';
import { resolveApiKey, type ReadKeyFile } from './credentials.js';
import { deepseekSpec } from './deepseek.js';
import { longcatSpec } from './longcat.js';

describe('resolveApiKey', () => {
  it('reads the key from the env var an env-var locator points at', () => {
    expect(
      resolveApiKey(deepseekSpec, { type: 'env-var', name: 'MY_KEY' }, { MY_KEY: 'sk-123' }),
    ).toBe('sk-123');
  });

  it('reads the key from the file a key-file locator points at (injected reader)', () => {
    const read: ReadKeyFile = (path) => (path === '/keys/ds' ? 'sk-file' : undefined);
    expect(resolveApiKey(deepseekSpec, { type: 'key-file', path: '/keys/ds' }, {}, read)).toBe(
      'sk-file',
    );
  });

  it('is undefined for a missing or empty key file', () => {
    expect(
      resolveApiKey(deepseekSpec, { type: 'key-file', path: '/nope' }, {}, () => undefined),
    ).toBeUndefined();
    expect(
      resolveApiKey(deepseekSpec, { type: 'key-file', path: '/empty' }, {}, () => ''),
    ).toBeUndefined();
  });

  it("falls back to the spec's default var for any other/absent locator", () => {
    expect(deepseekSpec.apiKeyEnvVar).toBe('DEEPSEEK_API_KEY');
    expect(longcatSpec.apiKeyEnvVar).toBe('LONGCAT_API_KEY');
    expect(resolveApiKey(deepseekSpec, undefined, { DEEPSEEK_API_KEY: 'sk-ds' })).toBe('sk-ds');
    expect(resolveApiKey(longcatSpec, undefined, { LONGCAT_API_KEY: 'sk-lc' })).toBe('sk-lc');
    expect(resolveApiKey(deepseekSpec, { type: 'ambient' }, { DEEPSEEK_API_KEY: 'sk-ds' })).toBe(
      'sk-ds',
    );
  });

  it('is undefined when the pointed-at var is missing or empty', () => {
    expect(resolveApiKey(deepseekSpec, { type: 'env-var', name: 'MISSING' }, {})).toBeUndefined();
    expect(
      resolveApiKey(deepseekSpec, { type: 'env-var', name: 'EMPTY' }, { EMPTY: '' }),
    ).toBeUndefined();
  });
});
