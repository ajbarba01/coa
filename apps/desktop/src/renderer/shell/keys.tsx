import type { Keybind } from '@coa/console-kit';
import { hasOpenLayers } from '@coa/console-kit';
import { useEffect } from 'react';
import { useAgentsUi } from '../panels/agentsUi.js';
import { useConsoleState } from './consoleStore.js';
import {
  chordFromEvent,
  commandFor,
  DEFAULT_KEYBINDS,
  effectiveKeybinds,
  jumpTarget,
  scopeOf,
  type KeybindOverrides,
} from './keybinds.js';
import { useShell } from './store.js';

/** The registry AS BOUND — defaults with the user's rebindings laid over them. Dispatch,
 *  the shortcuts editor and every tooltip read this same list, so a bind can't exist
 *  without being discoverable, and a rebinding can't fail to reach one of them. */
export function useKeybinds(): Keybind[] {
  const overrides = useConsoleState((s) => s?.ui.settings.keybinds) as KeybindOverrides | undefined;
  return effectiveKeybinds(DEFAULT_KEYBINDS, overrides ?? {});
}

/** Non-reactive read of the same list (for dispatch, which runs off an event). */
function currentKeybinds(): Keybind[] {
  const overrides = useConsoleState.getState()?.ui.settings.keybinds ?? {};
  return effectiveKeybinds(DEFAULT_KEYBINDS, overrides);
}

/** Registry lookup for tooltips, BY COMMAND ID — a surfaced bind can never drift from
 *  dispatch, and renaming a label can never silently blank a tooltip. */
export function bindFor(id: string): string[] | undefined {
  const keys = currentKeybinds().find((k) => k.id === id)?.keys;
  return keys !== undefined && keys.length > 0 ? keys : undefined;
}

/** Close a tab and fall the selection to a neighbour — the working set loses it, the
 *  session survives (it's still in the browser, and ctrl+shift+t brings the tab back). */
export function closeTab(id: string): void {
  const shell = useShell.getState();
  const cs = useConsoleState.getState();
  const rest = shell.tabs.filter((t) => t !== id);
  shell.closeTab(id);
  if (id === cs?.ui.activeSessionId) {
    const next = rest.at(-1);
    if (next !== undefined) cs.actions.selectSession(next);
  }
}

/** Close every OTHER tab in the working set — the kept tab becomes the selection. */
export function closeOtherTabs(id: string): void {
  const shell = useShell.getState();
  for (const t of shell.tabs.filter((t) => t !== id)) shell.closeTab(t);
  const cs = useConsoleState.getState();
  if (cs !== undefined && cs.ui.activeSessionId !== id) cs.actions.selectSession(id);
}

/** Close every tab AFTER this one (strip order). The selection only moves if it was
 *  among the closed — then it lands on the tab that survived the cut. */
export function closeTabsRight(id: string): void {
  const shell = useShell.getState();
  const at = shell.tabs.indexOf(id);
  if (at === -1) return;
  const victims = shell.tabs.slice(at + 1);
  for (const t of victims) shell.closeTab(t);
  const cs = useConsoleState.getState();
  if (cs?.ui.activeSessionId !== undefined && victims.includes(cs.ui.activeSessionId))
    cs.actions.selectSession(id);
}

/** Reopen the most recently closed tab and make it active — ctrl+shift+t and the tab
 *  menu run this same command. */
export function reopenLastTab(): void {
  const id = useShell.getState().reopenTab();
  if (id !== undefined) useConsoleState.getState()?.actions.selectSession(id);
}

/** The command table: one entry per registry id. Dispatch is a lookup, never a branch on
 *  a key — that's what makes the binds rebindable rather than decorative. Exported so a
 *  test can assert every non-`fixed` bind in the registry is actually wired to something
 *  (here, or to a named matcher like `matchesFind`) — a bind that answers to nothing is
 *  the shortcuts overlay lying about what the keyboard does. */
export const COMMANDS: Record<string, () => void> = {
  palette: () => {
    const st = useShell.getState();
    st.setPaletteOpen(!st.paletteOpen);
  },
  'search-sessions': () => {
    const st = useShell.getState();
    // Swap over a dialog (the shortcut wins — openSearch closes them); with nothing on
    // top it's a plain toggle.
    const dialogOpen =
      st.settingsOpen || st.shortcutsOpen || st.paletteOpen || st.projectOpen || st.newSessionOpen;
    if (!dialogOpen && st.mode === 'search') st.closeSearch();
    else st.openSearch();
  },
  settings: () => {
    const st = useShell.getState();
    st.setSettingsOpen(!st.settingsOpen);
  },
  shortcuts: () => {
    const st = useShell.getState();
    st.setShortcutsOpen(!st.shortcutsOpen);
  },
  'toggle-dock': () => useShell.getState().toggleWork(),
  'new-session': () => useShell.getState().setNewSessionOpen(true),
  'reopen-tab': reopenLastTab,
  'close-tab': () => {
    const active = useConsoleState.getState()?.ui.activeSessionId;
    // No active tab is a no-op: ctrl+w never closes the window (that's the window's own
    // control), so a reflex press can't lose the app.
    if (active !== undefined && useShell.getState().tabs.includes(active)) closeTab(active);
  },
  'next-tab': () => cycleTab(1),
  'prev-tab': () => cycleTab(-1),
  // the mask comes off: the same toggle the title bar and the palette drive, so the
  // three can never disagree about what raw mode is.
  'toggle-raw': () => useConsoleState.getState()?.actions.toggleRaw(),
  'filter-agents': () => useAgentsUi.getState().focusFilter(),
};

/** The tabs the STRIP actually renders. The working set can hold an id the strip skips —
 *  a session the daemon no longer lists — and a cycle over those would stop on tabs that
 *  aren't there. What you can see is what the keyboard can reach. */
export function stripTabs(): string[] {
  const { tabs } = useShell.getState();
  const sessions = useConsoleState.getState()?.data.sessions;
  if (sessions?.status !== 'ok') return [];
  const known = new Set(sessions.value.map((s) => s.id));
  return tabs.filter((id) => known.has(id));
}

/** Move `step` tabs along the strip, wrapping — strip order, not most-recently-used, so
 *  the keyboard walks the tabs you can see. */
function cycleTab(step: number): void {
  const tabs = stripTabs();
  const cs = useConsoleState.getState();
  if (cs === undefined || tabs.length === 0) return;
  const at = tabs.indexOf(cs.ui.activeSessionId ?? '');
  const next = tabs[((((at === -1 ? 0 : at) + step) % tabs.length) + tabs.length) % tabs.length];
  if (next !== undefined) cs.actions.selectSession(next);
}

/** Is the user typing into something, or on a control that owns Enter for itself? Both are
 *  places the shell must not reach into — a field's keys are the field's. */
function isEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
}

/** Does this event carry the `find` command? Injected into the Transcript, which owns the
 *  find UI — so the rebindable chord reaches it without the kit learning about the registry. */
export function matchesFind(e: KeyboardEvent): boolean {
  const chord = chordFromEvent(e);
  if (chord === undefined) return false;
  const scope = scopeOf(useShell.getState());
  return commandFor(currentKeybinds(), chord, scope) === 'find';
}

/** Global dispatch. Escape stays with the dismiss-layer stack (and the composer's stop);
 *  everything else is a registry lookup. */
export function useGlobalKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Escape's authority is the dismiss stack; only when the stack is EMPTY does Escape
      // fall through to "stop the running turn" (a user stop, advisory,
      // fire-and-forget — the pill clears from the daemon's own status push). The
      // composer's focused-Esc stop still fires first for typing users; this covers Esc
      // from anywhere else in the frame. Bare Escape only: an IME-composition cancel, a
      // handler that already claimed the key, and modifier chords all pass through.
      if (e.key === 'Escape' && e.isComposing) return;
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !hasOpenLayers()
      ) {
        // The bottom of the Escape stack is the chat surface itself: with nothing left
        // to dismiss on another surface, Escape walks home before it means anything
        // else. On chat it keeps its last meaning — stop the running turn.
        const shell = useShell.getState();
        if (shell.surface !== 'chat') {
          shell.setSurface('chat');
          return;
        }
        const cs = useConsoleState.getState();
        const id = cs?.ui.activeSessionId;
        if (cs !== undefined && id !== undefined && cs.ui.runStatus[id] !== undefined) {
          cs.actions.interruptSession(id);
        }
        return;
      }

      const chord = chordFromEvent(e);
      if (chord === undefined || e.defaultPrevented) return;

      // The scope in force decides which chords are commands AT ALL here — that's what
      // stops ctrl+w on the agents surface reaching into chat and closing a session there.
      const shell = useShell.getState();
      const scope = scopeOf(shell);

      // Bare Enter in the conversation means "I want to say something": it takes the user
      // to the composer rather than doing nothing. Only when they aren't already typing
      // (or on a control, where Enter is that control's) — and it never types the key
      // itself, so nothing is inserted before the caret arrives.
      if (
        e.key === 'Enter' &&
        scope === 'chat' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isEditing(e.target)
      ) {
        e.preventDefault();
        shell.focusComposer();
        return;
      }

      // ctrl+1…9 is one command over nine keys, so it resolves by position rather than by
      // chord — the registry row that names it is fixed for exactly this reason. It is
      // chat-scoped like the rest of the tab family.
      const strip = scope === 'chat' ? stripTabs() : [];
      const at = scope === 'chat' ? jumpTarget(chord, strip.length) : undefined;
      if (at !== undefined) {
        e.preventDefault();
        const id = strip[at];
        if (id !== undefined) useConsoleState.getState()?.actions.selectSession(id);
        return;
      }

      const id = commandFor(currentKeybinds(), chord, scope);
      const run = id !== undefined ? COMMANDS[id] : undefined;
      if (run === undefined) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
