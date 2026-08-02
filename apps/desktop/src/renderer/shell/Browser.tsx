import type { SessionSummary } from '@coa/console-viewmodel';
import { cx, Icon, Select, StatusDot } from '@coa/console-kit';
import { useEffect, useRef, useState } from 'react';
import { relativeTime } from '../panels/ChatPanel.js';
import type { ConsoleState } from '../panels/state.js';
import { useShell } from './store.js';

type SortKey = 'recent' | 'title';
type GroupKey = 'agent' | 'status' | 'none';

// Value/label split: the keys drive `arrangeSessions`, the labels are what the pickers show.
const SORTS: readonly { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'title', label: 'Title' },
];
const GROUPS: readonly { value: GroupKey; label: string }[] = [
  { value: 'agent', label: 'Agent' },
  { value: 'status', label: 'Status' },
  { value: 'none', label: 'None' },
];

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
      : (s: SessionSummary): string => (isRunning(s.id) ? 'Running' : 'Idle');

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
  // The cursor is the ONE highlight: ↑/↓ move it, the mouse moves it too (hover and
  // keyboard can't disagree), and it always names the row Enter would open — the
  // command palette's mechanic, over the browser's grouped list read flat.
  const flat = groups.flatMap((g) => g.sessions);
  const [cursor, setCursor] = useState(0);
  const at = Math.min(cursor, Math.max(0, flat.length - 1));
  const cursorId = flat[at]?.id;
  const cursorRef = useRef<HTMLDivElement>(null);

  const open = (id: string): void => {
    state.actions.selectSession(id);
    closeSearch();
  };

  const remove = (id: string): void => {
    // A deleted session has nothing to come back to: drop it from the working set AND the
    // reopen stack, so ctrl+shift+t can't resurrect a tab whose session is gone.
    useShell.getState().forgetTab(id);
    state.actions.deleteSession(id);
  };

  // Keys land on the window because focus stays in the search field (which lives in the
  // title-bar strip, not here) — the list is the strip's canvas, so it listens where the
  // typing is. Skipped while a dialog is up: that layer owns the arrows then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const shell = useShell.getState();
      if (shell.paletteOpen || shell.settingsOpen || shell.shortcutsOpen || shell.projectOpen) {
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (flat.length === 0) return;
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setCursor((c) => (Math.min(c, flat.length - 1) + step + flat.length) % flat.length);
      } else if (e.key === 'Enter' && cursorId !== undefined) {
        // A tabbed-to row opens ITSELF (its own handler) — the cursor only speaks for
        // Enter pressed from the search field, where the pointer never went.
        const target = e.target;
        if (target instanceof HTMLElement && target.closest('[data-session-row]')) return;
        e.preventDefault();
        open(cursorId);
      } else if (e.key === 'Delete' && cursorId !== undefined) {
        // Delete acts on the row the cursor names — the same row Enter would open, so the
        // key and the highlight can never disagree about their target.
        e.preventDefault();
        remove(cursorId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Wrapping top→bottom would otherwise leave the cursor off-screen.
  useEffect(() => {
    cursorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [cursorId]);

  // A new query re-ranks the list: the cursor returns to the top hit, and the dock
  // previews whatever it now names.
  useEffect(() => setCursor(0), [q, sort, group]);
  useEffect(() => setPreview(cursorId), [cursorId, setPreview]);

  return (
    <div className="slip-enter min-h-0 flex-1 overflow-y-auto px-8 pt-12 pb-4">
      <div className="flex items-center gap-3.5 pb-3 font-mono text-meta text-s7">
        <div className="flex items-center gap-1.5">
          <span>Sort</span>
          <Select
            options={SORTS}
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            aria-label="Sort sessions by"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span>Group</span>
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
              ref={s.id === cursorId ? cursorRef : undefined}
              data-session-row
              role="button"
              tabIndex={0}
              onClick={() => open(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  open(s.id);
                }
              }}
              onMouseEnter={() => setCursor(flat.findIndex((f) => f.id === s.id))}
              className={cx(
                'slip group -mx-2.5 flex w-[calc(100%+20px)] cursor-pointer items-center gap-2.5 rounded-r2 px-2.5 py-1.75 text-left text-sec text-s10',
                s.id === cursorId && 'bg-s2',
              )}
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
                  className={cx(
                    'slip flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-r1 text-s6 opacity-0 group-hover:opacity-100 hover:text-crit focus-visible:opacity-100',
                    // the cursor row is "hovered" whether the mouse or the arrows put it there
                    s.id === cursorId && 'opacity-100',
                  )}
                >
                  <Icon name="close" />
                </button>
              </span>
            </div>
          ))}
        </div>
      ))}

      {hits.length === 0 && (
        <div className="pt-10 text-center text-sec text-s7">
          {sessions.length === 0 ? 'No sessions yet' : `No sessions match “${query}”`}
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
