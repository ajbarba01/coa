import { describe, expect, it } from 'vitest';
import { accountSchema, accountsFileSchema, locatorSchema } from './auth.js';

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
});
