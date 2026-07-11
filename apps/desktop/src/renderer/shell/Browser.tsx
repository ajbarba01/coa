import type { SessionSummary } from '@coa/console-viewmodel';
import { Select, StatusDot } from '@coa/console-kit';
import { useState } from 'react';
import { relativeTime } from '../panels/ChatPanel.js';
import type { ConsoleState } from '../panels/state.js';
import { useShell } from './store.js';

type SortKey = 'recent' | 'title';
type GroupKey = 'agent' | 'status' | 'none';

const SORTS: readonly SortKey[] = ['recent', 'title'];
const GROUPS: readonly GroupKey[] = ['agent', 'status', 'none'];

export interface SessionGroup {
  /** The group header text; `''` marks the ungrouped/flat case (header hidden). */
  key: string;
  sessions: SessionSummary[];
}

/** Pure: sort then group a session list. Groups surface in first-encounter
 *  order over the already-sorted list, so e.g. grouping by agent while
 *  sorted by recency puts whichever agent owns the newest session first. */
export function arrangeSessions(
  sessions: SessionSummary[],
  sort: SortKey,
  group: GroupKey,
  agentName: (ref: string) => string,
  isRunning: (id: string) => boolean,
): SessionGroup[] {
  const sorted = [...sessions];
  if (sort === 'recent') {
    sorted.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  } else {
    sorted.sort((a, b) => a.title.localeCompare(b.title));
  }

  if (group === 'none') return [{ key: '', sessions: sorted }];

  const keyOf =
    group === 'agent'
      ? (s: SessionSummary): string => agentName(s.agentRef)
      : (s: SessionSummary): string => (isRunning(s.id) ? 'running' : 'idle');

  const groups = new Map<string, SessionSummary[]>();
  for (const s of sorted) {
    const key = keyOf(s);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.entries()].map(([key, groupSessions]) => ({ key, sessions: groupSessions }));
}

/** The search state's canvas: the real session list, filtered by the query,
 *  sorted and grouped by the toolbar pickers (recency/title; agent/status/flat). */
export function Browser({ state }: { state: ConsoleState }): React.JSX.Element {
  const query = useShell((s) => s.query);
  const setPreview = useShell((s) => s.setPreview);
  const closeSearch = useShell((s) => s.closeSearch);
  const sessions = state.data.sessions.status === 'ok' ? state.data.sessions.value : [];
  const agents = state.data.agents.status === 'ok' ? state.data.agents.value : [];
  const nowIso = new Date().toISOString();
  const [sort, setSort] = useState<SortKey>('recent');
  const [group, setGroup] = useState<GroupKey>('none');

  const agentName = (ref: string): string => agents.find((a) => a.ref === ref)?.name ?? ref;
  const isRunning = (id: string): boolean => state.ui.runStatus[id] !== undefined;
  const q = query.trim().toLowerCase();
  const hits = sessions.filter(
    (s) =>
      !q || s.title.toLowerCase().includes(q) || agentName(s.agentRef).toLowerCase().includes(q),
  );
  const groups = arrangeSessions(hits, sort, group, agentName, isRunning);

  const open = (id: string): void => {
    state.actions.selectSession(id);
    closeSearch();
  };

  const remove = (id: string): void => {
    state.actions.deleteSession(id);
  };

  return (
    <div
      className="slip-enter min-h-0 flex-1 overflow-y-auto px-8 pt-12 pb-4"
      onMouseLeave={() => setPreview(undefined)}
    >
      <div className="flex items-center gap-3.5 pb-3 font-mono text-meta text-s7">
        <div className="flex items-center gap-1.5">
          <span>sort</span>
          <Select
            options={SORTS}
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            aria-label="Sort sessions by"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span>group</span>
          <Select
            options={GROUPS}
            value={group}
            onChange={(v) => setGroup(v as GroupKey)}
            aria-label="Group sessions by"
          />
        </div>
        <span className="ml-auto">{hits.length} sessions</span>
      </div>

      {groups.map(({ key, sessions: list }) => (
        <div key={key || '·'}>
          {group !== 'none' && (
            <div className="flex items-center gap-2 pt-2.5 pb-0.5 text-meta tracking-[0.07em] text-s6 uppercase">
              <span>{key}</span>
              <span className="font-mono">{list.length}</span>
            </div>
          )}
          {list.map((s) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => open(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  open(s.id);
                }
              }}
              onMouseEnter={() => setPreview(s.id)}
              className="slip group -mx-2.5 flex w-[calc(100%+20px)] cursor-pointer items-center gap-2.5 rounded-r2 px-2.5 py-1.75 text-left text-sec text-s10 hover:bg-s2"
            >
              <StatusDot status={isRunning(s.id) ? 'running' : 'idle'} />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                <Highlight text={s.title} q={q} />
              </span>
              <span className="ml-auto flex flex-none items-center gap-3.5 font-mono text-meta text-s7">
                <span>{agentName(s.agentRef)}</span>
                <span>{relativeTime(s.updatedAt, nowIso)}</span>
                <button
                  type="button"
                  aria-label={`Delete session: ${s.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(s.id);
                  }}
                  className="slip flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-r1 text-icon text-s6 opacity-0 group-hover:opacity-100 hover:text-crit focus-visible:opacity-100"
                >
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      ))}

      {hits.length === 0 && (
        <div className="pt-10 text-center text-sec text-s7">
          {sessions.length === 0 ? 'no sessions yet' : `no sessions match “${query}”`}
        </div>
      )}
    </div>
  );
}

function Highlight({ text, q }: { text: string; q: string }): React.JSX.Element {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-s12">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}
