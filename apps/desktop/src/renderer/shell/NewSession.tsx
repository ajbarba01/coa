import { useModalLayer } from '@coa/console-kit';
import { Command } from 'cmdk';
import { useConsoleState } from './consoleStore.js';
import { useShell } from './store.js';

/** The agent picker: the ONE way a session starts (the tab strip's + and ctrl+t both open
 *  it). Searchable over the agent's name and its model, because "which agent" is really
 *  "which model, which tools" once you have more than a few. */
export function NewSessionDialog(): React.JSX.Element | null {
  const open = useShell((s) => s.newSessionOpen);
  const setOpen = useShell((s) => s.setNewSessionOpen);
  // Same modal ground as the palette: ctrl+t summons it with no pointer press, so
  // superseding whatever menu was open has to be this surface's own doing.
  useModalLayer(open, () => setOpen(false));
  const state = useConsoleState((s) => s);

  if (!open || state === undefined) return null;
  const agents = state.data.agents.status === 'ok' ? state.data.agents.value : [];

  const start = (ref: string): void => {
    state.actions.newSession(ref);
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-(--z-modal) flex items-start justify-center bg-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <Command
        label="New session"
        // see Palette: cmdk's vim bindings would swallow the registry's ctrl-chords
        vimBindings={false}
        className="slip-enter mt-[14vh] w-120 max-w-[85%] overflow-hidden rounded-r4 border border-s5 bg-s2 shadow-modal"
      >
        <div className="flex items-center gap-2.5 border-b border-s3 px-4">
          <span className="text-[15px] text-s8">+</span>
          <Command.Input autoFocus placeholder="New session with…" />
        </div>
        <Command.List>
          <Command.Empty>No agent matches</Command.Empty>
          {agents.map((a) => (
            <Command.Item key={a.ref} value={`${a.name} ${a.ref}`} onSelect={() => start(a.ref)}>
              <span className="glyph">›</span>
              {a.name}
              <span className="ml-auto font-mono text-meta text-s6">
                {a.scope === 'builtin'
                  ? 'Built-in'
                  : a.scope === 'project'
                    ? 'Project'
                    : 'Personal'}
              </span>
            </Command.Item>
          ))}
          {agents.length === 0 && (
            <div className="px-3 py-1.5 text-code text-s7">No agents yet. Create one first.</div>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
