import type { Keybind } from '@coa/console-kit';
import { useEffect } from 'react';
import { useWorkbench } from './store.js';

/** One keybind registry: the dispatch table and the shortcuts overlay both
 *  read it, so a bind can't exist without being discoverable. */
export const KEYBINDS: Keybind[] = [
  { keys: ['ctrl', 'k'], label: 'command palette', group: 'global' },
  { keys: ['ctrl', 'p'], label: 'search sessions', group: 'global' },
  { keys: ['ctrl', ','], label: 'settings', group: 'global' },
  { keys: ['ctrl', '/'], label: 'keyboard shortcuts', group: 'global' },
  { keys: ['ctrl', 'b'], label: 'toggle the session panel', group: 'workbench' },
  { keys: ['esc'], label: 'dismiss the topmost layer', group: 'workbench' },
  { keys: ['enter'], label: 'send message', group: 'composer' },
];

/** Global ctrl/cmd dispatch. ⌘K stays in Palette (it owns toggle-vs-focus);
 *  Escape belongs to the dismiss-layer stack. */
export function useGlobalKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const st = useWorkbench.getState();
      switch (e.key.toLowerCase()) {
        case ',':
          e.preventDefault();
          st.setSettingsOpen(!st.settingsOpen);
          break;
        case '/':
          e.preventDefault();
          st.setShortcutsOpen(!st.shortcutsOpen);
          break;
        case 'b':
          e.preventDefault();
          st.toggleWork();
          break;
        case 'p':
          e.preventDefault();
          st.openSearch();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
