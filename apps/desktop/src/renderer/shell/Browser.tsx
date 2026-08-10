import { groupSessionTree, withAncestors, type SessionSummary } from '@coa/console-viewmodel';
import { cx, Icon, Select, StatusDot } from '@coa/console-kit';
import { useEffect, useRef, useState } from 'react';
import { relativeTime } from '../panels/ChatPanel.js';
import { consoleActions } from '../store/actions.js';
import { useDaemonData } from '../store/data.js';
import { useSessions } from '../store/sessions.js';
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

/** One row the browser draws: a session plus how deep it nests under a spawned
 *  parent (0 = a tree's own header/root), and whether the session ITSELF is a
 *  search hit (`false` ⇒ pulled in only as ancestor context — see
 *  {@link nestedRows}). */
interface BrowserRow {
  session: SessionSummary;
  depth: number;
  matched: boolean;
}

/** The one comparator both the toolbar's Sort picker and `nestedRows`'s
 *  post-grouping re-sort use, so the two can never silently disagree. */
function compareSessions(a: SessionSummary, b: SessionSummary, sort: SortKey): number {
  return sort === 'recent'
    ? Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    : a.title.localeCompare(b.title);
}

/** Default-nest, not default-leak: a flat session bucket becomes an outline where
 *  a spawned child renders directly under its parent instead of as a peer row.
 *  `hits` is the query-filtered set (all of `allSessions` when the query is
 *  empty); `groupSessionTree` alone would see only `hits` and, when a search
 *  matches a child but not its parent, lose that parent and render the child
 *  as an apparent, unrelated root — `withAncestors` pulls the real ancestor
 *  chain back in from `allSessions` first (a filtered-out parent must not
 *  silently become invisible context). `matched` distinguishes a genuine hit
 *  from a pulled-in ancestor so the row can read as context, not a result.
 *
 *  `withAncestors` appends a pulled-in ancestor at the END of the array it
 *  returns, so a tree only reachable through pulling (nothing in it matched
 *  the query directly) would otherwise always sort after every genuinely
 *  matched tree, regardless of recency/title — re-sorting the finished
 *  GROUPS by their header with the same comparator the toolbar's Sort picker
 *  uses fixes that without touching intra-tree nesting order. Re-sorting an
 *  already-sorted array by the identical comparator is a stable no-op, so the
 *  ordinary empty-query case (where nothing was pulled and `hits` already
 *  came out of that same sort) renders byte-identical to before.
 *
 *  Only meaningful for a flat bucket — the agent/status pickers already cut
 *  across family trees on purpose, so nesting is deliberately NOT attempted
 *  there (a session still renders, just without the indent). The tree
 *  grouping itself lives in console-viewmodel, testable without jsdom; this
 *  is only the flatten-for-display step. */
function nestedRows(
  allSessions: SessionSummary[],
  hits: SessionSummary[],
  sort: SortKey,
): BrowserRow[] {
  const hitIds = new Set(hits.map((s) => s.id));
  const groups = groupSessionTree(withAncestors(allSessions, hits));
  const ordered = [...groups].sort((a, b) => compareSessions(a.header, b.header, sort));
  return ordered.flatMap((g) => [
    { session: g.header, depth: 0, matched: hitIds.has(g.header.id) },
    ...g.rows.map((r) => ({ ...r, matched: hitIds.has(r.session.id) })),
  ]);
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
  sorted.sort((a, b) => compareSessions(a, b, sort));

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
export function Browser(): React.JSX.Element {
  const query = useShell((s) => s.query);
  const setPreview = useShell((s) => s.setPreview);
  const closeSearch = useShell((s) => s.closeSearch);
  const list = useSessions((s) => s.list);
  const sessions = list.status === 'ok' ? list.value : [];
  const agentsRemote = useDaemonData((s) => s.agents);
  const agents = agentsRemote.status === 'ok' ? agentsRemote.value : [];
  const runStatus = useSessions((s) => s.runStatus);
  const nowIso = new Date().toISOString();
  const [sort, setSort] = useState<SortKey>('recent');
  const [group, setGroup] = useState<GroupKey>('none');

  const agentName = (ref: string): string => agents.find((a) => a.ref === ref)?.name ?? ref;
  const isRunning = (id: string): boolean => runStatus[id] !== undefined;
  const q = query.trim().toLowerCase();
  const hits = sessions.filter(
    (s) =>
      !q || s.title.toLowerCase().includes(q) || agentName(s.agentRef).toLowerCase().includes(q),
  );
  const groups = arrangeSessions(hits, sort, group, agentName, isRunning);
  // Lineage nesting only applies to the flat bucket: the agent/status pickers
  // already cut across family trees on purpose (e.g. "every running session,
  // whichever tree it's in"), so a bucket other than 'none' stays flat rather
  // than fighting that intent with a second, conflicting hierarchy.
  const renderGroups = groups.map(({ key, sessions: list }) => ({
    key,
    rows:
      group === 'none'
        ? nestedRows(sessions, list, sort)
        : list.map((s) => ({ session: s, depth: 0, matched: true })),
  }));
  // The cursor is the ONE highlight: ↑/↓ move it, the mouse moves it too (hover and
  // keyboard can't disagree), and it always names the row Enter would open — the
  // command palette's mechanic, over the browser's grouped list read flat.
  const flat = renderGroups.flatMap((g) => g.rows.map((r) => r.session));
  const [cursor, setCursor] = useState(0);
  const at = Math.min(cursor, Math.max(0, flat.length - 1));
  const cursorId = flat[at]?.id;
  const cursorRef = useRef<HTMLDivElement>(null);

  const open = (id: string): void => {
    consoleActions.selectSession(id);
    closeSearch();
  };

  const remove = (id: string): void => {
    // A deleted session has nothing to come back to: drop it from the working set AND the
    // reopen stack, so ctrl+shift+t can't resurrect a tab whose session is gone.
    useShell.getState().forgetTab(id);
    consoleActions.deleteSession(id);
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

      {renderGroups.map(({ key, rows: list }) => (
        <div key={key || '·'}>
          {group !== 'none' && (
            <div className="flex items-center gap-2 pt-2.5 pb-0.5 text-meta tracking-[0.07em] text-s6 uppercase">
              <span>{key}</span>
              <span className="font-mono">{list.length}</span>
            </div>
          )}
          {list.map(({ session: s, depth, matched }) => (
            <div
              key={s.id}
              ref={s.id === cursorId ? cursorRef : undefined}
              data-session-row
              data-session-id={s.id}
              data-depth={depth}
              data-matched={matched}
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
              // A nested row indents (16px/level, matching the transcript's own
              // depth indent) and wears a left hairline rail so a tree reads as an
              // outline, not a same-weight run of rows.
              style={depth > 0 ? { paddingLeft: `calc(0.625rem + ${depth * 16}px)` } : undefined}
              className={cx(
                'slip group -mx-2.5 flex w-[calc(100%+20px)] cursor-pointer items-center gap-2.5 rounded-r2 px-2.5 py-1.75 text-left text-sec text-s10',
                s.id === cursorId && 'bg-s2',
                depth > 0 && 'border-l border-s3',
                // A row pulled in only as a matched descendant's ancestor context
                // (its own title didn't match the query) reads dimmer — still a
                // real, fully clickable session, just not itself a result.
                !matched && 'opacity-60',
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
