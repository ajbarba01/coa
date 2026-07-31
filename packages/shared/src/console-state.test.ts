import { describe, expect, it } from 'vitest';
import { consoleStateSchema } from './console-state.js';

describe('console state schema', () => {
  it('defaults isolated browser logins OFF and leaves the browser override unset', () => {
    const state = consoleStateSchema.parse({});
    expect(state.isolatedBrowserLogins).toBe(false);
    expect(state.browserPath).toBeUndefined();
  });

  it('round-trips an enabled toggle with an explicit browser path', () => {
    const state = consoleStateSchema.parse({
      isolatedBrowserLogins: true,
      browserPath: 'C:\\browsers\\chrome.exe',
    });
    expect(state).toMatchObject({
      isolatedBrowserLogins: true,
      browserPath: 'C:\\browsers\\chrome.exe',
    });
  });

  it('drops unknown keys instead of throwing', () => {
    expect(consoleStateSchema.parse({ bogus: 1 })).not.toHaveProperty('bogus');
  });
});
