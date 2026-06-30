import { describe, expect, it } from 'vitest';
import { AMBIENT, accountSchema, accountsFileSchema, locatorSchema } from './auth.js';

describe('auth schema', () => {
  it('accepts each locator type', () => {
    expect(locatorSchema.parse({ type: 'config-dir', dir: '/home/u/.claude-work' }).type).toBe(
      'config-dir',
    );
    expect(locatorSchema.parse({ type: 'ant-profile', profile: 'work' }).type).toBe('ant-profile');
    expect(locatorSchema.parse({ type: 'ambient' }).type).toBe('ambient');
  });

  it('defaults provider to claude', () => {
    const account = accountSchema.parse({
      label: 'work',
      locator: { type: 'config-dir', dir: '/d' },
    });
    expect(account.provider).toBe('claude');
  });

  it('parses an accounts file with the ambient sentinel as active', () => {
    const file = accountsFileSchema.parse({ active: AMBIENT, accounts: [] });
    expect(file.active).toBe('ambient');
  });

  it('rejects an unknown locator type', () => {
    expect(() => locatorSchema.parse({ type: 'api-key', key: 'x' })).toThrow();
  });
});
