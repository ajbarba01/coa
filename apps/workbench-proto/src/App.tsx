import {
  Button,
  ShortcutsOverlay,
  cx,
  PanelResize,
  resolveCollapse,
  useDismissLayer,
} from '@coa/console-kit';
import { useState } from 'react';
import { Center } from './Center.js';
import { KEYBINDS, useGlobalKeys } from './keys.js';
import { Nav } from './Nav.js';
import { Palette } from './Palette.js';
import { SettingsDialog } from './Settings.js';
import { ReopenWork, Work, WindowControls } from './Work.js';
import { ZOOM, useWorkbench } from './store.js';

const NAV = { min: 160, max: 300, base: 196 };
// min keeps the title-bar segment whole: agents label + the native window
// controls need ~195 layout px. Hysteresis between collapse/reopen kills
// boundary flapping while dragging.
const WORK = { min: 200, max: 340, base: 218, collapseBelow: 112, reopenAt: 132 };

export function App(): React.JSX.Element {
  const closeSearch = useWorkbench((s) => s.closeSearch);
  const mode = useWorkbench((s) => s.mode);

  // Search mode is itself a dismiss layer — anything opened on top of it
  // (modal, picker) pops first; the next Escape then closes search.
  useDismissLayer(mode === 'search', closeSearch);
  useGlobalKeys();

  const daemon = useWorkbench((s) => s.daemon);
  const workOpen = useWorkbench((s) => s.workOpen);
  const settingsOpen = useWorkbench((s) => s.settingsOpen);
  const shortcutsOpen = useWorkbench((s) => s.shortcutsOpen);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);
  const setShortcutsOpen = useWorkbench((s) => s.setShortcutsOpen);
  const [rightDragging, setRightDragging] = useState(false);
  if (daemon !== 'running') return <DaemonGate state={daemon} />;

  return (
    <div className="flex h-full" data-mode={mode}>
      <Nav />
      <PanelResize
        onDrag={(x) => {
          useWorkbench.getState().setNavWidth(Math.min(NAV.max, Math.max(NAV.min, x)));
        }}
        onReset={() => useWorkbench.getState().setNavWidth(NAV.base)}
      />
      <Center />
      {/* the seam stays mounted through a drag-collapse, so pulling back out
          in the same gesture resurrects the column, like vscode */}
      {(workOpen || rightDragging) && (
        <PanelResize
          onActiveChange={setRightDragging}
          onDrag={(x) => {
            const st = useWorkbench.getState();
            const r = resolveCollapse(window.innerWidth / ZOOM - x, WORK, st.workOpen);
            if (r.open !== st.workOpen) st.setWorkOpen(r.open);
            if (r.width !== null) st.setWorkWidth(r.width);
          }}
          onReset={() => useWorkbench.getState().setWorkWidth(WORK.base)}
        />
      )}
      {workOpen ? <Work /> : !rightDragging && <ReopenWork />}
      <Palette />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {shortcutsOpen && (
        <ShortcutsOverlay keybinds={KEYBINDS} onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}

/** No daemon, no console — the whole window yields to one message and one action. */
function DaemonGate({ state }: { state: 'starting' | 'stopped' }): React.JSX.Element {
  const setDaemon = useWorkbench((s) => s.setDaemon);

  const start = (): void => {
    setDaemon('starting');
    setTimeout(() => useWorkbench.getState().setDaemon('running'), 900);
  };

  return (
    <div className="slip-enter flex h-full flex-col bg-s1">
      {/* the window chrome survives the gate — you can still move/close the app */}
      <div className="flex h-[var(--titlebar-h)] flex-none items-stretch">
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <WindowControls />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <span
          className={cx(
            'h-2.5 w-2.5 rounded-full',
            state === 'starting' ? 'animate-pulse bg-warn' : 'bg-crit',
          )}
        />
        <div className="text-[13.5px] text-s9">
          {state === 'starting' ? 'starting the coa daemon…' : 'the coa daemon is not running'}
        </div>
        {state === 'stopped' && (
          <Button variant="primary" onClick={start}>
            Start daemon
          </Button>
        )}
      </div>
    </div>
  );
}
