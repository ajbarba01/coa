import type { BrowserWindowConstructorOptions } from 'electron';

/** The full title-bar box height. Must stay in lockstep with the kit's `--titlebar-h`
 *  (border-box, so this includes the 1px bottom hairline). */
export const TITLE_BAR_HEIGHT = 44;

/** A concrete theme — the settings `'system'` preference is resolved to one of these
 *  (via `nativeTheme`) before it reaches the chrome. */
export type ResolvedTheme = 'dark' | 'light';

/** The window background (shows on the pre-paint flash and at the frame edge) —
 *  the theme's base surface, not Electron's default white. Dark mirrors console-kit's
 *  sand-dark `--color-s1` (the theme is pinned dark for now); light keeps the prior
 *  paper hex until a light scale exists in the kit. */
export function windowBackground(theme: ResolvedTheme): string {
  return theme === 'light' ? '#f6f1e9' : '#111110'; // paper0 / sand s1
}

/** Window chrome per platform. The custom DOM title bar (the workbench's segmented bar) is the
 *  only chrome, and the whole bar — including the window controls — is DOM so it scales
 *  with the Ctrl+/- content zoom. macOS hides the frame and keeps native traffic lights
 *  (inset to clear our wordmark, re-centered for the 44px bar); Windows hides the frame
 *  and draws its own min/max/close in the bar (no native overlay, which would not zoom). */
export function titleBarConfig(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 15 } };
  }
  if (platform === 'win32') {
    return { titleBarStyle: 'hidden' };
  }
  return {};
}
