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

  it('carries a session’s lineage and spend through the real IPC validation gate — not just a mapper', () => {
    // `main/index.ts` runs every daemon result through `spec.result.parse` before it
    // ever reaches the renderer (`ipcMain.handle` above `runMethod`); a field missing
    // from THIS schema is silently stripped right here, regardless of what the
    // daemon actually sent. This is the boundary a mapper-only test can't see.
    const withLineage = {
      id: 's1',
      agentRef: 'roles/reviewer',
      title: 'spawned child',
      updatedAt: '2026-08-01T00:00:00Z',
      parent: 'root-1',
      root: 'root-1',
      costUsd: 0.5,
    };
    expect(METHODS.listSessions.result.parse([withLineage])).toEqual([withLineage]);
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
    expect(
      METHODS.setCredentialDisabled.params?.parse({ id: 'test', disabled: true }),
    ).toBeTruthy();
    expect(METHODS.makeActive.params?.parse({ id: 'test' })).toBeTruthy();
    expect(METHODS.clearCooldown.params?.parse({ id: 'test' })).toBeTruthy();
    expect(METHODS.refresh.params).toBeUndefined();
    expect(METHODS.setIsolatedBrowserLogins.params?.parse({ on: true })).toBeTruthy();
    expect(METHODS.setBrowserPath.params?.parse({ path: 'C:\\chrome.exe' })).toBeTruthy();
    expect(METHODS.removeCredential.params?.parse({ id: 'x', removeProfile: true })).toBeTruthy();
  });

  it('validates openProject params/result (F11)', () => {
    expect(
      METHODS.openProject.params?.parse({ root: 'C:\\repos\\alpha', target: 'new' }),
    ).toBeTruthy();
    expect(() => METHODS.openProject.params?.parse({ root: 'C:\\repos\\alpha' })).toThrow();
    expect(() =>
      METHODS.openProject.params?.parse({ root: 'C:\\repos\\alpha', target: 'sideways' }),
    ).toThrow();
    expect(
      METHODS.openProject.result.parse({
        opened: 'focused-existing',
        workspace: { name: 'alpha', root: 'C:\\repos\\alpha' },
      }),
    ).toBeTruthy();
  });

  it('validates listRecentProjects result (F11)', () => {
    const list = [{ root: 'C:\\repos\\alpha', name: 'alpha', lastOpenedAt: 1, open: true }];
    expect(METHODS.listRecentProjects.result.parse(list)).toEqual(list);
    expect(() => METHODS.listRecentProjects.result.parse([{ root: 'C:\\repos\\alpha' }])).toThrow();
  });

  it('validates setMode params/result (F2) and rejects a mode outside the four ruled values', () => {
    expect(METHODS.setMode.params?.parse({ id: 'c1', mode: 'plan' })).toBeTruthy();
    expect(() => METHODS.setMode.params?.parse({ id: 'c1', mode: 'auto' })).toThrow();
    expect(() => METHODS.setMode.params?.parse({ mode: 'plan' })).toThrow();
    expect(METHODS.setMode.result.parse({ set: true })).toEqual({ set: true });
  });

  it('validates respondApproval params/result (F2)', () => {
    expect(
      METHODS.respondApproval.params?.parse({ id: 'c1', requestId: 'r1', decision: 'approve' }),
    ).toBeTruthy();
    expect(() =>
      METHODS.respondApproval.params?.parse({ id: 'c1', requestId: 'r1', decision: 'maybe' }),
    ).toThrow();
    expect(METHODS.respondApproval.result.parse({ resolved: false })).toEqual({
      resolved: false,
    });
  });

  it('validates sessionMode result — both the not-found and the full snapshot shapes (F2)', () => {
    expect(METHODS.sessionMode.result.parse({ found: false })).toEqual({ found: false });
    const snapshot = {
      found: true,
      mode: 'manual',
      effectiveMode: 'bypass',
      pending: [{ requestId: 'r1', tool: 'bash', summary: 'run tests', input: {} }],
    };
    expect(METHODS.sessionMode.result.parse(snapshot)).toEqual(snapshot);
    expect(() => METHODS.sessionMode.result.parse({ found: true, mode: 'manual' })).toThrow();
  });
});
