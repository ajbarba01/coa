import { PanelResize, ShortcutsOverlay, resolveCollapse, useDismissLayer } from '@coa/console-kit';
import { useState } from 'react';
import { Center } from './Center.js';
import { KEYBINDS, useGlobalKeys } from './keys.js';
import { Nav } from './Nav.js';
import { Palette } from './Palette.js';
import { SettingsDialog } from './Settings.js';
import { useShell } from './store.js';
import { ReopenWork, Work } from './Work.js';

/** Column seam constraints (layout px). The dock's collapse hysteresis gap
 *  (collapseBelow < reopenAt) kills boundary flapping mid-gesture; its min
 *  keeps the AGENTS title-bar segment whole. */
export const NAV = { min: 160, max: 300, base: 196 };
export const WORK = { min: 200, max: 340, base: 218, collapseBelow: 112, reopenAt: 132 };

/** The three-column workbench frame. */
export function Workbench(): React.JSX.Element {
  const workOpen = useShell((s) => s.workOpen);
  const mode = useShell((s) => s.mode);
  const closeSearch = useShell((s) => s.closeSearch);
  const shortcutsOpen = useShell((s) => s.shortcutsOpen);
  const setShortcutsOpen = useShell((s) => s.setShortcutsOpen);
  // The seam stays mounted through a drag-collapse, so pulling back out in the
  // same gesture resurrects the column (VS Code behavior).
  const [rightDragging, setRightDragging] = useState(false);

  // Search mode is itself a dismiss layer — anything opened on top of it
  // (modal, picker) pops first; the next Escape then closes search.
  useDismissLayer(mode === 'search', closeSearch);
  useGlobalKeys();

  return (
    <div className="flex h-full" data-mode={mode}>
      <Nav />
      <PanelResize
        onDrag={(x) => {
          useShell.getState().setNavWidth(Math.min(NAV.max, Math.max(NAV.min, x)));
        }}
        onReset={() => useShell.getState().setNavWidth(NAV.base)}
      />
      <Center />
      {(workOpen || rightDragging) && (
        <PanelResize
          onActiveChange={setRightDragging}
          onDrag={(x) => {
            const st = useShell.getState();
            // Page zoom (setZoomLevel) keeps pointer coords AND innerWidth in
            // layout px, so no zoom division here — unlike the proto's CSS zoom.
            const r = resolveCollapse(window.innerWidth - x, WORK, st.workOpen);
            if (r.open !== st.workOpen) st.setWorkOpen(r.open);
            if (r.width !== null) st.setWorkWidth(r.width);
          }}
          onReset={() => useShell.getState().setWorkWidth(WORK.base)}
        />
      )}
      {workOpen ? <Work /> : !rightDragging && <ReopenWork />}
      <Palette />
      <SettingsDialog />
      {shortcutsOpen && (
        <ShortcutsOverlay keybinds={KEYBINDS} onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}
