import type { BrowserWindowConstructorOptions } from 'electron';

/** Window chrome per platform (spec §9/§22.2). The custom AppShell title bar is the
 *  only chrome: macOS hides the frame and keeps traffic lights (inset to clear our
 *  wordmark); Windows hides the frame and overlays the native controls into our bar,
 *  matching AppShell's `env(titlebar-area-*)` right inset and 36px (h-9) height.
 *  Colors are the forge dark tokens (main cannot read CSS vars). */
export function titleBarConfig(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 11 } };
  }
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#1b1511', symbolColor: '#a89180', height: 36 },
    };
  }
  return {};
}
