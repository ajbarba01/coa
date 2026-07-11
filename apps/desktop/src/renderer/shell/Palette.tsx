import { StatusDot, useDismissLayer } from '@coa/console-kit';
import { Command } from 'cmdk';
import { useEffect } from 'react';
import { useConsoleState } from './consoleStore.js';
import { SURFACES } from './Nav.js';
import { useShell } from './store.js';

/** ⌘K — the palette is the spine: every action reachable, nothing advertised.
 *  Raw mode lives ONLY here (D85: always reachable, never chrome). */
export function Palette(): React.JSX.Element | null {
  const open = useShell((s) => s.paletteOpen);
  const setOpen = useShell((s) => s.setPaletteOpen);
  useDismissLayer(open, () => setOpen(false));
  const state = useConsoleState((s) => s);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useShell.getState().setPaletteOpen(!useShell.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open || state === undefined) return null;

  const run = (fn: () => void): void => {
    fn();
    setOpen(false);
  };
  const shell = useShell.getState();
  const sessions = state.data.sessions.status === 'ok' ? state.data.sessions.value : [];
  const activeId = state.ui.activeSessionId;
  const running = activeId !== undefined && state.ui.runStatus[activeId] !== undefined;

  return (
    <div
      className="fixed inset-0 z-(--z-modal) flex items-start justify-center bg-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <Command
        label="command palette"
        className="slip-enter mt-[14vh] w-140 max-w-[85%] overflow-hidden rounded-r4 border border-s5 bg-s2 shadow-modal"
      >
        <div className="flex items-center gap-2.5 border-b border-s3 px-4">
          <span className="text-[15px] text-s8">❯</span>
          <Command.Input autoFocus placeholder="type a command or session…" />
        </div>
        <Command.List>
          <Command.Empty>nothing matches</Command.Empty>

          <Command.Group heading="actions">
            <Command.Item onSelect={() => run(() => state.actions.toggleRaw())}>
              <span className="glyph">≡</span>
              {state.ui.rawMode ? 'raw mode off' : 'raw mode — show the unfiltered loop'}
            </Command.Item>
            <Command.Item
              disabled={!running}
              onSelect={() =>
                run(() => {
                  if (activeId !== undefined) state.actions.interruptSession(activeId);
                })
              }
            >
              <span className="glyph">■</span>interrupt running turn
              <kbd>esc</kbd>
            </Command.Item>
            <Command.Item onSelect={() => run(() => shell.openSearch())}>
              <span className="glyph">⌕</span>search sessions
              <kbd>ctrl p</kbd>
            </Command.Item>
            <Command.Item onSelect={() => run(() => shell.setSettingsOpen(true))}>
              <span className="glyph">⚙</span>settings
              <kbd>ctrl ,</kbd>
            </Command.Item>
            <Command.Item onSelect={() => run(() => shell.setShortcutsOpen(true))}>
              <span className="glyph">⌨</span>keyboard shortcuts
              <kbd>ctrl /</kbd>
            </Command.Item>
          </Command.Group>

          <Command.Group heading="go to">
            {SURFACES.map((s) => (
              <Command.Item key={s.id} onSelect={() => run(() => shell.setSurface(s.id))}>
                <span className="glyph">›</span>
                {s.label}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="sessions">
            {sessions.slice(0, 20).map((s) => (
              <Command.Item
                key={s.id}
                onSelect={() => run(() => state.actions.selectSession(s.id))}
              >
                <StatusDot status={state.ui.runStatus[s.id] !== undefined ? 'running' : 'idle'} />
                {s.title}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
