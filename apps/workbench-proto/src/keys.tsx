import { useEffect } from 'react';
import { useDismissLayer } from './layers.js';
import { useWorkbench } from './store.js';

/** One keybind registry: the dispatch table and the shortcuts overlay both
 *  read it, so a bind can't exist without being discoverable. */

export interface Keybind {
  keys: string[];
  label: string;
  group: string;
}

/** The kbd chip — every surface that names a shortcut renders it with this. */
export function Kbd({ children }: { children: string }): React.JSX.Element {
  return (
    <kbd className="rounded-r1 border border-s4 bg-s3 px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-normal text-s9">
      {children}
    </kbd>
  );
}

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

export function ShortcutsOverlay({ onClose }: { onClose: () => void }): React.JSX.Element {
  useDismissLayer(true, onClose);
  const groups = [...new Set(KEYBINDS.map((k) => k.group))];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="keyboard shortcuts"
        className="slip-enter w-[380px] overflow-hidden rounded-r4 border border-s5 bg-s2 pb-2 shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center border-b border-s3 px-4 py-2.5 text-[10px] tracking-[0.07em] text-s7 uppercase">
          keyboard shortcuts
          <button
            type="button"
            onClick={onClose}
            aria-label="close shortcuts"
            className="slip ml-auto flex h-6 w-6 cursor-pointer items-center justify-center text-[13px] tracking-normal text-s7 hover:text-s10"
          >
            ✕
          </button>
        </div>
        {groups.map((g) => (
          <div key={g} className="pt-2.5">
            <div className="px-4 pb-0.5 text-[10px] tracking-[0.07em] text-s6 uppercase">{g}</div>
            {KEYBINDS.filter((k) => k.group === g).map((k) => (
              <div key={k.label} className="flex items-center px-4 py-[5px] text-[12px] text-s10">
                {k.label}
                <span className="ml-auto flex gap-1">
                  {k.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
