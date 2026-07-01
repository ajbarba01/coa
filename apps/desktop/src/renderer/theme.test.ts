// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applySettings } from './theme.js';

afterEach(() => {
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-motion');
});

describe('applySettings', () => {
  it('injects token CSS and sets color-scheme', () => {
    applySettings({ theme: 'dark', density: 'compact', motion: 'full' });
    const style = document.getElementById('coa-tokens');
    expect(style?.textContent).toContain('--color-accent');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('marks reduced motion when requested', () => {
    applySettings({ theme: 'dark', density: 'compact', motion: 'reduce' });
    expect(document.documentElement.dataset.motion).toBe('reduce');
  });
});
