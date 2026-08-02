import type { ConsoleSettings } from '../shared/settings.js';

type ResolvedTheme = 'dark' | 'light';

/** The OS dark-mode query, resolved once (absent under jsdom, where matchMedia is
 *  unimplemented — callers then fall back to light). */
const osDark: MediaQueryList | undefined =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : undefined;

/** Resolve the theme preference to a concrete theme; 'system' follows the OS. */
export function resolveTheme(theme: ConsoleSettings['theme']): ResolvedTheme {
  if (theme !== 'system') return theme;
  return osDark?.matches ? 'dark' : 'light';
}

/** The live OS listener, kept only while the preference is 'system' so a mid-session
 *  light/dark flip repaints without a settings write. */
let osListener: (() => void) | undefined;

/** Apply the console settings to the document: set the OS color-scheme, flag reduced
 *  motion, and — when following the OS — keep tracking it. Colour itself is pure CSS now
 *  (the kit's theme file); nothing is injected at runtime. */
export function applySettings(settings: ConsoleSettings): void {
  const theme = resolveTheme(settings.theme);
  document.documentElement.style.colorScheme = theme;
  if (settings.motion === 'reduce') document.documentElement.dataset['motion'] = 'reduce';
  else document.documentElement.removeAttribute('data-motion');

  if (osDark) {
    if (osListener) osDark.removeEventListener('change', osListener);
    if (settings.theme === 'system') {
      osListener = () => applySettings(settings);
      osDark.addEventListener('change', osListener);
    } else {
      osListener = undefined;
    }
  }
}
