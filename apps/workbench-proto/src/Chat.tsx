import { cx } from '@coa/console-kit';
import { useEffect, useRef } from 'react';
import { Composer } from './chat/Composer.js';
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

/** The conversation canvas: transcript + floating composer, with the
 *  expand-to-overlay host wrapped around both (a deep tool body expands over
 *  THIS region, never the window). A pending approval docks at the composer —
 *  it blocks the input, so it lives at the input. Raw mode swaps the whole
 *  transcript for the verbatim projection — the mask comes off, the chrome
 *  goes with it. */
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

  // Stick to bottom as frames arrive/grow (every streamed word patches the array).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [frames]);

  // Queued messages release FIFO when the turn ends.
  useEffect(() => {
    if (running) return;
    const st = useWorkbench.getState();
    if (st.queued.length === 0) return;
    const head = st.shiftQueued();
    if (head !== undefined) void runScriptedTurn(st.activeId, head.text);
  }, [running]);

  // Unclaimed Escape stops the running turn (a dismiss layer that claimed it
  // — an open menu, the overlay — wins first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const st = useWorkbench.getState();
      if (st.running) stopTurn(st.activeId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  return (
    <div className="relative min-h-0 flex-1">
      <TranscriptOverlayHost>
        {/* the transcript owns the full panel; it scrolls beneath the floating composer */}
        <div ref={scrollRef} className="h-full overflow-y-auto">
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
              callbacks={{
                // Design lab: the affordances are real, the reveal/browser IPC
                // is the desktop's. Intentional no-ops.
                onOpenPath: () => undefined,
                onOpenUrl: () => undefined,
              }}
            />
          )}
        </div>
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
          onSend={(text) => void runScriptedTurn(activeId, text)}
          onQueue={(text) => useWorkbench.getState().queueMessage(text)}
          onBarge={(text) => bargeTurn(activeId, text)}
          onStop={() => stopTurn(activeId)}
          onRemoveQueued={(id) => useWorkbench.getState().removeQueued(id)}
          onApprove={(id) => resolveScriptedApproval(activeId, id, 'approved')}
          onDeny={(id) => resolveScriptedApproval(activeId, id, 'denied')}
          onRedirect={(id, text) => redirectApproval(activeId, id, text)}
        />
      </TranscriptOverlayHost>
    </div>
  );
}
