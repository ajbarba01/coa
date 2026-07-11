import { cx, useClickAway, useDismissLayer } from '@coa/console-kit';
import { useRef, useState } from 'react';
import { useWorkbench } from './store.js';

const SURFACES = [
  { id: 'chat', glyph: '❯', label: 'chat' },
  { id: 'graph', glyph: '◉', label: 'graph' },
  { id: 'flags', glyph: '⚑', label: 'flags', badge: 1 },
  { id: 'timeline', glyph: '◷', label: 'timeline' },
  { id: 'cost', glyph: '$', label: 'cost' },
  { id: 'showcase', glyph: '▦', label: 'showcase' },
] as const;

const HUDS = ['usage', 'account', 'flags'] as const;
type Hud = (typeof HUDS)[number];

const PROJECTS = [
  { name: 'myproject', path: '~/dev/myproject', active: true },
  { name: 'coa', path: '~/side-projects/coa', active: false },
  { name: 'dotfiles', path: '~/dotfiles', active: false },
];

/** Left column: project (title-bar segment) → surfaces → HUD → account/settings. */
export function Nav(): React.JSX.Element {
  const surface = useWorkbench((s) => s.surface);
  const setSurface = useWorkbench((s) => s.setSurface);
  const navWidth = useWorkbench((s) => s.navWidth);

  return (
    <div
      className="flex flex-none flex-col border-r border-s4 bg-s2"
      style={{ width: navWidth }}
    >
      <ProjectButton />

      <nav className="pt-1">
        {SURFACES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSurface(s.id)}
            className={cx(
              'slip relative flex w-full cursor-pointer items-center gap-3 px-4 py-[7px] text-left text-[12.5px]',
              s.id === surface ? 'bg-s3 text-s12' : 'text-s10 hover:bg-s3 hover:text-s11',
            )}
          >
            <span className={cx('w-6 text-center font-mono text-[17px]', s.id === surface ? 'text-s11' : 'text-s9')}>
              {s.glyph}
            </span>
            {s.label}
            {'badge' in s && s.badge ? (
              <span className="mr-2 ml-auto font-mono text-[11px] text-crit">{s.badge}</span>
            ) : undefined}
            {/* active surface: the canvas cuts a notch through the sidebar border —
                the hairline follows the notch's two slanted edges */}
            {s.id === surface && (
              <svg
                aria-hidden
                className="absolute top-1/2 right-[-1px] -translate-y-1/2"
                width="10"
                height="34"
                viewBox="0 0 10 34"
              >
                <polygon points="10,0 0,17 10,34" fill="var(--color-s1)" />
                <path d="M10,0 L0,17 L10,34" fill="none" stroke="var(--color-s4)" strokeWidth="1" />
              </svg>
            )}
          </button>
        ))}
      </nav>

      <HudDash />

      <div className="flex items-center gap-1.5 border-t border-s3 px-3 py-2">
        <FootButton label="account">◐</FootButton>
        <FootButton label="settings" onClick={() => useWorkbench.getState().setSettingsOpen(true)}>
          ⚙
        </FootButton>
        <DaemonButton />
      </div>
    </div>
  );
}

const DAEMON_DOT: Record<'running' | 'starting' | 'stopped', string> = {
  running: 'bg-ok',
  starting: 'bg-warn',
  stopped: 'bg-crit',
};

/** The daemon itself, as a status dot with an action menu — the console is a
 *  client of the daemon, so this is the one control that outranks everything. */
function DaemonButton(): React.JSX.Element {
  const daemon = useWorkbench((s) => s.daemon);
  const setDaemon = useWorkbench((s) => s.setDaemon);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickAway(wrapRef, () => setOpen(false));
  useDismissLayer(open, () => setOpen(false));

  const restart = (): void => {
    setDaemon('starting');
    setTimeout(() => useWorkbench.getState().setDaemon('running'), 900);
    setOpen(false);
  };
  const stop = (): void => {
    setDaemon('stopped');
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative ml-auto">
      {open && (
        <div className="slip-enter absolute right-0 bottom-full z-20 mb-1.5 w-36 overflow-hidden rounded-r3 border border-s5 bg-s3 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
          <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] tracking-[0.07em] text-s7 uppercase">
            daemon <span className={cx('h-1.5 w-1.5 rounded-full', DAEMON_DOT[daemon])} />
            <span className="tracking-normal lowercase">{daemon}</span>
          </div>
          <DaemonAction label="restart" onClick={restart} disabled={daemon !== 'running'} />
          <DaemonAction label="stop" onClick={stop} disabled={daemon !== 'running'} />
        </div>
      )}
      <button
        type="button"
        aria-label={`daemon: ${daemon}`}
        onClick={() => setOpen((o) => !o)}
        className="slip flex h-8 w-8 cursor-pointer items-center justify-center rounded-r2 hover:bg-s3"
      >
        <span className={cx('h-2 w-2 rounded-full', DAEMON_DOT[daemon])} />
      </button>
    </div>
  );
}

function DaemonAction({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'slip flex w-full items-center px-3 py-1.5 text-left text-[12px]',
        disabled ? 'cursor-default text-s6' : 'cursor-pointer text-s9 hover:bg-s4 hover:text-s11',
      )}
    >
      {label}
    </button>
  );
}

/** The project switch — a level above the surfaces: ink-only hover, its own
 *  hairline, and a centered modal dialog of projects. */
function ProjectButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  useDismissLayer(open, () => setOpen(false));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="slip group flex h-[var(--titlebar-h)] w-full flex-none cursor-pointer items-center justify-center gap-2 border-b border-s4 px-3.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span className="slip font-mono text-[16px] text-s8 group-hover:text-s10">▣</span>
        <span className="slip text-[12.5px] font-semibold text-s11 group-hover:text-s12">
          myproject
        </span>
        <span className="slip text-[13px] text-s7 group-hover:text-s9">⇄</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-label="switch project"
            className="slip-enter w-[420px] overflow-hidden rounded-r4 border border-s5 bg-s2 shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
          >
            <div className="border-b border-s3 px-4 py-2.5 text-[10px] tracking-[0.07em] text-s7 uppercase">
              projects
            </div>
            {PROJECTS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setOpen(false)}
                className={cx(
                  'slip flex w-full cursor-pointer flex-col gap-0.5 px-4 py-2.5 text-left',
                  p.active ? 'bg-s3' : 'hover:bg-s3',
                )}
              >
                <span className="flex items-center gap-2 text-[13px] font-[550] text-s11">
                  {p.name}
                  {p.active && <span className="ml-auto font-mono text-[10px] text-s7">open</span>}
                </span>
                <span className="font-mono text-[10.5px] text-s7">{p.path}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="slip w-full cursor-pointer border-t border-s4 px-4 py-2.5 text-left text-[12px] text-s8 hover:bg-s3 hover:text-s10"
            >
              open folder…
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** The dashboard HUD: ‹ title › header, seamless picker above it (type-to-filter,
 *  arrow keys; the highlighted entry previews live on the panel below). */
function HudDash(): React.JSX.Element {
  const hud = useWorkbench((s) => s.hud);
  const setHud = useWorkbench((s) => s.setHud);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const dashRef = useRef<HTMLDivElement>(null);
  useClickAway(dashRef, () => setOpen(false));
  useDismissLayer(open, () => setOpen(false));

  const hits = HUDS.filter((h) => h.includes(q.trim().toLowerCase()));
  const highlighted: Hud = open ? (hits[Math.min(hi, hits.length - 1)] ?? hud) : hud;

  const openPicker = (): void => {
    setQ('');
    setHi(Math.max(0, HUDS.indexOf(hud)));
    setOpen(true);
  };
  const commit = (h: Hud): void => {
    setHud(h);
    setOpen(false);
  };
  const cycle = (dir: 1 | -1): void => {
    const i = HUDS.indexOf(hud);
    const next = HUDS[(i + dir + HUDS.length) % HUDS.length];
    if (next) setHud(next);
  };

  return (
    <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-s3 pt-2 pb-1">
      {/* the click-away boundary wraps ONLY the header row + shelf, so clicking the
          HUD panel below (or anywhere else) closes the picker */}
      <div ref={dashRef} className="relative">
        {/* the picker card: results stack above, the search row sits at the bottom —
            nearest the title that opened it (the card grows upward) */}
        {open && (
          <div className="slip-enter absolute right-2 bottom-full left-2 z-20 mb-1.5 overflow-hidden rounded-r3 border border-s5 bg-s3 shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
            <div className="py-1">
              {hits.map((h, i) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => commit(h)}
                  onMouseEnter={() => setHi(i)}
                  className={cx(
                    'slip flex w-full cursor-pointer items-center px-3.5 py-1.5 text-left text-[12px]',
                    h === highlighted ? 'bg-s4 text-s12' : 'text-s9',
                  )}
                >
                  {h}
                  {h === hud && <span className="ml-auto font-mono text-[10px] text-s7">current</span>}
                </button>
              ))}
              {hits.length === 0 && <div className="px-3.5 py-1.5 text-[11.5px] text-s7">no hud</div>}
            </div>
            <div className="flex items-center gap-2 border-t border-s5 px-3 py-1.5">
              <span className="text-[13px] text-s7">⌕</span>
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setHi(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') setHi((i) => Math.min(i + 1, hits.length - 1));
                  if (e.key === 'ArrowUp') setHi((i) => Math.max(i - 1, 0));
                  if (e.key === 'Enter' && hits.length > 0)
                    commit(hits[Math.min(hi, hits.length - 1)] as Hud);
                  // Escape is handled by the dismiss-layer stack.
                }}
                placeholder="find hud…"
                className="w-full min-w-0 flex-1 bg-transparent text-[12px] text-s11 outline-none placeholder:text-s7"
              />
            </div>
          </div>
        )}

        {/* header row: ‹ title › — the title toggles the picker */}
        <div className="flex items-center px-2 pb-1.5">
          <button
            type="button"
            onClick={() => cycle(-1)}
            className="slip flex h-9 w-9 flex-none cursor-pointer items-center justify-center text-[26px] leading-none text-s7 hover:text-s11"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => (open ? setOpen(false) : openPicker())}
            className="slip flex-1 cursor-pointer py-0.5 text-center text-[10px] tracking-[0.07em] text-s7 uppercase hover:text-s11"
          >
            {highlighted}
          </button>
          <button
            type="button"
            onClick={() => cycle(1)}
            className="slip flex h-9 w-9 flex-none cursor-pointer items-center justify-center text-[26px] leading-none text-s7 hover:text-s11"
          >
            ›
          </button>
        </div>
      </div>

      {/* while the picker is open, the panel previews the highlighted HUD */}
      {highlighted === 'usage' && <UsageHud />}
      {highlighted === 'account' && <AccountHud />}
      {highlighted === 'flags' && <FlagsHud />}
    </div>
  );
}

function FootButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="slip flex h-8 w-8 cursor-pointer items-center justify-center rounded-r2 text-[17px] text-s8 hover:bg-s3 hover:text-s10"
    >
      {children}
    </button>
  );
}


function Kv({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline px-4 py-[3px] text-[11.5px] text-s8">
      {k}
      <span className="ml-auto font-mono text-[10.5px] text-s9">{v}</span>
    </div>
  );
}

const BARS = [22, 38, 30, 52, 34, 66, 45, 58, 40, 72, 95, 63];

function UsageHud(): React.JSX.Element {
  return (
    <>
      <Kv k="today" v="$4.20" />
      <Kv k="week" v="$18.75" />
      <Kv k="sessions" v="12" />
      <div className="flex h-14 items-end gap-[3px] px-4 pt-2 pb-1">
        {BARS.map((h, i) => (
          <span
            key={i}
            className={cx('flex-1 rounded-[1px]', i >= BARS.length - 2 ? 'bg-s6' : 'bg-s4')}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <Kv k="cap" v="$1.42 / 5.00" />
      <div className="relative mx-4 mt-1 mb-1 h-[3px] rounded-[2px] bg-s4">
        <span className="absolute inset-y-0 left-0 w-[28%] rounded-[2px] bg-s7" />
      </div>
    </>
  );
}

function AccountHud(): React.JSX.Element {
  return (
    <>
      <Kv k="account" v="pro · zander" />
      <Kv k="provider" v="claude" />
      <Kv k="model" v="fable-5" />
    </>
  );
}

function FlagsHud(): React.JSX.Element {
  return (
    <>
      <Kv k="critical" v="1" />
      <Kv k="advisory" v="2" />
      <Kv k="today" v="6 raised · 5 cleared" />
    </>
  );
}
