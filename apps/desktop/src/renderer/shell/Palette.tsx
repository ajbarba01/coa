import { StatusDot, useDismissLayer } from '@coa/console-kit';
import { Command } from 'cmdk';
import { useConsoleState } from './consoleStore.js';
import { bindFor } from './keys.js';
import { SURFACES } from './Nav.js';
import { useShell } from './store.js';

/** A palette row's chord, read from the registry — a rebinding reaches this too, and an
 *  unbound command simply shows no key. */
function Chord({ id }: { id: string }): React.JSX.Element | null {
  const keys = bindFor(id);
  return keys === undefined ? null : <kbd>{keys.join(' ')}</kbd>;
}

/** ⌘K — the palette is the spine: every action reachable, nothing advertised.
 *  Raw mode lives ONLY here (D85: always reachable, never chrome). The summon itself is
 *  a registry command (`palette`), dispatched with the rest — so it can be rebound. */
export function Palette(): React.JSX.Element | null {
  const open = useShell((s) => s.paletteOpen);
  const setOpen = useShell((s) => s.setPaletteOpen);
  useDismissLayer(open, () => setOpen(false));
  const state = useConsoleState((s) => s);

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
        // cmdk's vim bindings claim ctrl+k/ctrl+p/ctrl+n/ctrl+j for list navigation and
        // preventDefault them — which silently ate the palette's OWN summon chord, so
        // ctrl+k opened it but could never close it. The arrows navigate; the chords are
        // the registry's.
        vimBindings={false}
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
            <Command.Item onSelect={() => run(() => shell.setNewSessionOpen(true))}>
              <span className="glyph">+</span>new session
              <Chord id="new-session" />
            </Command.Item>
            <Command.Item onSelect={() => run(() => shell.openSearch())}>
              <span className="glyph">⌕</span>search sessions
              <Chord id="search-sessions" />
            </Command.Item>
            <Command.Item onSelect={() => run(() => shell.setSettingsOpen(true))}>
              <span className="glyph">⚙</span>settings
              <Chord id="settings" />
            </Command.Item>
            <Command.Item onSelect={() => run(() => shell.setShortcutsOpen(true))}>
              <span className="glyph">⌨</span>keyboard shortcuts
              <Chord id="shortcuts" />
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
