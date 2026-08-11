import {
  PanelResize,
  ShortcutsOverlay,
  resolveCollapse,
  useDismissLayer,
  type KeybindEditing,
} from '@coa/console-kit';
import { useState } from 'react';
import { Center } from './Center.js';
import { LoginDialog } from '../panels/LoginFlow.js';
import { consoleActions } from '../store/actions.js';
import { useConsoleUi } from '../store/ui.js';
import { chordFromEvent, conflictFor, isBindable, rebind } from './keybinds.js';
import { useGlobalKeys, useKeybinds } from './keys.js';
import { Nav } from './Nav.js';
import { NewSessionDialog } from './NewSession.js';
import { Palette } from './Palette.js';
import { SettingsDialog } from './Settings.js';
import { useShell } from './store.js';
import { ReopenWork, Work } from './Work.js';

/** Column seam constraints (layout px). The dock's collapse hysteresis gap
 *  (collapseBelow < reopenAt) kills boundary flapping mid-gesture; its min
 *  keeps the AGENTS title-bar segment whole. */
export const NAV = { min: 160, max: 300, base: 196 };
export const WORK = { min: 200, max: 340, base: 218, collapseBelow: 112, reopenAt: 132 };
/** The middle column is the work, not the leftovers: neither seam may squeeze it below
 *  this. Sized so it survives both columns at their min on the smallest window we allow
 *  (main's `minWidth`) — the tab strip, the composer and the transcript all stay whole. */
export const CENTER = { min: 360 };

/** Pure: the widest the LEFT seam may go — its own max, or wherever the center hits its
 *  floor, whichever comes first. Never returns less than the nav's own min (a window too
 *  small to honour everything still leaves the nav usable). */
export function clampNav(x: number, viewport: number, rightWidth: number): number {
  const ceiling = Math.max(NAV.min, Math.min(NAV.max, viewport - rightWidth - CENTER.min));
  return Math.min(Math.max(x, NAV.min), ceiling);
}

/** Pure: cap the dock's dragged width against the center's floor. Only the UPPER bound —
 *  narrow values pass through untouched so the collapse hysteresis still fires. */
export function clampWork(width: number, viewport: number, navWidth: number): number {
  return Math.min(width, Math.max(WORK.min, viewport - navWidth - CENTER.min));
}

/** The three-column workbench frame. */
export function Workbench(): React.JSX.Element {
  const workOpen = useShell((s) => s.workOpen);
  const mode = useShell((s) => s.mode);
  const closeSearch = useShell((s) => s.closeSearch);
  const shortcutsOpen = useShell((s) => s.shortcutsOpen);
  const setShortcutsOpen = useShell((s) => s.setShortcutsOpen);
  const keybinds = useKeybinds();
  const editing = useKeybindEditing();
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
          const st = useShell.getState();
          const right = st.workOpen ? st.workWidth : 0;
          st.setNavWidth(clampNav(x, window.innerWidth, right));
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
            const target = clampWork(window.innerWidth - x, window.innerWidth, st.navWidth);
            const r = resolveCollapse(target, WORK, st.workOpen);
            if (r.open !== st.workOpen) st.setWorkOpen(r.open);
            if (r.width !== null) st.setWorkWidth(r.width);
          }}
          onReset={() => useShell.getState().setWorkWidth(WORK.base)}
        />
      )}
      {workOpen ? <Work /> : !rightDragging && <ReopenWork />}
      <Palette />
      <NewSessionDialog />
      <SettingsDialog />
      {/* The driven login/relogin flow — mounted at the frame so a re-login triggered from
          the always-visible account HUD renders whatever surface is up. */}
      <LoginDialog />
      {shortcutsOpen && (
        <ShortcutsOverlay
          keybinds={keybinds}
          editing={editing}
          onClose={() => setShortcutsOpen(false)}
        />
      )}
    </div>
  );
}

/** The editor's seam into the app: the kit captures chords, this decides what they mean
 *  and persists them. Overrides ride the existing settings path (main writes settings.json),
 *  so a rebinding survives a restart with no new storage. */
function useKeybindEditing(): KeybindEditing {
  const overrides = useConsoleUi((s) => s.settings.keybinds);
  const keybinds = useKeybinds();
  const save = (next: Record<string, string[]>): void =>
    consoleActions.setSettings({ keybinds: next });

  return {
    chordFromEvent,
    isBindable,
    conflictLabel: (id, keys) => conflictFor(keybinds, keys, id)?.label,
    onRebind: (id, keys) => save(rebind(keybinds, overrides, id, keys)),
    onReset: (id) => {
      const next = { ...overrides };
      delete next[id];
      save(next);
    },
    onResetAll: () => save({}),
    isCustom: (id) => overrides[id] !== undefined,
  };
}
