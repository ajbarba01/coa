import { CapsLabel, cx, StatusDot, Tooltip } from '@coa/console-kit';
import { DRAG } from './appRegion.js';
import { useConsoleState } from './consoleStore.js';
import { bindFor } from './keys.js';
import { useShell } from './store.js';
import { AppWindowControls } from './windowControls.js';

/** Right column: the active session's working state, honestly floored — the
 *  root agent row (real title + real run status) and, when the session has
 *  emitted one, its plan checklist are real; subagents/changes/worktree/
 *  record/cost have no backing data yet and render one quiet "not tracked
 *  yet" line each instead of fake chrome. Title-bar segment carries the
 *  AGENTS header + the window controls. */
export function Work(): React.JSX.Element {
  const workWidth = useShell((s) => s.workWidth);
  const toggleWork = useShell((s) => s.toggleWork);
  // In search mode the column previews whichever session the browser hovers.
  const previewId = useShell((s) => s.previewId);
  const state = useConsoleState((s) => s);
  const activeId = previewId ?? state?.ui.activeSessionId;
  const sessions = state?.data.sessions.status === 'ok' ? state.data.sessions.value : [];
  const session = sessions.find((s) => s.id === activeId);
  const running = activeId !== undefined && state?.ui.runStatus[activeId] !== undefined;
  const turns = state?.data.turns.status === 'ok' ? state.data.turns.value : [];
  // The session's LAST plan frame (the agent replaces the whole checklist as it works).
  const planItems = (() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const f = turns[i];
      if (f !== undefined && f.kind === 'plan') return f.items;
    }
    return undefined;
  })();

  return (
    <div className="flex flex-none flex-col border-l border-s4 bg-s2" style={{ width: workWidth }}>
      {/* the whole strip drags; interactive children opt out (appRegion policy) */}
      <div className="flex h-(--titlebar-h) flex-none items-stretch" style={DRAG}>
        <CapsLabel className="self-center px-3.5 pt-0 pb-0">agents</CapsLabel>
        <div className="flex-1" />
        <AppWindowControls />
      </div>

      {session ? (
        <div className="flex-1 overflow-y-auto pb-1">
          <div className="flex items-center gap-2 px-3.5 py-1 text-sec font-[550] text-s12">
            <StatusDot status={running ? 'running' : 'idle'} />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{session.title}</span>
            <span className="ml-auto font-mono text-caps text-s6">root</span>
          </div>

          {planItems !== undefined ? (
            <Section
              title="plan"
              meta={`${planItems.filter((i) => i.status === 'done').length}/${planItems.length}`}
            >
              {planItems.map((it, i) => (
                <div key={i} className="flex items-baseline gap-2 px-3.5 py-0.75">
                  <span
                    aria-hidden
                    className={cx(
                      'w-3 flex-none text-center font-mono text-meta',
                      it.status === 'in-progress' ? 'font-[550] text-run' : 'text-s6',
                    )}
                  >
                    {it.status === 'done' ? '✓' : it.status === 'in-progress' ? '›' : '○'}
                  </span>
                  <span
                    className={cx(
                      'min-w-0 truncate text-sec',
                      it.status === 'done' && 'text-s7',
                      it.status === 'in-progress' && 'text-s11',
                      it.status === 'pending' && 'text-s9',
                    )}
                  >
                    {it.text}
                  </span>
                </div>
              ))}
            </Section>
          ) : (
            // Plan IS supported (unlike the floors below) — it is just empty for this
            // session/backend, so its empty line reads "no plan yet", not "not tracked yet".
            <Section title="plan">
              <div className="px-3.5 py-1 text-meta text-s6">no plan yet</div>
            </Section>
          )}

          <FloorSection title="subagents" />
          <FloorSection title="changes" />
          <FloorSection title="worktree" />
          <FloorSection title="record" />
          <FloorSection title="cost" />
        </div>
      ) : (
        <div className="px-3.5 pt-4 text-code text-s7">no session</div>
      )}

      <div className="mt-auto flex items-center border-t border-s3 px-3.5 py-2">
        <Tooltip label="hide session panel" keys={bindFor('toggle-dock')} side="top">
          <button
            type="button"
            aria-label="hide session panel"
            onClick={toggleWork}
            className="slip ml-auto cursor-pointer font-mono text-body text-s7 hover:text-s9"
          >
            »
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

/** The reopen affordance floats in the window's bottom-right corner — exactly
 *  where » folded the column away, so the toggle round-trips in place. */
export function ReopenWork(): React.JSX.Element {
  const toggleWork = useShell((s) => s.toggleWork);
  return (
    <Tooltip label="show session panel" keys={bindFor('toggle-dock')} side="top">
      <button
        type="button"
        aria-label="show session panel"
        onClick={toggleWork}
        className="slip fixed right-1.5 bottom-1.5 z-(--z-seam) flex h-8 w-8 cursor-pointer items-center justify-center font-mono text-body text-s7 hover:text-s9"
      >
        «
      </button>
    </Tooltip>
  );
}

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mt-2 border-t border-s3 pt-2 pb-1">
      <div className="flex items-center gap-2 px-3.5 pb-1">
        <CapsLabel className="px-0 py-0">{title}</CapsLabel>
        {meta !== undefined && <span className="font-mono text-caps text-s6">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

/** A section whose data source is deferred: the header + one honest muted line.
 *  Becomes a real Section as its backing work lands (diff engine, worktree
 *  manager, subagents, per-session cost). */
function FloorSection({ title }: { title: string }): React.JSX.Element {
  return (
    <Section title={title}>
      <div className="px-3.5 py-1 text-meta text-s6">not tracked yet</div>
    </Section>
  );
}
