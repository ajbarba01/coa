import { describe, expect, it } from 'vitest';
import { emailSlug, extractOauthUrl, managedLoginDir } from './login-driver.js';

describe('emailSlug', () => {
  it('flattens an email to a filesystem-safe slug', () => {
    expect(emailSlug('Alex@Barba.org')).toBe('alex-barba-org');
    expect(emailSlug('a+test@b.co')).toBe('a-test-b-co');
  });
  it('collapses runs and trims edge dashes', () => {
    expect(emailSlug('--a..b@c--')).toBe('a-b-c');
  });
});

describe('managedLoginDir', () => {
  it('derives ~/.coa/logins/<slug>', () => {
    expect(managedLoginDir('/home/z', 'alex@barba.org').replaceAll('\\', '/')).toBe(
      '/home/z/.coa/logins/alex-barba-org',
    );
  });
});

describe('extractOauthUrl', () => {
  it('captures the printed authorize URL from CLI output', () => {
    const chunk =
      'If the browser didn\'t open, visit:\r\n  https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&scope=user%3Ainference\r\n';
    expect(extractOauthUrl(chunk)).toBe(
      'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&scope=user%3Ainference',
    );
  });
  it('sees through ANSI escapes and ignores non-oauth urls', () => {
    expect(extractOauthUrl('\x1b[1mvisit https://claude.ai/cai/oauth/x?y=1\x1b[0m')).toBe(
      'https://claude.ai/cai/oauth/x?y=1',
    );
    expect(extractOauthUrl('see https://docs.claude.com/help')).toBeUndefined();
  });
});
