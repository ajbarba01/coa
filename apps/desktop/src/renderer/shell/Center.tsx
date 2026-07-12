import { StatusDot, Tooltip, cx } from '@coa/console-kit';
import type { AgentRailItem } from '@coa/console-ui';
import type { AgentSummary } from '@coa/console-viewmodel';
import { AnimatePresence, motion } from 'motion/react';
import { startTransition, useEffect, useRef, useState } from 'react';
import { AccountSurface } from '../panels/AccountPanel.js';
import { AgentsSurface } from '../panels/AgentsPanel.js';
import { ChatSurface } from '../panels/ChatPanel.js';
import { CostSurface } from '../panels/CostPanel.js';
import { FlagsSurface } from '../panels/FlagsPanel.js';
import { ShowcaseSurface } from '../panels/ShowcasePanel.js';
import { TimelineSurface } from '../panels/TimelinePanel.js';
import type { ConsoleState } from '../panels/state.js';
import { DRAG, NO_DRAG } from './appRegion.js';
import { Browser } from './Browser.js';
import { useConsoleState } from './consoleStore.js';
import { DeferredCanvas, Freeze } from './deferredMount.js';
import { bindFor, closeTab } from './keys.js';
import { useShell } from './store.js';
import { AppWindowControls } from './windowControls.js';

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
      <span className="text-body text-s8">{name} isn&apos;t designed yet</span>
      <span className="font-mono text-meta text-s6">it arrives with the rebuild plan</span>
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
    case 'cost':
      return <CostSurface state={state} />;
    case 'agents':
      return <AgentsSurface state={state} />;
    case 'account':
      return <AccountSurface state={state} />;
    case 'showcase':
      return <ShowcaseSurface />;
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
        <div
          className="flex h-(--titlebar-h) flex-none items-stretch border-b border-s3 bg-s1"
          style={DRAG}
        >
          <span className="self-center px-4 font-mono text-meta tracking-[0.06em] text-s9">
            {surface}
          </span>
          <div className="flex-1" />
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

  return (
    <>
      {/* every open session rides the strip; overflow scrolls horizontally —
          wheel included — with the thin top-edge scrollbar */}
      <div
        ref={scrollRef}
        className="tabscroll min-w-0"
        style={NO_DRAG}
        onWheel={(e) => {
          const el = scrollRef.current;
          if (el && e.deltaY !== 0) el.scrollLeft += e.deltaY;
        }}
      >
        <div className="flex h-[calc(var(--titlebar-h)-4px)] items-stretch">
          {tabs.map((tid) => {
            const t = sessions.find((s) => s.id === tid);
            if (!t) return undefined;
            const on = tid === selected;
            const running = state?.ui.runStatus[tid] !== undefined;
            return (
              <button
                key={tid}
                ref={on ? activeRef : undefined}
                type="button"
                onClick={() => select(tid)}
                // Close on the middle PRESS, not on auxclick: the press is also what starts
                // Windows' autoscroll, and preventing the default here is the only way to
                // stop that — an auxclick handler fires too late and the gesture is eaten.
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    close(tid);
                  }
                }}
                className={cx(
                  // Constant tab width (VS Code register): every tab is EXACTLY the
                  // same size regardless of title — flex-none so the row can never
                  // compress one — and the strip reads as a steady row. Titles truncate.
                  // NO `slip` here: selection is a state, not a move. The underline flips
                  // on the click and the ink must land with it — a 140ms colour fade on
                  // the title reads as the old tab hanging on to the selection.
                  'relative flex w-30 flex-none cursor-pointer items-center gap-1.5 px-3 text-sec whitespace-nowrap',
                  // selection = ink + underline; the shadow covers the strip's hairline so
                  // the active tab stays continuous with the canvas below
                  on ? 'text-s12 shadow-[0_1px_0_var(--color-s1)]' : 'text-s9 hover:text-s11',
                )}
              >
                <StatusDot status={running ? 'running' : 'idle'} />
                <span className="min-w-0 flex-1 truncate text-left">{t.title}</span>
                {on && <span className="absolute right-3 bottom-0 left-3 h-0.5 bg-s9" />}
                {/* a hairline on every tab's trailing edge — including the selected one's,
                    so the row reads as a row of tabs and not a run-on strip; the last
                    one also parts the strip from the + */}
                <span
                  data-divider
                  className="pointer-events-none absolute top-1/2 right-0 h-3.5 w-px -translate-y-1/2 bg-s4"
                />
              </button>
            );
          })}
        </div>
      </div>
      {/* hugs the last tab, but sits outside the scroll region so overflow never sweeps it
          away. It opens the SAME picker ctrl+t does — one way to start a session. */}
      <Tooltip label="new session" keys={bindFor('new-session')}>
        <button
          type="button"
          aria-label="new session"
          onClick={() => setNewSessionOpen(true)}
          className="slip flex flex-none cursor-pointer items-center px-3 text-[20px] text-s7 hover:text-s9"
          style={NO_DRAG}
        >
          +
        </button>
      </Tooltip>
      <div className="min-w-6 flex-1" />
      {/* D85 indicator: appears only while raw mode is ON (toggled from the palette, or by
          the `toggle-raw` chord — alt+r by default) */}
      {rawMode && (
        <span className="self-center px-1 font-mono text-meta tracking-[0.06em] text-warn">
          raw
        </span>
      )}
      <Tooltip label="search sessions" keys={bindFor('search-sessions')}>
        <button
          type="button"
          onClick={openSearch}
          aria-label="search sessions"
          className="slip flex cursor-pointer items-center px-3.5 text-[20px] text-s7 hover:text-s9"
          style={NO_DRAG}
        >
          ⌕
        </button>
      </Tooltip>
    </>
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
          placeholder="search sessions…"
          // min-w-0: an <input> is a flex child with an intrinsic min width (~20ch), so
          // without this it refuses to shrink and spills out of the box, over the ✕ —
          // the box's own cap can't save it.
          className="w-full min-w-0 flex-1 bg-transparent text-body text-s11 outline-none placeholder:text-s7"
        />
      </div>
      {/* cancel sits exactly where ⌕ lives in tab mode */}
      <Tooltip label="cancel search" keys={['esc']}>
        <button
          type="button"
          onClick={closeSearch}
          aria-label="cancel search"
          className="slip absolute top-0 right-0 flex h-(--titlebar-h) cursor-pointer items-center px-3.5 text-[15px] text-s7 hover:text-s10"
          style={NO_DRAG}
        >
          ✕
        </button>
      </Tooltip>
    </div>
  );
}
