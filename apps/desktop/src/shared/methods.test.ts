import { describe, expect, it } from 'vitest';
import { AuthViewSchema } from '@coa/console-viewmodel';
import { METHODS, channel } from './methods.js';

describe('IPC method registry', () => {
  it('names channels per verb', () => {
    expect(channel('capState')).toBe('coa:capState');
    expect(channel('saveLayout')).toBe('coa:saveLayout');
  });

  it('validates a cap result and rejects a malformed one', () => {
    expect(METHODS.capState.result.parse({ remaining: null, capHit: false })).toBeTruthy();
    expect(() => METHODS.capState.result.parse({})).toThrow();
  });

  it('accepts an opaque layout for save and read', () => {
    expect(() => METHODS.saveLayout.params?.parse({ any: 'json' })).not.toThrow();
    expect(METHODS.getLayout.result.parse({ any: 'json' })).toBeTruthy();
  });

  it('validates the flags and timeline results', () => {
    expect(METHODS.flagsForUser.result.parse({ expanded: [], collapsed: [] })).toBeTruthy();
    expect(METHODS.listTimeline.result.parse([])).toBeTruthy();
    expect(() => METHODS.listTimeline.result.parse({})).toThrow();
  });

  it('validates the account verbs', () => {
    expect(
      METHODS.listAccounts.result.parse({
        accounts: [{ label: 'a', provider: 'claude' }],
        active: { claude: 'a' },
      }),
    ).toBeTruthy();
    expect(METHODS.currentAccount.result.parse({ active: { deepseek: 'ds' } })).toBeTruthy();
    expect(METHODS.useAccount.params?.parse({ label: 'a', provider: 'deepseek' })).toBeTruthy();
    expect(() => METHODS.useAccount.params?.parse({})).toThrow();
  });

  it('registers the auth verbs with AuthViewSchema result', () => {
    const authVerbs = [
      'authView',
      'addProvider',
      'removeProvider',
      'addCredential',
      'replaceSecret',
      'renameCredential',
      'removeCredential',
      'setProviderEnabled',
      'setCredentialDisabled',
      'makeActive',
      'clearCooldown',
      'refresh',
      'setIsolatedBrowserLogins',
      'setBrowserPath',
    ] as const;

    for (const verb of authVerbs) {
      expect(METHODS[verb]).toBeDefined();
      expect(METHODS[verb].result).toBe(AuthViewSchema);
    }

    // Verify params schemas
    expect(METHODS.authView.params).toBeUndefined();
    expect(METHODS.addProvider.params?.parse({ providerId: 'test' })).toBeTruthy();
    expect(METHODS.removeProvider.params?.parse({ providerId: 'test' })).toBeTruthy();
    expect(
      METHODS.addCredential.params?.parse({ providerId: 'test', label: 'label', secret: 'secret' }),
    ).toBeTruthy();
    expect(METHODS.replaceSecret.params?.parse({ id: 'test', secret: 'secret' })).toBeTruthy();
    expect(METHODS.renameCredential.params?.parse({ id: 'test', label: 'label' })).toBeTruthy();
    expect(METHODS.removeCredential.params?.parse({ id: 'test' })).toBeTruthy();
    expect(METHODS.setProviderEnabled.params?.parse({ providerId: 'test', on: true })).toBeTruthy();
    expect(METHODS.setCredentialDisabled.params?.parse({ id: 'test', disabled: true })).toBeTruthy();
    expect(METHODS.makeActive.params?.parse({ id: 'test' })).toBeTruthy();
    expect(METHODS.clearCooldown.params?.parse({ id: 'test' })).toBeTruthy();
    expect(METHODS.refresh.params).toBeUndefined();
    expect(METHODS.setIsolatedBrowserLogins.params?.parse({ on: true })).toBeTruthy();
    expect(METHODS.setBrowserPath.params?.parse({ path: 'C:\\chrome.exe' })).toBeTruthy();
    expect(METHODS.removeCredential.params?.parse({ id: 'x', removeProfile: true })).toBeTruthy();
  });
});
