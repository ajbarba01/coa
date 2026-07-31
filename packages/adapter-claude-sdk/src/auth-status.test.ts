import { describe, expect, it, vi } from 'vitest';
import { parseAuthStatus, probeAuthStatus } from './auth-status.js';

const LIVE = JSON.stringify({
  loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty',
  email: 'alex@barba.org', orgId: 'b9d…', orgName: "alex@barba.org's Organization",
  subscriptionType: 'pro',
});

describe('parseAuthStatus', () => {
  it('parses the live shape, stripping fields coa does not consume', () => {
    expect(parseAuthStatus(LIVE)).toEqual({
      loggedIn: true, email: 'alex@barba.org',
      orgName: "alex@barba.org's Organization", subscriptionType: 'pro',
    });
  });

  it('parses the logged-out shape', () => {
    expect(parseAuthStatus(JSON.stringify({ loggedIn: false }))).toEqual({ loggedIn: false });
  });

  it('is undefined on garbage — unknown, never a verdict', () => {
    expect(parseAuthStatus('not json')).toBeUndefined();
    expect(parseAuthStatus(JSON.stringify({ nope: 1 }))).toBeUndefined();
  });
});

describe('probeAuthStatus', () => {
  it('runs claude auth status --json against the dir and parses stdout', async () => {
    const run = vi.fn().mockResolvedValue(LIVE);
    const status = await probeAuthStatus('/managed/dir', run);
    expect(run).toHaveBeenCalledWith(
      'claude', ['auth', 'status', '--json'],
      expect.objectContaining({ CLAUDE_CONFIG_DIR: '/managed/dir' }),
    );
    expect(status?.loggedIn).toBe(true);
  });

  it('a failed spawn resolves undefined (unreachable CLI ≠ needs-relogin)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ENOENT'));
    expect(await probeAuthStatus('/dir', run)).toBeUndefined();
  });
});
