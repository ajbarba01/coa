import { describe, expect, it } from 'vitest';
import { TITLE_BAR_HEIGHT, titleBarConfig, windowBackground } from './titlebar.js';

describe('titleBarConfig', () => {
  it('hides the frame with no native overlay on Windows (controls are DOM)', () => {
    const c = titleBarConfig('win32');
    expect(c.titleBarStyle).toBe('hidden');
    expect(c.titleBarOverlay).toBeUndefined();
  });

  it('hides the frame and keeps traffic lights on macOS', () => {
    const c = titleBarConfig('darwin');
    expect(c.titleBarStyle).toBe('hidden');
    expect(c.trafficLightPosition).toBeDefined();
    expect(c.titleBarOverlay).toBeUndefined();
  });

  it('is a plain window elsewhere', () => {
    expect(titleBarConfig('linux')).toEqual({});
  });
});

describe('TITLE_BAR_HEIGHT', () => {
  it('stays in lockstep with the AppShell bar height', () => {
    expect(TITLE_BAR_HEIGHT).toBe(44);
  });
});

describe('windowBackground', () => {
  it('is the theme base surface, never white', () => {
    expect(windowBackground('dark')).toBe('#14100d');
    expect(windowBackground('light')).toBe('#f6f1e9');
  });
});
