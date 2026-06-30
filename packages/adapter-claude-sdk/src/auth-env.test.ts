import { describe, expect, it } from 'vitest';
import { DEFAULT_CLEAR_VARS, resolveAuthEnv } from './auth-env.js';

describe('resolveAuthEnv', () => {
  it('returns no overlay for ambient (byte-identical to today)', () => {
    expect(resolveAuthEnv({ type: 'ambient' })).toBeUndefined();
  });

  it('sets CLAUDE_CONFIG_DIR and clears the api-key + ambient-token vars for config-dir', () => {
    const env = resolveAuthEnv({ type: 'config-dir', dir: '/home/u/.claude-work' });
    expect(env).toEqual({
      CLAUDE_CONFIG_DIR: '/home/u/.claude-work',
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
    });
  });

  it('takes the clear list as data (spike output)', () => {
    const env = resolveAuthEnv({ type: 'config-dir', dir: '/d' }, ['ANTHROPIC_API_KEY']);
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: '/d', ANTHROPIC_API_KEY: undefined });
  });

  it('DEFAULT_CLEAR_VARS covers the api-key and ambient-token vars', () => {
    expect(DEFAULT_CLEAR_VARS).toEqual([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ]);
  });
});
