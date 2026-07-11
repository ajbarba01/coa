import { cx } from '@coa/console-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Composer } from './chat/Composer.js';
import { FindBar } from './chat/FindBar.js';
import { frameFindText } from './chat/model.js';
import { rawProjection } from './chat/raw.js';
import { EmptyConversation, RawTranscript, Transcript } from './chat/Transcript.js';
import { TranscriptOverlayHost } from './chat/overlay.js';
import {
  bargeTurn,
  redirectApproval,
  resolveScriptedApproval,
  runScriptedTurn,
  stopTurn,
} from './mock.js';
import { useWorkbench } from './store.js';

/** How close to the bottom (px) still counts as "at the bottom". */
const PIN_THRESHOLD = 60;

/** The conversation canvas: transcript + floating composer, with the
 *  expand-to-overlay host wrapped around both. A pending approval docks at
 *  the composer — it blocks the input, so it lives at the input.
 *
 *  Scroll contract (industry standard): the view follows new output ONLY
 *  while you are at the bottom. Scrolling up unpins — the transcript is
 *  yours to read while the turn keeps generating — and a `↓ latest` pill
 *  offers the way back (sending also re-pins). ⌘F opens find. Raw mode
 *  swaps the whole transcript for the verbatim projection. */
export function Chat(): React.JSX.Element {
  const activeId = useWorkbench((s) => s.activeId);
  const session = useWorkbench((s) => s.sessions[s.activeId]);
  const frames = session?.frames;
  const running = useWorkbench((s) => s.running);
  const runningSince = useWorkbench((s) => s.runningSince);
  const raw = useWorkbench((s) => s.raw);
  const wide = useWorkbench((s) => s.chatWide);
  const toggleWide = useWorkbench((s) => s.toggleChatWide);
  const queued = useWorkbench((s) => s.queued);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* ---------------- stick-to-bottom ---------------- */

  // Pinned = the reader is at the bottom and the view follows new output.
  // A ref carries the live value (the growth effect must not re-run on pin
  // changes); the state drives the pill.
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  const scrollToBottom = (smooth = false): void => {
    const el = scrollRef.current;
    if (el === null) return;
    pinnedRef.current = true;
    setPinned(true);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Content growth only follows the bottom while pinned — scrolling up means
  // the transcript is yours to read, even mid-generation.
  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [frames]);

  // Session switch always lands at the latest.
  useEffect(() => {
    scrollToBottom();
  }, [activeId]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
    pinnedRef.current = near;
    setPinned(near);
  };

  /* ---------------- find in conversation ---------------- */

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [findAt, setFindAt] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '' || frames === undefined) return [];
    return frames.filter((f) => frameFindText(f).toLowerCase().includes(q)).map((f) => f.id);
  }, [frames, query]);

  // Never point past the current match set.
  const at = matches.length === 0 ? 0 : Math.min(findAt, matches.length - 1);
  const activeFindId = findOpen ? matches[at] : undefined;

  const jumpToMatch = (index: number): void => {
    setFindAt(index);
    const id = matches[index];
    if (id === undefined) return;
    // Navigating a match takes over the scroll — unpin so growth doesn't yank.
    pinnedRef.current = false;
    setPinned(false);
    scrollRef.current
      ?.querySelector(`[data-frame-id="${id}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const findNext = (): void => {
    if (matches.length > 0) jumpToMatch((at + 1) % matches.length);
  };
  const findPrev = (): void => {
    if (matches.length > 0) jumpToMatch((at - 1 + matches.length) % matches.length);
  };

  // ⌘F opens find (the window has no browser chrome to provide it); Esc
  // closes it first, then an unclaimed Esc stops the running turn.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (useWorkbench.getState().running) stopTurn(useWorkbench.getState().activeId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------------- frame plumbing ---------------- */

  // Queued messages release FIFO when the turn ends.
  useEffect(() => {
    if (running) return;
    const st = useWorkbench.getState();
    if (st.queued.length === 0) return;
    const head = st.shiftQueued();
    if (head !== undefined) void runScriptedTurn(st.activeId, head.text);
  }, [running]);

  const empty = (frames?.length ?? 0) === 0 && !running;

  // The gate waiting on you, if any — docked at the composer, not in history.
  const pending = frames?.find((f) => f.kind === 'approval' && f.resolved === undefined);
  const approval =
    pending !== undefined && pending.kind === 'approval'
      ? {
          id: pending.id,
          tool: pending.tool,
          summary: pending.summary,
          diffStat: pending.diffStat,
        }
      : undefined;

  const sendAndPin = (fn: () => void): void => {
    fn();
    scrollToBottom();
  };

  return (
    <div className="relative min-h-0 flex-1">
      <TranscriptOverlayHost>
        {/* the transcript owns the full panel; it scrolls beneath the floating composer */}
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
          {empty ? (
            <EmptyConversation
              agent={session?.agent ?? 'builder'}
              model="fable-5"
              effort="high"
              permission="ask edits"
            />
          ) : raw ? (
            <RawTranscript lines={rawProjection(frames ?? [])} wide={wide} />
          ) : (
            <Transcript
              frames={frames ?? []}
              running={running}
              runningSince={runningSince}
              wide={wide}
              activeFindId={activeFindId}
              callbacks={{
                // Design lab: the affordances are real, the reveal/browser IPC
                // is the desktop's. Intentional no-ops.
                onOpenPath: () => undefined,
                onOpenUrl: () => undefined,
              }}
            />
          )}
        </div>
        {/* find bar — floats at the transcript's top-right, left of the width toggle */}
        {findOpen && (
          <div className="absolute top-2 right-12 z-20">
            <FindBar
              query={query}
              onQueryChange={(q) => {
                setQuery(q);
                setFindAt(0);
              }}
              current={matches.length === 0 ? 0 : at + 1}
              total={matches.length}
              onPrev={findPrev}
              onNext={findNext}
              onClose={() => setFindOpen(false)}
            />
          </div>
        )}
        {/* width toggle: composer measure ⇄ the whole panel */}
        {!empty && (
          <button
            type="button"
            onClick={toggleWide}
            title={wide ? 'narrow to reading measure' : 'use the whole panel'}
            aria-label={wide ? 'narrow transcript' : 'widen transcript'}
            className={cx(
              'slip absolute top-2 right-3.5 z-10 flex h-6 w-6 cursor-pointer items-center justify-center',
              'rounded-r1 font-mono text-[12px] text-s6 hover:bg-s3 hover:text-s9',
            )}
          >
            {wide ? '⇥⇤' : '⇤⇥'}
          </button>
        )}
        <Composer
          running={running}
          disabled={session === undefined}
          queued={queued}
          approval={approval}
          above={
            !pinned &&
            !empty && (
              <div className="mb-1.5 flex justify-center">
                <button
                  type="button"
                  onClick={() => scrollToBottom(true)}
                  className="slip slip-enter cursor-pointer rounded-r2 border border-s5 bg-s3 px-2.5 py-1 font-mono text-meta text-s9 shadow-[var(--shadow-composer)] hover:text-s11"
                >
                  ↓ latest
                </button>
              </div>
            )
          }
          onSend={(text) => sendAndPin(() => void runScriptedTurn(activeId, text))}
          onQueue={(text) => useWorkbench.getState().queueMessage(text)}
          onBarge={(text) => sendAndPin(() => bargeTurn(activeId, text))}
          onStop={() => stopTurn(activeId)}
          onRemoveQueued={(id) => useWorkbench.getState().removeQueued(id)}
          onApprove={(id) => sendAndPin(() => resolveScriptedApproval(activeId, id, 'approved'))}
          onDeny={(id) => resolveScriptedApproval(activeId, id, 'denied')}
          onRedirect={(id, text) => sendAndPin(() => redirectApproval(activeId, id, text))}
        />
      </TranscriptOverlayHost>
    </div>
  );
}
