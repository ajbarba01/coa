import { StatusDot, cx } from '@coa/console-kit';
import { useWorkbench } from './store.js';

/** Right column: the session's working state, scoped by the agent tree.
 *  Title-bar segment carries the AGENTS header + window controls. */
export function Work(): React.JSX.Element {
  // In search mode the column previews whichever session the browser hovers.
  const session = useWorkbench((s) => s.sessions[s.previewId ?? s.activeId]);
  const toggleWork = useWorkbench((s) => s.toggleWork);
  const workWidth = useWorkbench((s) => s.workWidth);

  return (
    <div
      className={cx('flex flex-none flex-col border-l border-s4 bg-s2')}
      style={{ width: workWidth }}
    >
      {/* title-bar segment */}
      <div className="flex h-[var(--titlebar-h)] flex-none items-stretch">
        <span className="self-center px-3.5 text-[10px] tracking-[0.07em] text-s6 uppercase">
          agents
        </span>
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <WindowControls />
      </div>

      {session ? (
        <>
          <div className="pb-1">
            {session.agents.map((a) => (
              <div
                key={a.name}
                className={cx(
                  'slip group flex cursor-pointer items-center gap-2 px-3.5 py-1 text-[12px] hover:bg-s3',
                  a.depth === 0 ? 'font-[550] text-s12' : 'text-s10',
                )}
                style={{ paddingLeft: 14 + a.depth * 12 }}
              >
                {a.depth > 0 && <span className="w-2.5 text-center font-mono text-[11px] text-s6">└</span>}
                <StatusDot status={a.status} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{a.name}</span>
                {a.depth === 0 ? (
                  <span className="ml-auto font-mono text-[10px] text-s6">root</span>
                ) : (
                  <>
                    <span className="ml-auto font-mono text-[10px] text-s6 group-hover:hidden">
                      {a.cost ?? ''}
                    </span>
                    <span className="ml-auto hidden gap-2 text-[10.5px] text-s8 group-hover:flex">
                      <button type="button" className="cursor-pointer hover:text-s10">watch</button>
                      <button type="button" className="cursor-pointer hover:text-s10">stop</button>
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>

          {session.changes.length > 0 && (
            <Section
              title="changes"
              meta={
                <>
                  <span className="font-mono">{session.changes.length}</span>
                  <span className="ml-auto font-mono text-[10px]">
                    <span className="text-diff-add">
                      +{session.changes.reduce((n, c) => n + c.add, 0)}
                    </span>{' '}
                    <span className="text-diff-del">
                      −{session.changes.reduce((n, c) => n + c.del, 0)}
                    </span>
                  </span>
                </>
              }
            >
              {session.changes.map((c) => (
                <div
                  key={c.path}
                  className="slip flex cursor-pointer items-center gap-2 px-3.5 py-1 font-mono text-[11px] text-s10 hover:bg-s3"
                >
                  <span
                    className="overflow-hidden text-ellipsis whitespace-nowrap"
                    style={{ direction: 'rtl', textAlign: 'left' }}
                  >
                    {c.path}
                  </span>
                  <span className="ml-auto flex-none text-[10px] text-s6">
                    +{c.add} −{c.del}
                  </span>
                </div>
              ))}
            </Section>
          )}

          {session.branch && (
            <Section title="worktree">
              <Kv k="branch" v={session.branch} />
              <Kv k="base" v="main · clean" />
              <Kv k="checkpoints" v="14 · 2m" />
            </Section>
          )}

          {session.flags > 0 && (
            <Section title="record">
              <div className="flex items-start gap-2 px-3.5 py-1">
                <span className="mt-[5px]">
                  <StatusDot status="critical" />
                </span>
                <span>
                  <span className="block text-[11.5px] leading-[1.4] text-s10">
                    retry-loop exceeds verification budget
                  </span>
                  <span className="block font-mono text-[10px] text-s6">M3 · advisory · 1m</span>
                </span>
              </div>
              <button
                type="button"
                className="slip cursor-pointer px-9 py-[3px] text-left text-[11px] text-s7 hover:text-s9"
              >
                2 low · collapsed
              </button>
            </Section>
          )}

          <div className="mt-auto flex items-center border-t border-s3 px-3.5 py-2 font-mono text-[10px] text-s7">
            {session.cost} this session
            <button
              type="button"
              aria-label="hide session panel"
              onClick={toggleWork}
              className="slip ml-auto cursor-pointer text-[14px] hover:text-s9"
            >
              »
            </button>
          </div>
        </>
      ) : (
        <div className="px-3.5 pt-4 text-[11px] text-s7">no session</div>
      )}
    </div>
  );
}

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mt-2 border-t border-s3 pt-2 pb-1">
      <div className="flex items-center gap-2 px-3.5 pb-1 text-[10px] tracking-[0.07em] text-s6 uppercase">
        {title}
        {meta}
      </div>
      {children}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline px-3.5 py-[3px] text-[11.5px] text-s8">
      {k}
      <span className="ml-auto font-mono text-[10.5px] text-s9">{v}</span>
    </div>
  );
}

/** The reopen affordance floats in the window's bottom-right corner — exactly
 *  where » folded the column away, so the toggle round-trips in place. */
export function ReopenWork(): React.JSX.Element {
  const toggleWork = useWorkbench((s) => s.toggleWork);
  return (
    <button
      type="button"
      aria-label="show session panel"
      onClick={toggleWork}
      className="slip fixed right-1.5 bottom-1.5 z-30 flex h-8 w-8 cursor-pointer items-center justify-center font-mono text-[14px] text-s7 hover:text-s9"
    >
      «
    </button>
  );
}

export function WindowControls(): React.JSX.Element {
  return (
    <div className="flex items-stretch" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button type="button" aria-label="minimize" className="slip w-10 cursor-pointer text-[14px] text-s8 hover:bg-s3 hover:text-s10">
        ─
      </button>
      <button type="button" aria-label="maximize" className="slip w-10 cursor-pointer text-[14px] text-s8 hover:bg-s3 hover:text-s10">
        ▢
      </button>
      <button type="button" aria-label="close" className="slip w-10 cursor-pointer text-[14px] text-s8 hover:bg-crit hover:text-s12">
        ✕
      </button>
    </div>
  );
}
