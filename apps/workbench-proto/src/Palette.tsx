import { StatusDot } from '@coa/console-kit';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useDismissLayer } from './layers.js';
import { useWorkbench } from './store.js';

const SURFACES = ['chat', 'graph', 'flags', 'timeline', 'cost'];

/** ⌘K — the palette is the spine: every action reachable, nothing advertised. */
export function Palette(): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  useDismissLayer(open, () => setOpen(false));

  const sessions = useWorkbench((s) => s.sessions);
  const order = useWorkbench((s) => s.order);
  const running = useWorkbench((s) => s.running);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  const run = (fn: () => void): void => {
    fn();
    setOpen(false);
  };
  const st = useWorkbench.getState();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/35"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <Command
        label="command palette"
        className="slip-enter mt-[14vh] w-[560px] max-w-[85%] overflow-hidden rounded-r4 border border-s5 bg-s2 shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center gap-2.5 border-b border-s3 px-4">
          <span className="text-[15px] text-s8">❯</span>
          <Command.Input autoFocus placeholder="type a command or session…" />
        </div>
        <Command.List>
          <Command.Empty>nothing matches</Command.Empty>

          <Command.Group heading="actions">
            <Command.Item onSelect={() => run(() => st.toggleRaw())}>
              <span className="glyph">≡</span>
              {st.raw ? 'raw mode off' : 'raw mode — show the unfiltered loop'}
            </Command.Item>
            <Command.Item
              disabled={!running}
              onSelect={() =>
                run(() => {
                  st.setRunning(false);
                  st.setStatus(st.activeId, 'idle');
                })
              }
            >
              <span className="glyph">■</span>interrupt running turn
              <kbd>esc</kbd>
            </Command.Item>
            <Command.Item onSelect={() => run(() => st.openSearch())}>
              <span className="glyph">⌕</span>search sessions
              <kbd>ctrl p</kbd>
            </Command.Item>
            <Command.Item onSelect={() => run(() => st.setSettingsOpen(true))}>
              <span className="glyph">⚙</span>settings
              <kbd>ctrl ,</kbd>
            </Command.Item>
            <Command.Item onSelect={() => run(() => st.setShortcutsOpen(true))}>
              <span className="glyph">⌨</span>keyboard shortcuts
              <kbd>ctrl /</kbd>
            </Command.Item>
          </Command.Group>

          <Command.Group heading="go to">
            {SURFACES.map((s) => (
              <Command.Item key={s} onSelect={() => run(() => st.setSurface(s))}>
                <span className="glyph">›</span>
                {s}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="sessions">
            {order.map((id) => {
              const s = sessions[id];
              if (!s) return null;
              return (
                <Command.Item key={id} onSelect={() => run(() => st.select(id))}>
                  <StatusDot status={s.status} />
                  {s.title}
                  <span className="meta">{s.agent}</span>
                </Command.Item>
              );
            })}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
