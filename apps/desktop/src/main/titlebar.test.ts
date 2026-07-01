import { describe, expect, it } from 'vitest';
import { titleBarConfig } from './titlebar.js';

describe('titleBarConfig', () => {
  it('hides the frame and overlays the window controls on Windows', () => {
    const c = titleBarConfig('win32');
    expect(c.titleBarStyle).toBe('hidden');
    expect(c.titleBarOverlay).toMatchObject({
      color: '#1b1511',
      symbolColor: '#a89180',
      height: 36,
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
