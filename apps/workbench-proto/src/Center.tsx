import { StatusDot, cx } from '@coa/console-kit';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { Browser } from './Browser.js';
import { Chat } from './Chat.js';
import { Showcase } from './Showcase.js';
import { useWorkbench } from './store.js';
import { WindowControls } from './Work.js';

function EmptySurface({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2">
      <span className="text-[13px] text-s8">{name} isn&apos;t designed yet</span>
      <span className="font-mono text-[10.5px] text-s6">it arrives with the rebuild plan</span>
    </div>
  );
}

/** Center column: the title-bar tab segment (which morphs into search) + the canvas. */
export function Center(): React.JSX.Element {
  const mode = useWorkbench((s) => s.mode);
  const surface = useWorkbench((s) => s.surface);
  const workOpen = useWorkbench((s) => s.workOpen);

  // Non-chat surfaces bring their own header row — the session tabs are chat's.
  if (surface !== 'chat') {
    return (
      <div className="flex min-w-0 flex-1 flex-col bg-s1">
        <div className="flex h-[var(--titlebar-h)] flex-none items-stretch border-b border-s3 bg-s1">
          <span className="self-center px-4 font-mono text-[11px] tracking-[0.06em] text-s9">
            {surface}
          </span>
          <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
          {!workOpen && <WindowControls />}
        </div>
        {surface === 'showcase' ? <Showcase /> : <EmptySurface name={surface} />}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-s1">
      <div
        className={cx(
          'flex h-[var(--titlebar-h)] flex-none items-stretch bg-s1',
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
                <TabStrip />
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
        {!workOpen && <WindowControls />}
      </div>

      {mode === 'work' ? <Chat /> : <Browser />}
    </div>
  );
}

function TabStrip(): React.JSX.Element {
  const order = useWorkbench((s) => s.order);
  const sessions = useWorkbench((s) => s.sessions);
  const activeId = useWorkbench((s) => s.activeId);
  const select = useWorkbench((s) => s.select);
  const openSearch = useWorkbench((s) => s.openSearch);
  const raw = useWorkbench((s) => s.raw);
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {/* every session in the active group rides the strip; overflow scrolls
          horizontally — wheel included — with the thin top-edge scrollbar */}
      {/* the strip shrinks to its tabs and scrolls when they overflow */}
      <div
        ref={scrollRef}
        className="tabscroll min-w-0"
        onWheel={(e) => {
          const el = scrollRef.current;
          if (el && e.deltaY !== 0) el.scrollLeft += e.deltaY;
        }}
      >
        <div className="flex h-[calc(var(--titlebar-h)-4px)] items-stretch">
          {order.map((tid) => {
            const t = sessions[tid];
            if (!t) return undefined;
            const on = tid === activeId;
            return (
              <button
                key={tid}
                type="button"
                onClick={() => select(tid)}
                className={cx(
                  'slip relative flex cursor-pointer items-center gap-2 px-4 text-[12px] whitespace-nowrap',
                  // selection = ink + underline; the shadow covers the strip's hairline so
                  // the active tab stays continuous with the canvas below
                  on ? 'text-s12 shadow-[0_1px_0_var(--color-s1)]' : 'text-s9 hover:text-s11',
                )}
              >
                <StatusDot status={t.status} />
                {t.id}
                {on && <span className="absolute right-3 bottom-0 left-3 h-0.5 bg-s9" />}
              </button>
            );
          })}
        </div>
      </div>
      {/* hugs the last tab, but sits outside the scroll region so overflow never sweeps it away */}
      <button
        type="button"
        className="slip flex flex-none cursor-pointer items-center px-3 text-[17px] text-s7 hover:text-s9"
        aria-label="new session"
      >
        +
      </button>
      <div className="min-w-6 flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      {/* D85 indicator: appears only while raw mode is ON (toggled via ⌘K) */}
      {raw && (
        <span className="self-center px-1 font-mono text-[10.5px] tracking-[0.06em] text-warn">
          raw
        </span>
      )}
      <button
        type="button"
        onClick={openSearch}
        aria-label="search sessions"
        className="slip flex cursor-pointer items-center px-3.5 text-[17px] text-s7 hover:text-s9"
      >
        ⌕
      </button>
    </>
  );
}

function SearchBar(): React.JSX.Element {
  const query = useWorkbench((s) => s.query);
  const setQuery = useWorkbench((s) => s.setQuery);
  const closeSearch = useWorkbench((s) => s.closeSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="relative flex flex-1 items-start justify-center px-3.5">
      {/* a real input box: centered, dropped below the window edge, floating over the canvas */}
      <div className="z-10 mt-6 flex w-[440px] max-w-[70%] items-center gap-2.5 rounded-[7px] border border-s5 bg-s3 px-3 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.4)] focus-within:border-s6">
        <span className="text-[15px] text-s8">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search sessions…"
          className="flex-1 bg-transparent text-[13px] text-s11 outline-none placeholder:text-s7"
        />
      </div>
      {/* cancel sits exactly where ⌕ lives in tab mode */}
      <button
        type="button"
        onClick={closeSearch}
        aria-label="cancel search"
        className="slip absolute top-0 right-0 flex h-[var(--titlebar-h)] cursor-pointer items-center px-3.5 text-[15px] text-s7 hover:text-s10"
      >
        ✕
      </button>
    </div>
  );
}
