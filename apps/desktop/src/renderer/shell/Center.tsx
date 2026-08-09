import { Icon, MenuItem, PopoverCard, StatusDot, Tooltip, cx } from '@coa/console-kit';
import type { AgentColor, AgentIcon, AgentSummary } from '@coa/console-viewmodel';
import { AnimatePresence, motion } from 'motion/react';
import { startTransition, useEffect, useRef, useState } from 'react';
import { AgentsStrip, AgentsSurface } from '../panels/AgentsPanel.js';
import { AuthStrip, AuthSurface } from '../panels/AuthPanel.js';
import { ChatSurface } from '../panels/ChatPanel.js';
import { FlagsSurface } from '../panels/FlagsPanel.js';
import { ShowcaseSurface } from '../panels/ShowcasePanel.js';
import { TimelineSurface } from '../panels/TimelinePanel.js';
import { UsageStrip, UsageSurface } from '../panels/UsagePanel.js';
import type { ConsoleState } from '../panels/state.js';
import { DRAG, NO_DRAG } from './appRegion.js';
import { Browser } from './Browser.js';
import { useConsoleState } from './consoleStore.js';
import { DeferredCanvas, Freeze } from './deferredMount.js';
import { bindFor, closeOtherTabs, closeTab, closeTabsRight, reopenLastTab } from './keys.js';
import { SURFACES } from './Nav.js';
import { useShell } from './store.js';
import { AppWindowControls } from './windowControls.js';

/** What a rail row needs to draw itself. It lived in the retired kit's `AgentRail`, but
 *  the rail itself is gone and this app is the only thing that builds these — so the
 *  shape belongs beside its one producer rather than in a package nothing else reads. */
export interface AgentRailItem {
  id: string;
  name: string;
  icon: AgentIcon;
  color: AgentColor;
  pinned?: boolean | undefined;
}

/** Pure: rail items — pinned agents first (in list order), then the rest.
 *  Moved here from ChatPanel (the rail itself is retired — the tab strip's
 *  new-session menu owns agent selection now); kept intact + exported for a
 *  later pinned-first ordering pass over that menu. */
export function buildRailItems(agents: AgentSummary[], pinned: string[]): AgentRailItem[] {
  const item = (a: AgentSummary): AgentRailItem => ({
    id: a.ref,
    name: a.name,
    icon: a.icon,
    color: a.color,
    pinned: pinned.includes(a.ref),
  });
  return [
    ...agents.filter((a) => pinned.includes(a.ref)).map(item),
    ...agents.filter((a) => !pinned.includes(a.ref)).map(item),
  ];
}

function EmptySurface({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2">
      <span className="text-body text-s8">{name} is not designed yet</span>
    </div>
  );
}

function SurfaceHost({
  surface,
  state,
}: {
  surface: string;
  state: ConsoleState;
}): React.JSX.Element {
  switch (surface) {
    case 'chat':
      return <ChatSurface state={state} />;
    case 'flags':
      return <FlagsSurface state={state} />;
    case 'timeline':
      return <TimelineSurface state={state} />;
    // Auth renders from the live daemon-fed store (authStore.ts); Usage is still
    // deliberately mock-fed (roadmap-tracked). Both own their data, so no ConsoleState.
    case 'auth':
      return <AuthSurface />;
    case 'usage':
      return <UsageSurface />;
    case 'agents':
      return <AgentsSurface state={state} />;
    case 'showcase':
      // Dev-gated here as well as in the nav registry: a persisted layout restores the
      // raw surface id, so a production build must fall to the floor even when an old
      // layout still carries `showcase`.
      return import.meta.env.DEV ? <ShowcaseSurface /> : <EmptySurface name={surface} />;
    default:
      return <EmptySurface name={surface} />;
  }
}

/** The canvas region: every VISITED surface stays mounted — switching nav rows
 *  (or leaving/entering search) is a display swap, never a rebuild. A surface's
 *  first visit mounts through a transition (DeferredCanvas) so the nav flip
 *  paints before the panel's rows do. `chatHidden` hides (never unmounts) the
 *  chat canvas while the session browser overlays it in search mode. */
function SurfaceCanvas({
  surface,
  state,
  chatHidden,
}: {
  surface: string;
  state: ConsoleState;
  chatHidden: boolean;
}): React.JSX.Element {
  const [visited, setVisited] = useState<string[]>([]);
  useEffect(() => {
    setVisited((v) => (v.includes(surface) ? v : [...v, surface]));
  }, [surface]);
  const mounted = visited.includes(surface) ? visited : [...visited, surface];
  return (
    <>
      {mounted.map((id) => {
        const shown = id === surface && !(id === 'chat' && chatHidden);
        return (
          <div
            key={id}
            data-canvas={id}
            className={shown ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          >
            {/* Frozen while hidden: live publishes must not re-render every
                visited surface (that cost is the switching slowdown). The chat
                canvas stays THAWED during search so the transcript keeps
                streaming under the browser overlay. */}
            <Freeze frozen={id !== surface}>
              <DeferredCanvas id={id}>
                <SurfaceHost surface={id} state={state} />
              </DeferredCanvas>
            </Freeze>
          </div>
        );
      })}
    </>
  );
}

/** Center column: the title-bar segment (session tabs, morphing into search) +
 *  the surface canvas. Non-chat surfaces bring their own name strip — the
 *  session tabs are chat's. */
export function Center(): React.JSX.Element {
  const surface = useShell((s) => s.surface);
  const mode = useShell((s) => s.mode);
  const workOpen = useShell((s) => s.workOpen);
  const state = useConsoleState((s) => s);
  const searching = surface === 'chat' && mode === 'search';

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-s1">
      {/* the whole strip drags; interactive children opt out (appRegion policy) —
          this is what keeps the top edge grabbable in search mode too */}
      {surface === 'chat' ? (
        <div
          className={cx(
            // z + the drop shadow lift the strip over the canvas: the transcript scrolls
            // UNDER a surface, not up to a line. The hairline stays as the crisp edge —
            // the shadow alone reads as fog (the toolbar-elevation pattern).
            'relative z-(--z-seam) flex h-(--titlebar-h) flex-none items-stretch bg-s1',
            mode === 'work' && 'border-b border-s3 shadow-[0_6px_10px_-6px_rgba(0,0,0,0.55)]',
          )}
          style={DRAG}
        >
          <div className="relative min-w-0 flex-1">
            {/* both states overlap and cross-fade in the same 180ms window, so the
                search bar finishes exactly when the browser canvas does */}
            <AnimatePresence initial={false}>
              {mode === 'work' ? (
                <motion.div
                  key="tabs"
                  className="absolute inset-0 flex items-stretch"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.19, 1, 0.22, 1] }}
                >
                  <TabStrip state={state} />
                </motion.div>
              ) : (
                <motion.div
                  key="search"
                  className="absolute inset-0 flex items-stretch"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.19, 1, 0.22, 1] }}
                >
                  <SearchBar />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {!workOpen && <AppWindowControls />}
        </div>
      ) : (
        // The title bar is part of the SURFACE, not a label above it: a surface may furnish
        // its own strip (auth's add-control, usage's total + range) exactly as chat furnishes
        // its tabs. Surfaces that don't just wear their name.
        <div
          className="flex h-(--titlebar-h) flex-none items-stretch border-b border-s3 bg-s1"
          style={DRAG}
        >
          {surface === 'auth' ? (
            <AuthStrip />
          ) : surface === 'usage' ? (
            <UsageStrip />
          ) : surface === 'agents' ? (
            <AgentsStrip />
          ) : (
            <>
              {/* The nav's label, not the raw id: this strip sits in the same slot as
                  Auth's and Usage's, so it has to be cased like a name, not a key. */}
              <span className="self-center px-4 font-mono text-meta tracking-[0.06em] text-s9">
                {SURFACES.find((s) => s.id === surface)?.label ?? surface}
              </span>
              <div className="flex-1" />
            </>
          )}
          {!workOpen && <AppWindowControls />}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {state === undefined ? null : (
          <>
            <SurfaceCanvas surface={surface} state={state} chatHidden={searching} />
            {searching && (
              <div className="flex min-h-0 flex-1 flex-col">
                <Browser state={state} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TabStrip({ state }: { state: ConsoleState | undefined }): React.JSX.Element {
  const tabs = useShell((s) => s.tabs);
  const openSearch = useShell((s) => s.openSearch);
  const setNewSessionOpen = useShell((s) => s.setNewSessionOpen);
  const reorderTabs = useShell((s) => s.reorderTabs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessions = state?.data.sessions.status === 'ok' ? state.data.sessions.value : [];
  const activeId = state?.ui.activeSessionId;
  const rawMode = state?.ui.rawMode === true;
  // Optimistic selection: opening a session re-renders the whole canvas (transcript
  // swap, scroll restore), and until that commit lands the strip still paints the OLD
  // tab as selected. `pending` moves the marker on the click itself and the open runs
  // as a transition, so the strip answers first and the content follows.
  const [pending, setPending] = useState<string>();
  const selected = pending ?? activeId;
  useEffect(() => setPending(undefined), [activeId]);

  // The selected tab must be VISIBLE, whoever moved the selection — a keyboard cycle, the
  // browser, the palette. Centre it where the strip has room to; at either end the scroller
  // simply stops, which is what `inline: 'center'` does on its own. `block: 'nearest'`
  // keeps this from scrolling anything but the strip.
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selected, tabs.length]);

  const select = (id: string): void => {
    setPending(id);
    startTransition(() => state?.actions.selectSession(id));
  };
  /** Middle-click closes a tab — the same command ctrl+w runs (working-set removal only:
   *  the session survives, and ctrl+shift+t brings the tab back). */
  const close = closeTab;

  // The tab context menu: which tab it's about, anchored under the cursor. One menu
  // for the whole strip — it rides the kit's Escape layer and one-open-menu registry.
  const [ctxTab, setCtxTab] = useState<{ id: string; at: { x: number; y: number } }>();
  const closedTabs = useShell((s) => s.closedTabs);

  /* ---------------- drag-to-reorder (HTML5 DnD) ---------------- */

  // The insertion slot (post-drag removal) in [0, tabs.length - 1]. Rendered as a
  // 2px accent bar inline BEFORE the tab that marks that slot — so the bar travels
  // with the horizontal scroll naturally. The dragged tab fades to ~40% so the
  // indicator reads as the landing slot, not as the thing being held.

  type Drag = { fromId: string; slot: number };
  const [dragging, setDragging] = useState<Drag | null>(null);
  const di = dragging ? tabs.indexOf(dragging.fromId) : -1;

  // For a slot f in [0, n-1], which visualIndex paints the indicator bar at its LEADING
  // edge? For f = n-1 (the after-last position) use the Trailing edge of the post-removal
  // last tab instead — the rendering context handles which edge.
  const slotEdge = (slot: number): { visual: number; edge: 'leading' | 'trailing' } => {
    if (tabs.length <= 1) return { visual: 0, edge: 'leading' };
    if (slot < tabs.length - 1) return { visual: slot < di ? slot : slot + 1, edge: 'leading' };
    // after-last slot = trailing edge of the last tab after the dragged one is removed
    return { visual: di === tabs.length - 1 ? tabs.length - 2 : tabs.length - 1, edge: 'trailing' };
  };

  const onTabDragStart =
    (id: string): React.DragEventHandler =>
    (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      // Initial slot = the dragged tab's own position. After the dragged tab is removed
      // from the filtered array, the position it occupied is the slot at its visual index
      // minus 0 (since it is at/after itself). tabs.indexOf(id) at this moment = visualIdx.
      setDragging({ fromId: id, slot: tabs.indexOf(id) });
    };

  const onTabDragOver =
    (visualIndex: number): React.DragEventHandler =>
    (e) => {
      if (dragging === null || di === visualIndex) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const fromLeft = e.clientX - rect.left < rect.width / 2;
      const leading = visualIndex <= di ? visualIndex : visualIndex - 1;
      const slot = fromLeft ? leading : leading + 1;
      const clamped = Math.max(0, Math.min(slot, tabs.length - 1));
      setDragging((d) => (d === null || d.slot === clamped ? d : { ...d, slot: clamped }));
    };

  const onDragOver = (e: React.DragEvent): void => {
    if (dragging) e.preventDefault();
  };

  const onDrop = (e: React.DragEvent): void => {
    if (dragging === null) return;
    e.preventDefault();
    reorderTabs(dragging.fromId, dragging.slot);
    setDragging(null);
  };

  const onDragEnd = (): void => setDragging(null);
  const dragBar = dragging ? slotEdge(dragging.slot) : null;

  return (
    <>
      <div
        ref={scrollRef}
        className="tabscroll min-w-0"
        style={NO_DRAG}
        onWheel={(e) => {
          const el = scrollRef.current;
          if (el && e.deltaY !== 0) el.scrollLeft += e.deltaY;
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
      >
        <div className="flex h-[calc(var(--titlebar-h)-4px)] items-stretch">
          {tabs.map((tid, visualIndex) => {
            const t = sessions.find((s) => s.id === tid);
            if (!t) return undefined;
            const isDragged = di === visualIndex;
            const on = tid === selected;
            const running = state?.ui.runStatus[tid] !== undefined;
            const showBar = dragBar !== null && !isDragged && dragBar.visual === visualIndex;
            return (
              // The tooltip carries the FULL session title — the w-30 tabs truncate.
              <Tooltip key={tid} label={t.title} side="bottom">
                <button
                  ref={on ? activeRef : undefined}
                  type="button"
                  draggable
                  onDragStart={onTabDragStart(tid)}
                  onDragOver={onTabDragOver(visualIndex)}
                  onDragEnd={onDragEnd}
                  onClick={() => select(tid)}
                  // Right-click claims the event (the registry's dismiss contract) and
                  // opens the tab menu under the cursor.
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtxTab({ id: tid, at: { x: e.clientX, y: e.clientY } });
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      close(tid);
                    }
                  }}
                  className={cx(
                    'relative flex w-30 flex-none cursor-pointer items-center gap-1.5 px-3 text-sec whitespace-nowrap',
                    on ? 'text-s12 shadow-[0_1px_0_var(--color-s1)]' : 'text-s9 hover:text-s11',
                    isDragged && dragging ? 'opacity-40' : null,
                  )}
                >
                  {/* The drop indicator — a 2px accent bar positioned at the leading or
                    trailing edge of the tab whose slot the dragged tab will land in. */}
                  {showBar && (
                    <span
                      aria-hidden
                      className={cx(
                        // z-seam (not the default stacking order) so the bar paints over
                        // the trailing-edge divider hairline instead of under it.
                        'absolute top-1 z-(--z-seam) h-full w-0.5 rounded-[1px] bg-s9',
                        dragBar?.edge === 'trailing' ? 'right-0' : 'left-0',
                      )}
                    />
                  )}
                  <StatusDot status={running ? 'running' : 'idle'} />
                  <span className="min-w-0 flex-1 truncate text-left">{t.title}</span>
                  {on && <span className="absolute right-3 bottom-0 left-3 h-0.5 bg-s9" />}
                  <span
                    data-divider
                    className="pointer-events-none absolute top-1/2 right-0 h-3.5 w-px -translate-y-1/2 bg-s4"
                  />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
      {/* The tab menu — one instance for the whole strip, anchored under the cursor.
          The wrapping span claims right-clicks that bubble back through the PORTALED
          popup (menus don't get menus); working-set commands only, so every item is
          recoverable (the session always survives). */}
      <span onContextMenu={(e) => e.preventDefault()} style={NO_DRAG}>
        <PopoverCard
          open={ctxTab !== undefined}
          onOpenChange={(next) => {
            if (!next) setCtxTab(undefined);
          }}
          side="bottom"
          align="start"
          anchorPoint={ctxTab?.at}
          className="w-48"
          trigger={<span aria-hidden className="absolute" />}
        >
          {ctxTab !== undefined && (
            <div onClick={() => setCtxTab(undefined)}>
              <MenuItem onClick={() => close(ctxTab.id)}>
                Close
                <MenuChord keys={bindFor('close-tab')} />
              </MenuItem>
              <MenuItem disabled={tabs.length <= 1} onClick={() => closeOtherTabs(ctxTab.id)}>
                Close Others
              </MenuItem>
              <MenuItem
                disabled={tabs.at(-1) === ctxTab.id}
                onClick={() => closeTabsRight(ctxTab.id)}
              >
                Close to the Right
              </MenuItem>
              <div className="my-1 h-px bg-s5" />
              <MenuItem disabled={closedTabs.length === 0} onClick={reopenLastTab}>
                Reopen Closed Tab
                <MenuChord keys={bindFor('reopen-tab')} />
              </MenuItem>
            </div>
          )}
        </PopoverCard>
      </span>
      {/* hugs the last tab, but sits outside the scroll region so overflow never sweeps it
          away. It opens the SAME picker ctrl+t does — one way to start a session. */}
      <Tooltip label="New Session" keys={bindFor('new-session')}>
        <button
          type="button"
          aria-label="New Session"
          onClick={() => setNewSessionOpen(true)}
          className="slip flex flex-none cursor-pointer items-center px-3 font-mono text-icon text-s7 hover:text-s9"
          style={NO_DRAG}
        >
          +
        </button>
      </Tooltip>
      <div className="min-w-6 flex-1" />
      {/* Raw-mode indicator: appears only while raw mode is ON (toggled from the palette, or by
          the `toggle-raw` chord — alt+r by default) */}
      {rawMode && (
        <span className="self-center px-1 font-mono text-meta tracking-[0.06em] text-warn">
          Raw
        </span>
      )}
      <Tooltip label="Search Sessions" keys={bindFor('search-sessions')}>
        <button
          type="button"
          onClick={openSearch}
          aria-label="Search Sessions"
          className="slip flex cursor-pointer items-center px-3.5 font-mono text-icon text-s7 hover:text-s9"
          style={NO_DRAG}
        >
          ⌕
        </button>
      </Tooltip>
    </>
  );
}

/** A menu line's keybind, worn in the trailing-marker register (the EditMenu idiom). */
function MenuChord({ keys }: { keys: string[] | undefined }): React.JSX.Element | null {
  if (keys === undefined) return null;
  return (
    <span className="ml-auto pl-4 font-mono text-caps tracking-normal text-s6">
      {keys.join('+')}
    </span>
  );
}

function SearchBar(): React.JSX.Element {
  const query = useShell((s) => s.query);
  const setQuery = useShell((s) => s.setQuery);
  const closeSearch = useShell((s) => s.closeSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  return (
    // min-w-0: this row's content (the field at its full w-110 plus both gutters) is wider
    // than the strip on a narrow panel, and a flex item's automatic minimum size is its
    // content — so without this the ROW overflows the strip and everything inside it sizes
    // against a container that has already spilled past the column, over the dock.
    <div className="relative flex min-w-0 flex-1 items-start justify-center px-11">
      {/* a real input box: centered, dropped below the window edge, floating over the canvas.
          15px glyph: between type tokens — matches the input's optical center, one-off.
          The gutters ARE the cancel zone (px-11 ≈ the ✕ hitbox, mirrored so the box stays
          centered): the field caps at the padding box and shrinks from there, so it can
          never reach the ✕ however narrow the panel gets. */}
      <div
        className="z-(--z-seam) mt-6 flex w-110 min-w-0 max-w-full items-center gap-2.5 rounded-r3 border border-s5 bg-s3 px-3 py-1.5 shadow-float focus-within:border-s6"
        style={NO_DRAG}
      >
        <span className="text-[15px] text-s8">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions…"
          // min-w-0: an <input> is a flex child with an intrinsic min width (~20ch), so
          // without this it refuses to shrink and spills out of the box, over the ✕ —
          // the box's own cap can't save it.
          className="w-full min-w-0 flex-1 bg-transparent text-body text-s11 outline-none placeholder:text-s7"
        />
      </div>
      {/* cancel sits exactly where ⌕ lives in tab mode */}
      <Tooltip label="Cancel Search" keys={['esc']}>
        <button
          type="button"
          onClick={closeSearch}
          aria-label="Cancel Search"
          className="slip absolute top-0 right-0 flex h-(--titlebar-h) cursor-pointer items-center px-3.5 text-s7 hover:text-s10"
          style={NO_DRAG}
        >
          <Icon name="close" />
        </button>
      </Tooltip>
    </div>
  );
}
