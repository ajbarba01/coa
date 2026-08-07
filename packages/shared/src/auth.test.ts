import { describe, expect, it } from 'vitest';
import {
  accountSchema,
  accountsFileSchema,
  locatorSchema,
  supportsIsolatedBrowserSession,
} from './auth.js';

describe('auth schema', () => {
  it('accepts each locator type', () => {
    expect(locatorSchema.parse({ type: 'config-dir', dir: '/home/u/.claude-work' }).type).toBe(
      'config-dir',
    );
    expect(locatorSchema.parse({ type: 'env-var', name: 'DEEPSEEK_API_KEY' }).type).toBe('env-var');
    expect(locatorSchema.parse({ type: 'key-file', path: '/k' }).type).toBe('key-file');
    expect(locatorSchema.parse({ type: 'ambient' }).type).toBe('ambient');
  });

  it('rejects the dropped ant-profile locator', () => {
    expect(() => locatorSchema.parse({ type: 'ant-profile', profile: 'work' })).toThrow();
  });

  it('defaults provider to claude', () => {
    const account = accountSchema.parse({
      label: 'work',
      locator: { type: 'config-dir', dir: '/d' },
    });
    expect(account.provider).toBe('claude');
  });

  it('parses an accounts file with a per-provider active map', () => {
    const file = accountsFileSchema.parse({ active: { claude: 'work' }, accounts: [] });
    expect(file.active).toEqual({ claude: 'work' });
  });

  it('rejects an unknown locator type', () => {
    expect(() => locatorSchema.parse({ type: 'api-key', key: 'x' })).toThrow();
  });

  it('defaults disabled to false when absent (drop-safe, additive)', () => {
    const a = accountSchema.parse({
      label: 'worm',
      provider: 'claude',
      locator: { type: 'config-dir', dir: '~/.claude' },
    });
    expect(a.disabled).toBe(false);
  });

  it('round-trips an explicit disabled login', () => {
    const a = accountSchema.parse({
      label: 'ds',
      provider: 'deepseek',
      disabled: true,
      locator: { type: 'key-file', path: '/x' },
    });
    expect(a.disabled).toBe(true);
  });

  it('accountSchema carries an optional declared email and drops none of the old fields', () => {
    const parsed = accountSchema.parse({
      label: 'a',
      locator: { type: 'config-dir', dir: '/x' },
      email: 'a@b.org',
    });
    expect(parsed.email).toBe('a@b.org');
    expect(accountSchema.parse({ label: 'a', locator: { type: 'ambient' } }).email).toBeUndefined();
  });
});

describe('account id + provider capabilities', () => {
  it('parses an account without an id (legacy rows stay valid)', () => {
    const account = accountSchema.parse({ label: 'a@b.org', locator: { type: 'ambient' } });
    expect(account.id).toBeUndefined();
  });

  it('keeps an explicit id', () => {
    const account = accountSchema.parse({
      label: 'a@b.org',
      locator: { type: 'ambient' },
      id: '9f2c1ab30d44',
    });
    expect(account.id).toBe('9f2c1ab30d44');
  });

  it('declares isolated browser sessions for claude only', () => {
    expect(supportsIsolatedBrowserSession('claude')).toBe(true);
    expect(supportsIsolatedBrowserSession('deepseek')).toBe(false);
    expect(supportsIsolatedBrowserSession('longcat')).toBe(false);
  });

  it('says no for a provider it has never heard of', () => {
    expect(supportsIsolatedBrowserSession('gemini')).toBe(false);
  });
});
