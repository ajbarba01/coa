import { describe, expect, it } from 'vitest';
import { resolveApiKey, DEFAULT_API_KEY_VAR } from './credentials.js';

describe('resolveApiKey', () => {
  it('reads the key from the env var an env-var locator points at', () => {
    expect(resolveApiKey({ type: 'env-var', name: 'MY_KEY' }, { MY_KEY: 'sk-123' })).toBe('sk-123');
  });

  it('falls back to the default var for any other/absent locator', () => {
    expect(resolveApiKey(undefined, { [DEFAULT_API_KEY_VAR]: 'sk-default' })).toBe('sk-default');
    expect(resolveApiKey({ type: 'ambient' }, { [DEFAULT_API_KEY_VAR]: 'sk-default' })).toBe(
      'sk-default',
    );
  });

  it('is undefined when the pointed-at var is missing or empty', () => {
    expect(resolveApiKey({ type: 'env-var', name: 'MISSING' }, {})).toBeUndefined();
    expect(resolveApiKey({ type: 'env-var', name: 'EMPTY' }, { EMPTY: '' })).toBeUndefined();
  });
});
