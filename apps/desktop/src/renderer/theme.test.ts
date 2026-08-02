// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applySettings } from './theme.js';

afterEach(() => {
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-motion');
  document.documentElement.style.colorScheme = '';
});

describe('applySettings', () => {
  it('sets the color scheme', () => {
    applySettings({ theme: 'dark', motion: 'full' });
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('injects no stylesheet — colour is the kit theme, resolved as plain CSS', () => {
    applySettings({ theme: 'dark', motion: 'full' });
    // The retired kit shipped its palette as a runtime <style> built from a hex table,
    // which is how the forge colours outlived the theme that owned them. If this element
    // ever comes back, a second source of colour has come back with it.
    expect(document.getElementById('coa-tokens')).toBeNull();
    expect(document.head.querySelector('style')).toBeNull();
  });

  it('marks reduced motion when requested', () => {
    applySettings({ theme: 'dark', motion: 'reduce' });
    expect(document.documentElement.dataset.motion).toBe('reduce');
  });

  it('clears the reduced-motion flag when motion returns to full', () => {
    applySettings({ theme: 'dark', motion: 'reduce' });
    applySettings({ theme: 'dark', motion: 'full' });
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });
});
