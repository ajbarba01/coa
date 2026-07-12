import type { Keybind } from '@coa/console-kit';
import { hasOpenLayers } from '@coa/console-kit';
import { useEffect } from 'react';
import { useConsoleState } from './consoleStore.js';
import { useShell } from './store.js';

/** One keybind registry: the dispatch table and the shortcuts overlay both
 *  read it, so a bind can't exist without being discoverable. */
export const KEYBINDS: Keybind[] = [
  { keys: ['ctrl', 'k'], label: 'command palette', group: 'global' },
  { keys: ['ctrl', 'p'], label: 'search sessions', group: 'global' },
  { keys: ['ctrl', ','], label: 'settings', group: 'global' },
  { keys: ['ctrl', '/'], label: 'keyboard shortcuts', group: 'global' },
  { keys: ['ctrl', 'b'], label: 'toggle the session panel', group: 'workbench' },
  { keys: ['ctrl', 'f'], label: 'find in conversation', group: 'workbench' },
  { keys: ['esc'], label: 'dismiss the topmost layer · stop a running turn', group: 'workbench' },
  { keys: ['enter'], label: 'send message', group: 'composer' },
];

/** Registry lookup for tooltips — a surfaced bind can never drift from dispatch. */
export function bindFor(label: string): string[] | undefined {
  return KEYBINDS.find((k) => k.label === label)?.keys;
}

/** Global ctrl/cmd dispatch. ⌘K stays in Palette (it owns toggle-vs-focus);
 *  Escape belongs to the dismiss-layer stack (and the composer's stop). */
export function useGlobalKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Escape's authority is the dismiss stack; only when the stack is EMPTY
      // does Escape fall through to "stop the running turn" (SC-1: a user
      // stop, advisory, fire-and-forget — the pill clears from the daemon's
      // own status push). The composer's focused-Esc stop still fires first
      // for typing users; this covers Esc from anywhere else in the frame.
      // Bare Escape only: an IME-composition cancel, a handler that already
      // claimed the key (the composer's focused stop — no double interrupt),
      // and modifier chords all pass through.
      if (e.key === 'Escape' && e.isComposing) return;
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !hasOpenLayers()
      ) {
        const cs = useConsoleState.getState();
        const id = cs?.ui.activeSessionId;
        if (cs !== undefined && id !== undefined && cs.ui.runStatus[id] !== undefined) {
          cs.actions.interruptSession(id);
        }
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const st = useShell.getState();
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
        case 'p': {
          e.preventDefault();
          // Swap over a dialog (the shortcut wins — openSearch closes them);
          // with nothing on top it's a plain toggle.
          const dialogOpen =
            st.settingsOpen || st.shortcutsOpen || st.paletteOpen || st.projectOpen;
          if (!dialogOpen && st.mode === 'search') st.closeSearch();
          else st.openSearch();
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
