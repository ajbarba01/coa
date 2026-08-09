import { describe, expect, it } from 'vitest';
import { createWindowRegistry } from './window-registry.js';

// A trivial canonicalizer for tests: case-fold only, matching the win32 rule
// `canonicalProjectRoot` applies for real — the registry itself never cares HOW
// identity is computed, only that it's injected.
const canon = (root: string): string => root.toLowerCase();

describe('createWindowRegistry', () => {
  it('binds a window to a root and reads it back', () => {
    const reg = createWindowRegistry<string>(canon);
    reg.bind(1, 'win-a', 'C:\\repos\\alpha');
    expect(reg.rootOf(1)).toBe('C:\\repos\\alpha');
  });

  it('finds the window bound to a root, case-insensitively per the injected canonicalizer', () => {
    const reg = createWindowRegistry<string>(canon);
    reg.bind(1, 'win-a', 'C:\\Repos\\Alpha');
    expect(reg.windowForRoot('c:\\repos\\alpha')).toBe('win-a');
  });

  it('returns undefined for a root nothing is bound to', () => {
    const reg = createWindowRegistry<string>(canon);
    expect(reg.windowForRoot('C:\\repos\\alpha')).toBeUndefined();
  });

  it('rebind changes which root a window reports, and which window a root resolves to', () => {
    const reg = createWindowRegistry<string>(canon);
    reg.bind(1, 'win-a', 'C:\\repos\\alpha');
    reg.rebind(1, 'C:\\repos\\beta');
    expect(reg.rootOf(1)).toBe('C:\\repos\\beta');
    expect(reg.windowForRoot('C:\\repos\\alpha')).toBeUndefined();
    expect(reg.windowForRoot('C:\\repos\\beta')).toBe('win-a');
  });

  it('rebind on an unregistered id is a no-op', () => {
    const reg = createWindowRegistry<string>(canon);
    reg.rebind(99, 'C:\\repos\\alpha');
    expect(reg.rootOf(99)).toBeUndefined();
  });

  it('unbind drops the window — root lookups and rootOf both forget it', () => {
    const reg = createWindowRegistry<string>(canon);
    reg.bind(1, 'win-a', 'C:\\repos\\alpha');
    reg.unbind(1);
    expect(reg.rootOf(1)).toBeUndefined();
    expect(reg.windowForRoot('C:\\repos\\alpha')).toBeUndefined();
  });

  it('openRoots lists every bound root, one per window', () => {
    const reg = createWindowRegistry<string>(canon);
    reg.bind(1, 'win-a', 'C:\\repos\\alpha');
    reg.bind(2, 'win-b', 'C:\\repos\\beta');
    expect(reg.openRoots().sort()).toEqual(['C:\\repos\\alpha', 'C:\\repos\\beta']);
  });

  it('all returns every entry with id, window, and root', () => {
    const reg = createWindowRegistry<string>(canon);
    reg.bind(1, 'win-a', 'C:\\repos\\alpha');
    expect(reg.all()).toEqual([{ id: 1, win: 'win-a', root: 'C:\\repos\\alpha' }]);
  });

  it('two windows can be bound to two different projects independently', () => {
    const reg = createWindowRegistry<string>(canon);
    reg.bind(1, 'win-a', 'C:\\repos\\alpha');
    reg.bind(2, 'win-b', 'C:\\repos\\beta');
    expect(reg.windowForRoot('C:\\repos\\alpha')).toBe('win-a');
    expect(reg.windowForRoot('C:\\repos\\beta')).toBe('win-b');
  });
});
