import {
  CapsLabel,
  MenuItem,
  ModalShell,
  PopoverCard,
  Tooltip,
  cx,
  menuSurface,
  useClickAway,
  useDismissLayer,
} from '@coa/console-kit';
import type { FeedView } from '@coa/console-viewmodel';
import { toCapViewModel } from '@coa/console-viewmodel';
import { useRef, useState } from 'react';
import type { ConsoleState, Remote } from '../panels/state.js';
import { DRAG, NO_DRAG } from './appRegion.js';
import { useConsoleState } from './consoleStore.js';
import { bindFor } from './keys.js';
import { useShell } from './store.js';

export const SURFACES = [
  { id: 'chat', glyph: '❯', label: 'chat' },
  { id: 'graph', glyph: '◉', label: 'graph' },
  { id: 'flags', glyph: '⚑', label: 'flags' },
  { id: 'timeline', glyph: '◷', label: 'timeline' },
  { id: 'cost', glyph: '$', label: 'cost' },
  { id: 'agents', glyph: '◇', label: 'agents' },
  { id: 'showcase', glyph: '▦', label: 'showcase' },
] as const;

/** Pure: the flags row's red count — CRITICAL flags only (red is criticality,
 *  per the indicator law); zero renders nothing. Loading/error render nothing
 *  too — the surface itself carries those states. */
export function critCount(flags: Remote<FeedView> | undefined): number {
  if (flags === undefined || flags.status !== 'ok') return 0;
  return flags.value.expanded.filter((f) => f.severity === 'crit').length;
}

/** Left column: project (title-bar segment) → surfaces → HUD → account/settings/daemon foot. */
export function Nav(): React.JSX.Element {
  const surface = useShell((s) => s.surface);
  const setSurface = useShell((s) => s.setSurface);
  const navWidth = useShell((s) => s.navWidth);
  const setSettingsOpen = useShell((s) => s.setSettingsOpen);
  const flags = useConsoleState((s) => s?.data.flags);
  const crit = critCount(flags);

  return (
    <div className="flex flex-none flex-col border-r border-s4 bg-s2" style={{ width: navWidth }}>
      <ProjectButton />

      <nav className="pt-1">
        {SURFACES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSurface(s.id)}
            className={cx(
              'slip relative flex w-full cursor-pointer items-center gap-3 px-4 py-1.75 text-left text-sec',
              // Selection wears the s4 tint (selection-marker law); hover sits one
              // step below on s3 so the two states never read identically.
              s.id === surface ? 'bg-s4 text-s12' : 'text-s10 hover:bg-s3 hover:text-s11',
            )}
          >
            <span
              className={cx(
                'w-6 text-center font-mono text-icon',
                s.id === surface ? 'text-s11' : 'text-s9',
              )}
            >
              {s.glyph}
            </span>
            {s.label}
            {s.id === 'flags' && crit > 0 && (
              <span className="mr-2 ml-auto font-mono text-code text-crit">{crit}</span>
            )}
            {/* active surface: the canvas cuts a notch through the sidebar border —
                the hairline follows the notch's two slanted edges */}
            {s.id === surface && (
              <svg
                aria-hidden
                className="absolute top-1/2 -right-px -translate-y-1/2"
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
        <FootButton label="account" onClick={() => setSurface('account')}>
          ◐
        </FootButton>
        <FootButton label="settings" keys={bindFor('settings')} onClick={() => setSettingsOpen(true)}>
          ⚙
        </FootButton>
        <DaemonButton />
      </div>
    </div>
  );
}

const DAEMON_DOT: Record<string, string> = {
  running: 'bg-ok',
  starting: 'bg-warn',
  stopped: 'bg-crit',
  error: 'bg-crit',
};

/** The daemon itself, as a status dot with an action menu — the console is a
 *  client of the daemon, so this is the one control that outranks everything. */
function DaemonButton(): React.JSX.Element {
  const daemon = useShell((s) => s.daemon);
  const [open, setOpen] = useState(false);

  const act = (action: 'start' | 'stop' | 'restart'): void => {
    void window.coa.daemon[action]();
    setOpen(false);
  };

  return (
    <div className="ml-auto">
      <PopoverCard
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
        className="w-36"
        tooltip={{ label: `daemon: ${daemon}`, side: 'top' }}
        trigger={
          <button
            type="button"
            aria-label={`daemon: ${daemon}`}
            className="slip flex h-8 w-8 cursor-pointer items-center justify-center rounded-r2 hover:bg-s3"
          >
            <span className={cx('h-2 w-2 rounded-full', DAEMON_DOT[daemon] ?? 'bg-s5')} />
          </button>
        }
      >
        <div className="flex items-center gap-2 px-3 py-1.5 text-caps tracking-[0.07em] text-s7 uppercase">
          daemon <span className={cx('h-1.5 w-1.5 rounded-full', DAEMON_DOT[daemon] ?? 'bg-s5')} />
          <span className="tracking-normal lowercase">{daemon}</span>
        </div>
        <MenuItem
          disabled={daemon === 'running' || daemon === 'starting'}
          onClick={() => act('start')}
        >
          start
        </MenuItem>
        <MenuItem disabled={daemon !== 'running'} onClick={() => act('restart')}>
          restart
        </MenuItem>
        <MenuItem disabled={daemon !== 'running'} onClick={() => act('stop')}>
          stop
        </MenuItem>
      </PopoverCard>
    </div>
  );
}

/** The project switch — a level above the surfaces. The dialog is the honest
 *  floor: one open project (main derives it from the daemon's cwd); switching
 *  arrives with the orphan-homes pass. */
function ProjectButton(): React.JSX.Element {
  const open = useShell((s) => s.projectOpen);
  const setOpen = useShell((s) => s.setProjectOpen);
  const workspace = useShell((s) => s.workspace);
  const name = workspace?.name ?? '…';

  return (
    <>
      {/* the segment is drag surface; the button's hitbox is its content, not
          the whole sidebar width */}
      <div
        className="flex h-(--titlebar-h) w-full flex-none items-center justify-center border-b border-s4"
        style={DRAG}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="slip group flex h-full min-w-0 cursor-pointer items-center gap-2 px-3.5"
          style={NO_DRAG}
        >
          <span className="slip font-mono text-icon text-s8 group-hover:text-s10">▣</span>
          <span className="slip truncate text-sec font-semibold text-s11 group-hover:text-s12">
            {name}
          </span>
          <span className="slip text-body text-s7 group-hover:text-s9">⇄</span>
        </button>
      </div>

      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        aria-label="switch project"
        className="w-105"
      >
        <CapsLabel className="border-b border-s3 px-4 py-2.5">projects</CapsLabel>
        <div className="flex w-full flex-col gap-0.5 bg-s3 px-4 py-2.5 text-left">
          <span className="flex items-center gap-2 text-body font-[550] text-s11">
            {name}
            <span className="ml-auto font-mono text-caps text-s7">open</span>
          </span>
          {workspace?.root !== undefined && (
            <span className="truncate font-mono text-meta text-s7">{workspace.root}</span>
          )}
        </div>
        <MenuItem disabled className="border-t border-s4 px-4 py-2.5">
          open folder…
          <span className="ml-auto font-mono text-caps text-s6">arrives later</span>
        </MenuItem>
      </ModalShell>
    </>
  );
}

const HUDS = ['usage', 'account', 'flags'] as const;
type Hud = (typeof HUDS)[number];

/** The dashboard HUD: ‹ title › header, seamless picker above it (type-to-filter,
 *  arrow keys; the highlighted entry previews live on the panel below). */
function HudDash(): React.JSX.Element {
  const [hud, setHud] = useState<Hud>('usage');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const dashRef = useRef<HTMLDivElement>(null);
  useClickAway(dashRef, () => setOpen(false));
  useDismissLayer(open, () => setOpen(false));
  const state = useConsoleState((s) => s);

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
        {/* results stack above, the search row sits at the bottom — nearest the
            title that opened it (the card grows upward) */}
        {open && (
          <div
            className={cx(
              'absolute right-2 bottom-full left-2 z-(--z-dropdown) mb-1.5',
              menuSurface,
              'slip-enter py-0',
            )}
          >
            <div className="py-1">
              {hits.map((h, i) => (
                <MenuItem
                  key={h}
                  selected={h === hud}
                  onClick={() => commit(h)}
                  onMouseEnter={() => setHi(i)}
                  className={cx('px-3.5', h === highlighted && h !== hud && 'bg-s4 text-s12')}
                >
                  {h}
                </MenuItem>
              ))}
              {hits.length === 0 && <div className="px-3.5 py-1.5 text-code text-s7">no hud</div>}
            </div>
            <div className="flex items-center gap-2 border-t border-s5 px-3 py-1.5">
              <span className="text-body text-s7">⌕</span>
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
                className="w-full min-w-0 flex-1 bg-transparent text-sec text-s11 outline-none placeholder:text-s7"
              />
            </div>
          </div>
        )}

        {/* header row: ‹ title › — the title toggles the picker. The chevron
            glyphs render optically small, so they wear a raw 26px (no token
            exists for oversized glyph marks; the hit target stays h-9/w-9). */}
        <div className="flex items-center px-2 pb-1.5">
          <Tooltip label="previous hud" side="top">
            <button
              type="button"
              aria-label="previous hud"
              onClick={() => cycle(-1)}
              className="slip flex h-9 w-9 flex-none cursor-pointer items-center justify-center text-[26px] leading-none text-s7 hover:text-s11"
            >
              ‹
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={() => (open ? setOpen(false) : openPicker())}
            className="slip flex-1 cursor-pointer py-0.5 text-center text-caps tracking-[0.07em] text-s7 uppercase hover:text-s11"
          >
            {highlighted}
          </button>
          <Tooltip label="next hud" side="top">
            <button
              type="button"
              aria-label="next hud"
              onClick={() => cycle(1)}
              className="slip flex h-9 w-9 flex-none cursor-pointer items-center justify-center text-[26px] leading-none text-s7 hover:text-s11"
            >
              ›
            </button>
          </Tooltip>
        </div>
      </div>

      {/* while the picker is open, the panel previews the highlighted HUD */}
      {highlighted === 'usage' && <UsageHud state={state} />}
      {highlighted === 'account' && <AccountHud state={state} />}
      {highlighted === 'flags' && <FlagsHud state={state} />}
    </div>
  );
}

function FootButton({
  label,
  keys,
  onClick,
  children,
}: {
  label: string;
  keys?: string[] | undefined;
  onClick?: () => void;
  children: string;
}): React.JSX.Element {
  return (
    <Tooltip label={label} keys={keys} side="top">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="slip flex h-8 w-8 cursor-pointer items-center justify-center rounded-r2 text-icon text-s8 hover:bg-s3 hover:text-s10"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Kv({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-3 px-4 py-0.75 text-code text-s8">
      {k}
      <span className="ml-auto truncate font-mono text-meta text-s9">{v}</span>
    </div>
  );
}

/** One quiet line for a read that hasn't resolved — the HUD never shouts. */
function Unresolved({ text }: { text: string }): React.JSX.Element {
  return <div className="px-4 py-0.75 text-code text-s6">{text}</div>;
}

/** HUD content reads the real Remotes states-first, floors only — the surfaces
 *  pass redraws them. No fake history, no meter without a real cap total. */
function UsageHud({ state }: { state: ConsoleState | undefined }): React.JSX.Element {
  const cap = state?.data.cap;
  if (cap === undefined || cap.status === 'loading') return <Unresolved text="reading cap…" />;
  if (cap.status === 'error') return <Unresolved text="cap unavailable" />;
  const vm = toCapViewModel(cap.value);
  return (
    <>
      <Kv k="cap" v={vm.headline} />
      <Kv k="state" v={vm.sub} />
    </>
  );
}

function AccountHud({ state }: { state: ConsoleState | undefined }): React.JSX.Element {
  const accounts = state?.data.accounts;
  if (accounts === undefined || accounts.status === 'loading')
    return <Unresolved text="reading accounts…" />;
  if (accounts.status === 'error') return <Unresolved text="accounts unavailable" />;
  const active = Object.entries(accounts.value.active);
  if (active.length === 0) return <Unresolved text="ambient credentials" />;
  return (
    <>
      {active.map(([provider, label]) => (
        <Kv key={provider} k={provider} v={label} />
      ))}
    </>
  );
}

function FlagsHud({ state }: { state: ConsoleState | undefined }): React.JSX.Element {
  const flags = state?.data.flags;
  if (flags === undefined || flags.status === 'loading')
    return <Unresolved text="reading flags…" />;
  if (flags.status === 'error') return <Unresolved text="flags unavailable" />;
  const crit = flags.value.expanded.filter((f) => f.severity === 'crit').length;
  const advisory =
    flags.value.expanded.length - crit + flags.value.collapsed.reduce((n, c) => n + c.count, 0);
  return (
    <>
      <Kv k="critical" v={String(crit)} />
      <Kv k="advisory" v={String(advisory)} />
    </>
  );
}
