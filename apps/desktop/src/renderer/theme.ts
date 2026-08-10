import type { ConsoleSettings } from '../shared/settings.js';

/** Apply the console settings to the document: pin the OS color-scheme dark (the kit
 *  ships a single dark theme, so form controls and scrollbars must match it) and flag
 *  reduced motion. Colour itself is pure CSS (the kit's theme file); nothing is
 *  injected at runtime. */
export function applySettings(settings: ConsoleSettings): void {
  document.documentElement.style.colorScheme = 'dark';
  if (settings.motion === 'reduce') document.documentElement.dataset['motion'] = 'reduce';
  else document.documentElement.removeAttribute('data-motion');
}
