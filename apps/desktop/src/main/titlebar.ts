import type { BrowserWindowConstructorOptions, TitleBarOverlayOptions } from 'electron';
import type { ConsoleSettings } from '../shared/settings.js';

/** The full title-bar box height. Must stay in lockstep with AppShell's `h-[44px]`
 *  (border-box, so this includes the 1px bottom hairline). */
export const TITLE_BAR_HEIGHT = 44;

/** The Windows native-control overlay stops 1px short of the bar's bottom so the
 *  hairline border stays visible beneath it (the overlay is opaque and would
 *  otherwise cover it). */
export const OVERLAY_HEIGHT = TITLE_BAR_HEIGHT - 1;

type Theme = ConsoleSettings['theme'];

/** Native-overlay colors per theme (forge tokens; main cannot read CSS vars). The
 *  overlay is recolored at runtime on a theme change (`win.setTitleBarOverlay`), so
 *  the Windows caption controls track light/dark like the rest of the chrome. */
const OVERLAY: Record<Theme, { color: string; symbolColor: string }> = {
  dark: { color: '#1b1511', symbolColor: '#a89180' }, // bg-subtle / fg-muted (dark)
  light: { color: '#efe8dd', symbolColor: '#5c5142' }, // bg-subtle / fg-muted (light)
};

/** The Windows title-bar-overlay options for a theme, at the shared bar height. */
export function overlayForTheme(theme: Theme): TitleBarOverlayOptions {
  return { ...OVERLAY[theme], height: OVERLAY_HEIGHT };
}

/** The window background (shows on the pre-paint flash and at the frame edge) —
 *  the theme's base surface, not Electron's default white. */
export function windowBackground(theme: Theme): string {
  return theme === 'light' ? '#f6f1e9' : '#14100d'; // paper0 / brown0
}

/** Window chrome per platform (spec §9/§22.2). The custom AppShell title bar is the
 *  only chrome: macOS hides the frame and keeps native traffic lights (inset to clear
 *  our wordmark, re-centered for the 44px bar); Windows hides the frame and overlays
 *  the native controls into our bar at the matching height. */
export function titleBarConfig(
  platform: NodeJS.Platform,
  theme: Theme = 'dark',
): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 15 } };
  }
  if (platform === 'win32') {
    return { titleBarStyle: 'hidden', titleBarOverlay: overlayForTheme(theme) };
  }
  return {};
}
