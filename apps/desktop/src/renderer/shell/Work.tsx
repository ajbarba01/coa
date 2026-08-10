import {
  groupSessionTree,
  sessionGroupFor,
  type AgentSummary,
  type SessionSummary,
  type SessionTreeGroup,
  type WorktreeView,
} from '@coa/console-viewmodel';
import { CapsLabel, cx, StatusDot, Tooltip } from '@coa/console-kit';
import { useState } from 'react';
import { usd } from '../panels/format.js';
import { SurfaceEmpty } from '../panels/surfaceStates.js';
import type { ConsoleState, Remote } from '../panels/state.js';
import { DRAG } from './appRegion.js';
import { useConsoleState } from './consoleStore.js';
import { bindFor } from './keys.js';
import { useShell } from './store.js';
import { AppWindowControls } from './windowControls.js';

/** Right column: the active session's working state, honestly floored — the
 *  root agent row (real title + real run status), the plan checklist, the
 *  Subagents tree (depth-nested children with live status + jump-to-thread),
 *  and the Worktree rows (isolated sessions, dirty summary, the explicit reap)
 *  are all real; Changes still has no backing data and renders one quiet
 *  "not tracked yet" line instead of fake chrome. Cost is real once anything
 *  in the active tab's family tree carries a recorded spend (the tree-wide
 *  roll-up, not just this one session's own); it floors the same way until
 *  then. Title-bar segment carries the AGENTS header + the window controls. */
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
  // The active session's family tree, wherever the active tab sits in it — the
  // Subagents rows, the Worktree scope, and the Cost roll-up all read this one
  // grouping (`groupSessionTree`/`sessionGroupFor` live in console-viewmodel,
  // testable without jsdom).
  const group =
    activeId === undefined ? undefined : sessionGroupFor(groupSessionTree(sessions), activeId);
  // `undefined` ⇒ nothing in the tree is tracked yet, the same "not tracked
  // yet" floor as before this existed.
  const treeCostUsd = group?.costUsd;
  const agents = state?.data.agents.status === 'ok' ? state.data.agents.value : [];

  return (
    <div className="flex flex-none flex-col border-l border-s4 bg-s2" style={{ width: workWidth }}>
      {/* the whole strip drags; interactive children opt out (appRegion policy) */}
      <div
        className="flex h-(--titlebar-h) flex-none items-stretch border-b border-s4"
        style={DRAG}
      >
        <CapsLabel className="self-center px-4 pt-0 pb-0">Agents</CapsLabel>
        <div className="flex-1" />
        <AppWindowControls />
      </div>

      {session ? (
        <div className="flex-1 overflow-y-auto pb-1">
          <div className="flex items-center gap-2 px-3.5 py-1 text-sec font-[550] text-s12">
            <StatusDot status={running ? 'running' : 'idle'} />
            <span className="min-w-0 flex-1 truncate">{session.title}</span>
            {/* Names what lineage makes this session, not the panel itself. A
                spawned child can be the active tab, so a hardcoded "Root" would
                state something false rather than degrade to a floor. */}
            <span className="ml-auto font-mono text-caps text-s6">
              {session.parent === undefined ? 'Root' : 'Subagent'}
            </span>
          </div>

          {planItems !== undefined && planItems.length > 0 ? (
            <Section
              title="Plan"
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
            <Section title="Plan">
              <div className="px-3.5 py-1 text-meta text-s6">No plan yet</div>
            </Section>
          )}

          <SubagentsSection group={group} agents={agents} state={state} />
          <FloorSection title="Changes" />
          <WorktreeSection
            remote={state?.data.worktrees}
            group={group}
            sessions={sessions}
            onReap={(id) => state?.actions.reapWorktree(id)}
          />
          {treeCostUsd === undefined ? (
            <FloorSection title="Cost" />
          ) : (
            <Section title="Cost">
              <div className="flex items-baseline px-3.5 py-1 text-sec text-s11">
                <span className="ml-auto font-mono">{usd(treeCostUsd)}</span>
              </div>
            </Section>
          )}
        </div>
      ) : (
        <SurfaceEmpty title="No session" />
      )}

      <div className="mt-auto flex items-center border-t border-s3 px-3.5 py-2">
        <Tooltip label="Hide session panel" keys={bindFor('toggle-dock')} side="top">
          <button
            type="button"
            aria-label="Hide session panel"
            onClick={toggleWork}
            className="slip ml-auto flex h-8 w-8 cursor-pointer items-center justify-center font-mono text-body text-s7 hover:text-s9"
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
    <Tooltip label="Show session panel" keys={bindFor('toggle-dock')} side="top">
      <button
        type="button"
        aria-label="Show session panel"
        onClick={toggleWork}
        className="slip fixed right-1.5 bottom-1.5 z-(--z-seam) flex h-8 w-8 cursor-pointer items-center justify-center font-mono text-body text-s7 hover:text-s9"
      >
        «
      </button>
    </Tooltip>
  );
}

/** Identity text tokens for the agent color vocabulary — the same kit `agent-*`
 *  theme scale AgentsPanel's tint/solid maps resolve from; slate is the fallback
 *  for an unknown/absent color (an accent, never load-bearing). */
const AGENT_TEXT: Record<string, string> = {
  slate: 'text-agent-slate',
  sky: 'text-agent-sky',
  blue: 'text-agent-blue',
  teal: 'text-agent-teal',
  green: 'text-agent-green',
  mauve: 'text-agent-mauve',
  violet: 'text-agent-violet',
  coral: 'text-agent-coral',
};

/** A child row's live status, honestly sourced: the console's own run map first
 *  (sessions THIS console subscribed to), then the parent-stream announcements'
 *  mirror (`ui.subagentStatus`). Absent from both ⇒ idle ground — "not observed",
 *  never a claimed state. Exported for unit testing. */
export function childDotStatus(
  sessionId: string,
  state: ConsoleState | undefined,
): 'running' | 'done' | 'critical' | 'idle' {
  if (state?.ui.runStatus[sessionId] !== undefined) return 'running';
  const observed = state?.ui.subagentStatus[sessionId]?.state;
  if (observed === 'running') return 'running';
  if (observed === 'completed') return 'done';
  if (observed === 'errored') return 'critical';
  return 'idle';
}

/** The Subagents floor: the active family tree's children, depth-nested, each a
 *  jump-to-thread row (dot = live status, identity color = the child's agent). */
function SubagentsSection({
  group,
  agents,
  state,
}: {
  group: SessionTreeGroup | undefined;
  agents: AgentSummary[];
  state: ConsoleState | undefined;
}): React.JSX.Element {
  const rows = group?.rows ?? [];
  if (rows.length === 0) {
    // Spawning IS supported — the tree is just childless, so this reads like
    // Plan's own empty line, not the "not tracked yet" floor.
    return (
      <Section title="Subagents">
        <div className="px-3.5 py-1 text-meta text-s6">No subagents yet</div>
      </Section>
    );
  }
  return (
    <Section title="Subagents" meta={String(rows.length)}>
      {rows.map(({ session, depth }) => {
        const agent = agents.find((a) => a.ref === session.agentRef);
        const color = AGENT_TEXT[agent?.color ?? 'slate'] ?? AGENT_TEXT['slate'];
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => state?.actions.selectSession(session.id)}
            aria-label={`Open ${session.title}`}
            className="slip flex w-full cursor-pointer items-center gap-2 py-0.75 pr-3.5 text-left hover:bg-s3"
            // Nesting indent: one step per depth beyond the direct child.
            style={{ paddingLeft: 14 + (depth - 1) * 12 }}
          >
            <StatusDot status={childDotStatus(session.id, state)} size={5} />
            <span className={cx('flex-none font-mono text-meta font-[550]', color)}>
              {agent?.name ?? session.agentRef}
            </span>
            <span className="min-w-0 flex-1 truncate text-meta text-s9">{session.title}</span>
          </button>
        );
      })}
    </Section>
  );
}

/** The last path segment (the session id under `.coa/worktrees/`) — enough to
 *  recognize the directory without the row eating the whole column. */
function pathTail(path: string): string {
  return path.split('/').at(-1) ?? path;
}

/** The Worktree floor: every session in the ACTIVE family tree running in its own
 *  isolated worktree — path, the cheap dirty summary, and the explicit reap (the
 *  only thing that ever removes one). A dirty tree's reap asks once more before
 *  discarding; a running session's reap is withheld (the daemon would refuse it
 *  anyway — this just says so before the round trip). */
function WorktreeSection({
  remote,
  group,
  sessions,
  onReap,
}: {
  remote: Remote<WorktreeView[]> | undefined;
  group: SessionTreeGroup | undefined;
  sessions: SessionSummary[];
  onReap: (sessionId: string) => void;
}): React.JSX.Element {
  // Two-step confirm for a DIRTY tree only: arming is per-row, so a second
  // click elsewhere re-arms there instead of firing here.
  const [armed, setArmed] = useState<string | undefined>(undefined);
  if (remote === undefined || remote.status === 'loading') {
    return (
      <Section title="Worktree">
        <div className="mx-3.5 my-1 h-3 w-2/3 animate-pulse rounded-r2 bg-s3" />
      </Section>
    );
  }
  if (remote.status === 'error') {
    return (
      <Section title="Worktree">
        <div role="alert" className="flex items-center gap-2 px-3.5 py-1 text-meta text-s9">
          <StatusDot status="critical" size={5} />
          <span className="min-w-0 flex-1 truncate">{remote.message}</span>
        </div>
      </Section>
    );
  }
  const treeIds = new Set(
    group === undefined ? [] : [group.header.id, ...group.rows.map((r) => r.session.id)],
  );
  const inTree = remote.value.filter((w) => treeIds.has(w.sessionId));
  const elsewhere = remote.value.length - inTree.length;
  if (inTree.length === 0) {
    return (
      <Section title="Worktree">
        <div className="px-3.5 py-1 text-meta text-s6">
          Shared project root (no isolated worktrees)
        </div>
        {elsewhere > 0 && (
          <div className="px-3.5 py-0.5 font-mono text-meta text-s6">
            {elsewhere} in other sessions
          </div>
        )}
      </Section>
    );
  }
  return (
    <Section title="Worktree" meta={String(inTree.length)}>
      {inTree.map((w) => {
        const title = sessions.find((s) => s.id === w.sessionId)?.title;
        const isArmed = armed === w.sessionId;
        const needsConfirm = w.dirty === true;
        return (
          <div key={w.sessionId} className="group flex items-center gap-2 px-3.5 py-0.75">
            <span aria-hidden className="w-3 flex-none text-center font-mono text-meta text-s7">
              ⎇
            </span>
            <Tooltip label={w.path} side="top">
              <span className="min-w-0 flex-1 truncate font-mono text-meta text-s9">
                {title !== undefined ? `${title} · ` : ''}
                {pathTail(w.path)}
              </span>
            </Tooltip>
            <span className="flex-none font-mono text-meta text-s6">
              {w.dirty === undefined
                ? 'Status unknown'
                : w.dirty
                  ? `${w.filesChanged ?? 0} changed`
                  : 'Clean'}
            </span>
            {w.running === true ? (
              <span className="flex flex-none items-center gap-1.5 font-mono text-caps text-s6">
                <StatusDot status="running" size={5} />
                Running
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (needsConfirm && !isArmed) {
                    setArmed(w.sessionId);
                    return;
                  }
                  setArmed(undefined);
                  onReap(w.sessionId);
                }}
                className={cx(
                  'slip flex-none cursor-pointer font-mono text-meta underline decoration-s6 decoration-dotted underline-offset-[3px]',
                  isArmed ? 'text-warn hover:text-warn' : 'text-s8 hover:text-s10',
                )}
              >
                {isArmed ? 'Discard Changes' : 'Reap'}
              </button>
            )}
          </div>
        );
      })}
      {elsewhere > 0 && (
        <div className="px-3.5 py-0.5 font-mono text-meta text-s6">
          {elsewhere} in other sessions
        </div>
      )}
    </Section>
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
 *  Becomes a real Section as its backing work lands (diff engine, per-session
 *  cost roll-up — see ROADMAP's parked-producer note). */
function FloorSection({ title }: { title: string }): React.JSX.Element {
  return (
    <Section title={title}>
      <div className="px-3.5 py-1 text-meta text-s6">Not tracked yet</div>
    </Section>
  );
}
