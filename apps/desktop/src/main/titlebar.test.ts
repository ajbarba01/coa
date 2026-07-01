import { describe, expect, it } from 'vitest';
import {
  OVERLAY_HEIGHT,
  TITLE_BAR_HEIGHT,
  overlayForTheme,
  titleBarConfig,
  windowBackground,
} from './titlebar.js';

describe('titleBarConfig', () => {
  it('hides the frame and overlays the window controls on Windows at the bar height', () => {
    const c = titleBarConfig('win32');
    expect(c.titleBarStyle).toBe('hidden');
    expect(c.titleBarOverlay).toMatchObject({
      color: '#1b1511',
      symbolColor: '#a89180',
      height: OVERLAY_HEIGHT,
    });
  });

  it('themes the Windows overlay to the requested theme', () => {
    expect(titleBarConfig('win32', 'light').titleBarOverlay).toMatchObject({
      color: '#efe8dd',
      symbolColor: '#5c5142',
      height: OVERLAY_HEIGHT,
    });
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

describe('overlayForTheme', () => {
  it('stops 1px short of the bar so the bottom hairline stays visible', () => {
    expect(OVERLAY_HEIGHT).toBe(TITLE_BAR_HEIGHT - 1);
    expect(overlayForTheme('dark').height).toBe(OVERLAY_HEIGHT);
    expect(overlayForTheme('light').height).toBe(OVERLAY_HEIGHT);
  });
});

describe('windowBackground', () => {
  it('is the theme base surface, never white', () => {
    expect(windowBackground('dark')).toBe('#14100d');
    expect(windowBackground('light')).toBe('#f6f1e9');
  });
});
