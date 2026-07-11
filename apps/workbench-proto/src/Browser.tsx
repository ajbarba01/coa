import { StatusDot, cx, useClickAway, useDismissLayer } from '@coa/console-kit';
import { useRef, useState } from 'react';
import type { Session } from './store.js';
import { useWorkbench } from './store.js';

type SortKey = 'recent' | 'cost' | 'title';
type GroupKey = 'divider' | 'agent' | 'status' | 'none';

const SORTS: SortKey[] = ['recent', 'cost', 'title'];
const GROUPS: GroupKey[] = ['divider', 'agent', 'status', 'none'];

/** The search state's canvas: the session browser (sorting, grouping, dividers). */
export function Browser(): React.JSX.Element {
  const sessions = useWorkbench((s) => s.sessions);
  const order = useWorkbench((s) => s.order);
  const query = useWorkbench((s) => s.query);
  const select = useWorkbench((s) => s.select);
  const setPreview = useWorkbench((s) => s.setPreview);
  const [sort, setSort] = useState<SortKey>('recent');
  const [group, setGroup] = useState<GroupKey>('divider');

  const q = query.trim().toLowerCase();
  const hits = order
    .map((id) => sessions[id])
    .filter((s): s is Session => s !== undefined)
    .filter((s) => !q || s.title.toLowerCase().includes(q) || s.agent.includes(q));

  // Seed order IS recency order; other sorts derive.
  const sorted = [...hits];
  if (sort === 'cost') sorted.sort((a, b) => parseCost(b.cost) - parseCost(a.cost));
  if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));

  const groups = new Map<string, Session[]>();
  for (const s of sorted) {
    const key =
      group === 'none'
        ? ''
        : group === 'divider'
          ? (s.divider ?? 'ungrouped')
          : group === 'agent'
            ? s.agent
            : s.status;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  return (
    <div
      className="slip-enter min-h-0 flex-1 overflow-y-auto px-8 pt-12 pb-4"
      onMouseLeave={() => setPreview(undefined)}
    >
      <div className="flex items-center gap-3.5 pb-3 font-mono text-[10.5px] text-s7">
        <Picker label="sort" value={sort} options={SORTS} onPick={setSort} />
        <Picker label="group" value={group} options={GROUPS} onPick={setGroup} />
        <span className="ml-auto">{hits.length} sessions</span>
      </div>

      {[...groups.entries()].map(([groupName, list]) => (
        <div key={groupName || '·'}>
          {group !== 'none' && (
            <div className="flex items-center gap-2 pt-2.5 pb-0.5 text-[10px] tracking-[0.07em] text-s6 uppercase">
              {groupName} <span className="font-mono">{list.length}</span>
            </div>
          )}
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              onMouseEnter={() => setPreview(s.id)}
              className="slip -mx-2.5 flex w-[calc(100%+20px)] cursor-pointer items-center gap-2.5 rounded-r2 px-2.5 py-[7px] text-left text-[12.5px] text-s10 hover:bg-s2"
            >
              <StatusDot status={s.status} />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                <Highlight text={s.title} q={q} />
              </span>
              <span className="ml-auto flex flex-none gap-3.5 font-mono text-[10.5px] text-s7">
                <span>{s.agent}</span>
                {s.flags > 0 && <span className="text-crit">⚑{s.flags}</span>}
                <span>{s.cost}</span>
                <span>{s.recency}</span>
              </span>
            </button>
          ))}
        </div>
      ))}

      {hits.length === 0 && (
        <div className="pt-10 text-center text-[12px] text-s7">no sessions match “{query}”</div>
      )}
    </div>
  );
}

function parseCost(c: string): number {
  return Number.parseFloat(c.replace('$', '')) || 0;
}

/** A tiny toolbar dropdown: `label: value ▾` opening an option card. */
function Picker<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onPick: (v: T) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismissLayer(open, () => setOpen(false));
  useClickAway(ref, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cx('slip cursor-pointer', open ? 'text-s11' : 'text-s9 hover:text-s11')}
      >
        {label}: {value} ▾
      </button>
      {open && (
        <div className="slip-enter absolute top-full left-0 z-30 mt-1.5 min-w-28 overflow-hidden rounded-r3 border border-s5 bg-s3 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => {
                onPick(o);
                setOpen(false);
              }}
              className={cx(
                'slip flex w-full cursor-pointer items-center gap-4 px-3 py-1.5 text-left font-sans text-[12px]',
                o === value ? 'bg-s4 text-s12' : 'text-s9 hover:bg-s4 hover:text-s11',
              )}
            >
              {o}
              {o === value && (
                <span className="ml-auto font-mono text-[10px] text-s7">current</span>
              )}
            </button>
          ))}
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
      <span className={cx('text-s12')}>{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}
