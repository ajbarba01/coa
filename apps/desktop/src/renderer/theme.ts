import { tokensToCss } from '@coa/console-ui';
import type { ConsoleSettings } from '../shared/settings.js';

/** Apply the console settings to the document: re-resolve token CSS for the theme/
 *  density into the shared <style>, set the OS color-scheme, and flag reduced motion
 *  (globals.css neutralizes animations under [data-motion='reduce']). */
export function applySettings(settings: ConsoleSettings): void {
  let style = document.getElementById('coa-tokens');
  if (!style) {
    style = document.createElement('style');
    style.id = 'coa-tokens';
    document.head.appendChild(style);
  }
  style.textContent = tokensToCss(settings.theme, settings.density);
  document.documentElement.style.colorScheme = settings.theme;
  if (settings.motion === 'reduce') document.documentElement.dataset['motion'] = 'reduce';
  else document.documentElement.removeAttribute('data-motion');
}
