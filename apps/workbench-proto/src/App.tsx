import { Button, cx, useDismissLayer } from '@coa/console-kit';
import { useRef, useState } from 'react';
import { Center } from './Center.js';
import { ShortcutsOverlay, useGlobalKeys } from './keys.js';
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

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

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
        onDrag={(clientX) => {
          useWorkbench.getState().setNavWidth(clamp(clientX / ZOOM, NAV.min, NAV.max));
        }}
        onReset={() => useWorkbench.getState().setNavWidth(NAV.base)}
      />
      <Center />
      {/* the seam stays mounted through a drag-collapse, so pulling back out
          in the same gesture resurrects the column, like vscode */}
      {(workOpen || rightDragging) && (
        <PanelResize
          onActiveChange={setRightDragging}
          onDrag={(clientX) => {
            const st = useWorkbench.getState();
            const desired = (window.innerWidth - clientX) / ZOOM;
            if (desired < WORK.collapseBelow) {
              if (st.workOpen) st.setWorkOpen(false);
              return;
            }
            if (desired >= WORK.reopenAt && !st.workOpen) st.setWorkOpen(true);
            if (desired >= WORK.reopenAt) st.setWorkWidth(clamp(desired, WORK.min, WORK.max));
          }}
          onReset={() => useWorkbench.getState().setWorkWidth(WORK.base)}
        />
      )}
      {workOpen ? <Work /> : !rightDragging && <ReopenWork />}
      <Palette />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

/** A zero-width column seam: a 7px grab strip straddling the border, showing a
 *  brightened hairline on hover/drag. Double-click restores the default width.
 *  The drag runs until pointerup — collapse/reopen decisions live in onDrag. */
function PanelResize({
  onDrag,
  onReset,
  onActiveChange,
}: {
  onDrag: (clientX: number) => void;
  onReset: () => void;
  onActiveChange?: (active: boolean) => void;
}): React.JSX.Element {
  const [active, setActive] = useState(false);
  const dragging = useRef(false);

  const setDrag = (on: boolean): void => {
    dragging.current = on;
    setActive(on);
    onActiveChange?.(on);
  };

  return (
    <div className="relative z-20 w-0 flex-none">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="resize panel"
        onPointerDown={(e) => {
          e.preventDefault();
          setDrag(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragging.current) onDrag(e.clientX);
        }}
        onPointerUp={() => setDrag(false)}
        onDoubleClick={onReset}
        className="group absolute inset-y-0 -left-[3px] w-[7px] cursor-col-resize"
      >
        <span
          className={cx(
            'slip absolute inset-y-0 left-[3px] w-px',
            active ? 'bg-s7' : 'bg-transparent group-hover:bg-s6',
          )}
        />
      </div>
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
