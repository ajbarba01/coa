import { CapsLabel, MenuItem, PopoverCard, StatusDot, cx } from '@coa/console-kit';
import type { AgentRailItem } from '@coa/console-ui';
import type { AgentSummary } from '@coa/console-viewmodel';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { AccountSurface } from '../panels/AccountPanel.js';
import { AgentsSurface } from '../panels/AgentsPanel.js';
import { ChatSurface } from '../panels/ChatPanel.js';
import { CostSurface } from '../panels/CostPanel.js';
import { FlagsSurface } from '../panels/FlagsPanel.js';
import { ShowcaseSurface } from '../panels/ShowcasePanel.js';
import { TimelineSurface } from '../panels/TimelinePanel.js';
import type { ConsoleState } from '../panels/state.js';
import { Browser } from './Browser.js';
import { useConsoleState } from './consoleStore.js';
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

/** Center column: the title-bar segment (session tabs, morphing into search) +
 *  the surface canvas. Non-chat surfaces bring their own name strip — the
 *  session tabs are chat's. */
export function Center(): React.JSX.Element {
  const surface = useShell((s) => s.surface);
  const mode = useShell((s) => s.mode);
  const workOpen = useShell((s) => s.workOpen);
  const state = useConsoleState((s) => s);

  if (surface !== 'chat') {
    return (
      <div className="flex min-w-0 flex-1 flex-col bg-s1">
        <div className="flex h-(--titlebar-h) flex-none items-stretch border-b border-s3 bg-s1">
          <span className="self-center px-4 font-mono text-meta tracking-[0.06em] text-s9">
            {surface}
          </span>
          <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
          {!workOpen && <AppWindowControls />}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {state === undefined ? null : <SurfaceHost surface={surface} state={state} />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-s1">
      <div
        className={cx(
          'flex h-(--titlebar-h) flex-none items-stretch bg-s1',
          mode === 'work' && 'border-b border-s3',
        )}
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

      <div className="flex min-h-0 flex-1 flex-col">
        {state === undefined ? null : mode === 'work' ? (
          <SurfaceHost surface="chat" state={state} />
        ) : (
          <Browser state={state} />
        )}
      </div>
    </div>
  );
}

function TabStrip({ state }: { state: ConsoleState | undefined }): React.JSX.Element {
  const tabs = useShell((s) => s.tabs);
  const closeTab = useShell((s) => s.closeTab);
  const openSearch = useShell((s) => s.openSearch);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessions = state?.data.sessions.status === 'ok' ? state.data.sessions.value : [];
  const agents = state?.data.agents.status === 'ok' ? state.data.agents.value : [];
  const activeId = state?.ui.activeSessionId;
  const rawMode = state?.ui.rawMode === true;
  const [newOpen, setNewOpen] = useState(false);

  const select = (id: string): void => {
    state?.actions.selectSession(id);
  };
  /** Middle-click closes a tab (working-set removal only — the session survives);
   *  closing the active one falls to the last remaining tab. */
  const close = (id: string): void => {
    closeTab(id);
    if (id === activeId) {
      const rest = tabs.filter((t) => t !== id);
      const next = rest.at(-1);
      if (next !== undefined) select(next);
    }
  };

  return (
    <>
      {/* every open session rides the strip; overflow scrolls horizontally —
          wheel included — with the thin top-edge scrollbar */}
      <div
        ref={scrollRef}
        className="tabscroll min-w-0"
        onWheel={(e) => {
          const el = scrollRef.current;
          if (el && e.deltaY !== 0) el.scrollLeft += e.deltaY;
        }}
      >
        <div className="flex h-[calc(var(--titlebar-h)-4px)] items-stretch">
          {tabs.map((tid) => {
            const t = sessions.find((s) => s.id === tid);
            if (!t) return undefined;
            const on = tid === activeId;
            const running = state?.ui.runStatus[tid] !== undefined;
            return (
              <button
                key={tid}
                type="button"
                onClick={() => select(tid)}
                onAuxClick={(e) => {
                  if (e.button === 1) close(tid);
                }}
                className={cx(
                  'slip relative flex max-w-52 cursor-pointer items-center gap-2 px-4 text-sec whitespace-nowrap',
                  // selection = ink + underline; the shadow covers the strip's hairline so
                  // the active tab stays continuous with the canvas below
                  on ? 'text-s12 shadow-[0_1px_0_var(--color-s1)]' : 'text-s9 hover:text-s11',
                )}
              >
                <StatusDot status={running ? 'running' : 'idle'} />
                <span className="truncate">{t.title}</span>
                {on && <span className="absolute right-3 bottom-0 left-3 h-0.5 bg-s9" />}
              </button>
            );
          })}
        </div>
      </div>
      {/* hugs the last tab, but sits outside the scroll region so overflow never sweeps it away */}
      <PopoverCard
        open={newOpen}
        onOpenChange={setNewOpen}
        side="bottom"
        align="start"
        className="w-52"
        trigger={
          <button
            type="button"
            aria-label="new session"
            className="slip flex flex-none cursor-pointer items-center px-3 text-icon text-s7 hover:text-s9"
          >
            +
          </button>
        }
      >
        <CapsLabel>new session</CapsLabel>
        {agents.map((a) => (
          <MenuItem
            key={a.ref}
            onClick={() => {
              state?.actions.newSession(a.ref);
              setNewOpen(false);
            }}
          >
            {a.name}
          </MenuItem>
        ))}
        {agents.length === 0 && (
          <div className="px-3 py-1.5 text-code text-s7">no agents yet — create one first</div>
        )}
      </PopoverCard>
      <div className="min-w-6 flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      {/* D85 indicator: appears only while raw mode is ON (toggled via ⌘K) */}
      {rawMode && (
        <span className="self-center px-1 font-mono text-meta tracking-[0.06em] text-warn">
          raw
        </span>
      )}
      <button
        type="button"
        onClick={openSearch}
        aria-label="search sessions"
        className="slip flex cursor-pointer items-center px-3.5 text-icon text-s7 hover:text-s9"
      >
        ⌕
      </button>
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
    <div className="relative flex flex-1 items-start justify-center px-3.5">
      {/* a real input box: centered, dropped below the window edge, floating over the canvas.
          15px glyph: between type tokens — matches the input's optical center, one-off. */}
      <div className="z-(--z-seam) mt-6 flex w-110 max-w-[70%] items-center gap-2.5 rounded-r3 border border-s5 bg-s3 px-3 py-1.5 shadow-float focus-within:border-s6">
        <span className="text-[15px] text-s8">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search sessions…"
          className="flex-1 bg-transparent text-body text-s11 outline-none placeholder:text-s7"
        />
      </div>
      {/* cancel sits exactly where ⌕ lives in tab mode */}
      <button
        type="button"
        onClick={closeSearch}
        aria-label="cancel search"
        className="slip absolute top-0 right-0 flex h-(--titlebar-h) cursor-pointer items-center px-3.5 text-[15px] text-s7 hover:text-s10"
      >
        ✕
      </button>
    </div>
  );
}
