import {
  BrandMark,
  Button,
  CapsLabel,
  FloatCard,
  Meter,
  StatusDot,
  Tooltip,
  cx,
  useDismissLayer,
} from '@coa/console-kit';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NO_DRAG } from '../shell/appRegion.js';
import { useShell } from '../shell/store.js';
import { RISE, SLIP_MOVE } from './motion.js';
import { addedProviders, chainPositions, credentialsOf, useMockAuth } from './mockAuth.js';
import {
  LIMITS_UNREADABLE,
  RANGES,
  RANGE_LABEL,
  accountStackedUsage,
  accountUsage,
  attentionItems,
  serviceUsage,
  usd,
  workspaceUsage,
  type AccountUsage,
  type AttentionItem,
  type DaySpend,
  type Range,
  type ServiceUsage,
} from './mockUsage.js';
import { providerById, type ProviderDescriptor } from './providers.js';
import { SurfaceEmpty } from './surfaceStates.js';
import {
  USAGE_VIEWS,
  USAGE_VIEW_LABEL,
  useAuthUi,
  useUsageUi,
  type UsageView,
} from './surfaceUi.js';
import { useNarrow } from './useNarrow.js';

/**
 * Usage — two readings, different enough to be two sub-views (the strip's toggle):
 *
 *   providers   dollars + limit windows. Aggregate first (the workspace's spend shape,
 *               stacked by provider), exceptions second (`needs you` renders only when
 *               something is honestly wrong), inventory third (the aligned-meter account
 *               rows), drill-down when wanted (the account dashboard).
 *   tools       key health — the only meter that is real for a service. Rows are doors
 *               to their key pools on auth.
 *
 * Nothing here is invented. Spend is coa's own ledger and every figure is a sum over the
 * SAME daily series (the aggregate folds the account ledgers, so no two numbers can
 * disagree). Limits are the one live snapshot Claude publishes — through an EXPERIMENTAL
 * method, so "unknown" renders as unknown. The range control lives WITH the reading it
 * moves — in the chart's block head, not up in the frame.
 */

/** The series token an identity owns — fixed per model/provider, never reassigned by rank. */
const SERIES: Record<1 | 2 | 3, string> = {
  1: 'bg-series-1',
  2: 'bg-series-2',
  3: 'bg-series-3',
};

/** Pure: the pool's health in words. A count of zero says nothing (the count law); a benched
 *  provider isn't serving at all, whatever its keys say. */
export function healthWords(usage: ServiceUsage, enabled: boolean): string {
  if (!enabled) return 'Benched';
  const parts: string[] = [];
  if (usage.healthy > 0) parts.push(`${usage.healthy} healthy`);
  if (usage.cooling > 0) parts.push(`${usage.cooling} cooling`);
  if (usage.disabled > 0) parts.push(`${usage.disabled} benched`);
  return parts.join(' · ') || 'No keys';
}

/** The accounts, as usage — one hook, so the strip, the canvas and the HUD share a reading. */
function useAccounts(range: Range): AccountUsage[] {
  const credentials = useMockAuth((s) => s.credentials);
  return useMemo(
    () =>
      credentials
        .filter((c) => providerById(c.providerId)?.group === 'backend')
        .map((c) => accountUsage(c, range)),
    [credentials, range],
  );
}

/* ------------------------------- the title-bar strip ------------------------------- */

/** The title bar IS the surface's own chrome (chat's strip is its tabs; usage's is the view
 *  toggle and the figure that matches it). Rendered by the shell into the title-bar segment —
 *  hence the drag opt-out. */
export function UsageStrip(): React.JSX.Element {
  const view = useUsageUi((s) => s.view);
  const setView = useUsageUi((s) => s.setView);
  const range = useUsageUi((s) => s.range);
  const opened = useUsageUi((s) => s.opened);
  const open = useUsageUi((s) => s.open);
  const added = useMockAuth((s) => s.added);
  const credentials = useMockAuth((s) => s.credentials);
  const accounts = useAccounts(range);
  const account =
    view === 'providers' ? accounts.find((a) => a.credentialId === opened) : undefined;
  const total = accounts.reduce((n, a) => n + a.spend, 0);
  const calls = addedProviders(added, 'service').reduce(
    (n, p) => n + (serviceUsage(credentials, p.id).calls ?? 0),
    0,
  );

  return (
    <>
      <div className="flex min-w-0 items-center gap-2.5 px-4" style={NO_DRAG}>
        {account === undefined ? (
          <>
            <span className="font-mono text-meta tracking-[0.06em] text-s9">Usage</span>
            {view === 'providers' ? (
              <span className="font-mono text-sec text-s11">{usd(total)}</span>
            ) : (
              calls > 0 && (
                <span className="font-mono text-sec text-s11">
                  {calls.toLocaleString()} <span className="text-meta text-s7">calls</span>
                </span>
              )
            )}
          </>
        ) : (
          <>
            <Button variant="text" onClick={() => open(undefined)}>
              ‹ Usage
            </Button>
            <span className="truncate text-sec font-[550] text-s12">{account.label}</span>
            <span className="truncate font-mono text-meta text-s7">
              {account.plan ?? providerById(account.providerId)?.label}
            </span>
          </>
        )}
      </div>
      <div className="flex-1" />
      {/* The toggle stands down while a dashboard is open — the strip is carrying the way
          back, and a drill-down belongs to exactly one view. */}
      {account === undefined && (
        <div className="flex items-center pr-3" style={NO_DRAG}>
          <Segmented
            options={VIEW_OPTIONS}
            value={view}
            onChange={(v) => setView(v as UsageView)}
            layoutId="usage-view"
          />
        </div>
      )}
    </>
  );
}

/** A segmented control, not a row of buttons: one track, and the selection is a tile that
 *  SLIDES between cells (layoutId) — the multi-state control the console already implies.
 *  `layoutId` must be unique per instance, or the tile flies between controls.
 *  Options are value/label pairs so a cell can be cased without recasing the view state. */
function Segmented({
  options,
  value,
  onChange,
  layoutId,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
  layoutId: string;
}): React.JSX.Element {
  return (
    <div className="flex gap-0.5 rounded-r2 border border-s4 bg-s2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'slip relative cursor-pointer rounded-r1 px-2.5 py-0.5 text-code',
            o.value === value ? 'text-s12' : 'text-s8 hover:text-s11',
          )}
        >
          {o.value === value && (
            <motion.span
              layoutId={`${layoutId}-tile`}
              aria-hidden
              className="absolute inset-0 rounded-r1 bg-s4"
              transition={SLIP_MOVE}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }));
const VIEW_OPTIONS = USAGE_VIEWS.map((v) => ({ value: v, label: USAGE_VIEW_LABEL[v] }));

/* ---------------------------------- the surface ---------------------------------- */

/** The usage surface. Everything it renders is MOCK DATA BY DESIGN — the reads come
 *  from mockUsage.ts, the renderer-owned stand-in — and wiring it to real backend
 *  usage reads is roadmap work, not a bug here. */
export function UsageSurface(): React.JSX.Element {
  const view = useUsageUi((s) => s.view);
  const range = useUsageUi((s) => s.range);
  const opened = useUsageUi((s) => s.opened);
  const open = useUsageUi((s) => s.open);
  const accounts = useAccounts(range);

  // Usage reads the SAME live credential store the auth surface hydrates — a mount here
  // must not depend on the user having visited auth first (idempotent, mirrors AuthSurface).
  // Advisory by design: a failed read degrades to whatever the store already held.
  useEffect(() => {
    void useMockAuth
      .getState()
      .hydrate()
      .catch(() => {});
  }, []);
  const account =
    view === 'providers' ? accounts.find((a) => a.credentialId === opened) : undefined;

  // A drill-in is a layer: Escape leaves it, through the kit's ONE Escape authority (so it can
  // never fight the composer's stop, or a dialog above it).
  useDismissLayer(account !== undefined, () => open(undefined));

  return (
    // No `mode="wait"`: the panes cross-fade CONCURRENTLY. Waiting for the exit first would
    // make one 180ms transition read as 360ms — the sluggishness is sequencing, not duration.
    // The layer is absolute so the outgoing pane doesn't push the incoming one down mid-fade.
    <div className="relative min-h-0 flex-1">
      <AnimatePresence initial={false}>
        {account !== undefined ? (
          <motion.div
            key={account.credentialId}
            className="absolute inset-0 flex flex-col"
            {...RISE}
          >
            <AccountDashboard account={account} range={range} />
          </motion.div>
        ) : view === 'providers' ? (
          <motion.div key="providers" className="absolute inset-0 flex flex-col" {...RISE}>
            <ProvidersOverview accounts={accounts} range={range} />
          </motion.div>
        ) : (
          <motion.div key="tools" className="absolute inset-0 flex flex-col" {...RISE}>
            <ToolsView />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------- the providers view ------------------------------- */

/** Aggregate first, exceptions second, inventory third. The overview leads with the
 *  workspace's spend shape; `needs you` exists only while something is honestly wrong;
 *  the account rows keep their aligned meters (comparing three logins stays a glance).
 *  The icon rail narrows the WHOLE reading to any combination of providers — and with
 *  exactly one selected the chart re-stacks by account, the question "all" cannot answer. */
function ProvidersOverview({
  accounts,
  range,
}: {
  accounts: AccountUsage[];
  range: Range;
}): React.JSX.Element {
  const setRange = useUsageUi((s) => s.setRange);
  const scopes = useUsageUi((s) => s.scopes);
  const toggleScope = useUsageUi((s) => s.toggleScope);
  const added = useMockAuth((s) => s.added);

  // Three meters + an identity + a figure need room. Below that, the row shows the ONE meter
  // that matters (the closest to its limit) rather than three illegible ones stacked on top of
  // each other — the dashboard still has all of them. The rail lies down at the same point.
  const paneRef = useRef<HTMLDivElement>(null);
  const tight = useNarrow(paneRef, 760);

  const backends = addedProviders(added, 'backend');
  // A removed provider must not leave the view scoped to a ghost; none selected = all.
  const selected = scopes.filter((id) => backends.some((p) => p.id === id));
  const scoped =
    selected.length === 0 ? accounts : accounts.filter((a) => selected.includes(a.providerId));

  // Provider-stacked (fixed identity hues) — except exactly ONE provider selected, where the
  // same ledgers re-cut by ACCOUNT to answer "which login is eating it".
  const chart =
    selected.length === 1
      ? (() => {
          const s = accountStackedUsage(scoped);
          return {
            series: s.accounts.map((a) => ({
              key: a.credentialId,
              label: a.label,
              tone: a.series,
              total: a.spend,
            })),
            days: s.byDay,
          };
        })()
      : (() => {
          const w = workspaceUsage(scoped);
          return {
            series: w.providers.map((p) => ({
              key: p.providerId,
              label: providerById(p.providerId)?.label ?? p.providerId,
              tone: p.series,
              total: p.spend,
            })),
            days: w.byDay,
          };
        })();

  const attention = attentionItems(scoped);

  if (accounts.length === 0) {
    return <SurfaceEmpty title="Nothing to meter" hint="Add a provider on the auth surface." />;
  }

  const tiles = (
    <ScopeTiles
      backends={backends}
      accounts={accounts}
      selected={selected}
      toggle={toggleScope}
      horizontal={tight}
    />
  );

  return (
    <div ref={paneRef} className="flex min-h-0 flex-1">
      {!tight && tiles}
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-8">
        <div className="mx-auto max-w-220">
          {tight && <div className="pb-4">{tiles}</div>}

          <SectionHead
            caption={
              selected.length === 1
                ? `Spend · ${providerById(selected[0] ?? '')?.label ?? selected[0]}`
                : 'Spend'
            }
            right={
              <Segmented
                options={RANGE_OPTIONS}
                value={range}
                onChange={(r) => setRange(r as Range)}
                layoutId="overview-range"
              />
            }
          />
          {chart.days.length === 0 ? (
            <div className="py-6 text-sec text-s7">Nothing has run yet</div>
          ) : (
            <StackedDayChart
              series={chart.series}
              days={chart.days}
              emphasizeLast={range === 'today'}
            />
          )}

          <AnimatePresence initial={false}>
            {attention.length > 0 && (
              <motion.div key="attention" {...RISE} className="pt-8">
                <SectionHead caption="Needs you" right={`${attention.length} to look at`} />
                {attention.map((item) => (
                  <AttentionRow key={`${item.title}:${item.detail}`} item={item} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="pt-8">
            <SectionHead
              caption="Accounts"
              right={range === 'today' ? 'Limits live · spend today' : `Spend over ${range}`}
            />
            {scoped.map((a) => (
              <AccountRow key={a.credentialId} account={a} tight={tight} />
            ))}
            {scoped.length === 0 && (
              <div className="py-4 text-sec text-s7">
                No logins yet. Add one on the auth surface.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The scope rail: one icon tile per backend — its mark, its spend, its name in the
 *  tooltip. A SCOPE control, not navigation: toggle any combination; none selected reads
 *  as all. Lies down into a row when the pane is tight. */
function ScopeTiles({
  backends,
  accounts,
  selected,
  toggle,
  horizontal,
}: {
  backends: ProviderDescriptor[];
  accounts: AccountUsage[];
  selected: string[];
  toggle: (providerId: string) => void;
  horizontal: boolean;
}): React.JSX.Element {
  const spendOf = (id: string): number =>
    accounts.filter((a) => a.providerId === id).reduce((n, a) => n + a.spend, 0);

  return (
    // Centered on the pane's cross axis: the rail is a small instrument panel beside the
    // reading, not a list that happens to start at the top.
    <div
      className={cx(
        'flex gap-1.5',
        horizontal
          ? 'flex-wrap'
          : 'w-20 flex-none flex-col justify-center overflow-y-auto py-6 pl-6',
      )}
    >
      {backends.map((p) => {
        const on = selected.includes(p.id);
        const spend = spendOf(p.id);
        return (
          <Tooltip key={p.id} label={p.label} side={horizontal ? 'bottom' : 'right'}>
            <button
              type="button"
              aria-pressed={on}
              // Named for what the click DOES — the mark's own img label stays out of it.
              aria-label={`Scope ${p.label}`}
              onClick={() => toggle(p.id)}
              // The retired filter row's chip vocabulary (border + press), so the tile
              // reads as the toggle it is, not as a decorated logo.
              className={cx(
                'slip slip-press flex cursor-pointer flex-col items-center gap-1 rounded-r2 border px-2.5 py-2 active:scale-[0.97]',
                on ? 'border-s7 bg-s4' : 'border-s4 bg-s2 hover:border-s6',
              )}
            >
              <BrandMark spec={p.mark} />
              <span
                className={cx(
                  'font-mono text-meta',
                  on ? 'text-s10' : spend > 0 ? 'text-s8' : 'text-s6',
                )}
              >
                {usd(spend)}
              </span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** One honest exception, and the door to fixing it. */
function AttentionRow({ item }: { item: AttentionItem }): React.JSX.Element {
  const open = useUsageUi((s) => s.open);
  const setSurface = useShell((s) => s.setSurface);
  const select = useAuthUi((s) => s.select);

  const go = (): void => {
    if (item.door.kind === 'account') open(item.door.credentialId);
    else {
      select(item.door.providerId);
      setSurface('auth');
    }
  };

  return (
    <button
      type="button"
      onClick={go}
      className="slip group -mx-3 flex w-[calc(100%+24px)] cursor-pointer items-center gap-3 rounded-r3 px-3 py-2 text-left hover:bg-s2"
    >
      <StatusDot
        status={item.percent === undefined || item.percent >= 90 ? 'critical' : 'needs-you'}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sec text-s11">{item.title}</span>
        <span className="block truncate font-mono text-meta text-s7">{item.detail}</span>
      </span>
      {item.percent !== undefined && (
        <span className="w-28 flex-none">
          <Meter percent={item.percent} aria-label={item.title} />
        </span>
      )}
      {item.percent !== undefined && (
        <span className="w-10 flex-none text-right font-mono text-code text-s11">
          {item.percent}%
        </span>
      )}
      <span className="slip flex-none font-mono text-meta text-s7 opacity-0 group-hover:opacity-100">
        ›
      </span>
    </button>
  );
}

function SectionHead({
  caption,
  right,
}: {
  caption: string;
  right?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 pb-1.5">
      <CapsLabel className="px-0 pt-0">{caption}</CapsLabel>
      {right !== undefined && <span className="ml-auto font-mono text-meta text-s7">{right}</span>}
    </div>
  );
}

/** One account, one row. The meters line up down the column — that alignment IS the feature.
 *  An inset pill (the session-browser's row idiom), not a table rule. */
function AccountRow({
  account,
  tight,
}: {
  account: AccountUsage;
  tight: boolean;
}): React.JSX.Element {
  const open = useUsageUi((s) => s.open);
  const provider = providerById(account.providerId);
  // Which window is closest to being spent — the one worth the space when there is only room
  // for one.
  const worst = [...(account.limits ?? [])].sort((a, b) => b.percent - a.percent)[0];
  const shown = tight && worst !== undefined ? [worst] : (account.limits ?? []);
  // A login coa cannot read at all is the one state this row must not sit quietly on.
  const blind = account.limitsUnknown === LIMITS_UNREADABLE;

  return (
    <button
      type="button"
      onClick={() => open(account.credentialId)}
      className="slip group -mx-3 flex w-[calc(100%+24px)] cursor-pointer items-center gap-4 rounded-r3 px-3 py-2.5 text-left hover:bg-s2"
    >
      <div className="flex min-w-0 flex-[2] items-center gap-2.5">
        {provider !== undefined && <BrandMark spec={provider.mark} />}
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sec text-s11">
            <span className="truncate">{account.label}</span>
            {account.plan !== undefined && (
              <span className="flex-none font-mono text-caps text-s7">
                {account.plan.replace('Claude ', '')}
              </span>
            )}
          </span>
          <span className="block truncate font-mono text-meta text-s7">
            {account.identity ?? provider?.label}
          </span>
        </span>
      </div>

      {account.limits !== undefined ? (
        <div className="flex min-w-0 flex-[3] gap-5">
          {shown.map((l) => (
            // A meter needs a floor of width to BE a meter; below it the label and the figure
            // collide, which is what a squeezed pane used to do here.
            <div key={l.id} className="min-w-24 flex-1">
              <div className="mb-1.5 flex items-baseline gap-1.5">
                <span className="truncate font-mono text-meta text-s7">{l.label}</span>
                <span className="ml-auto font-mono text-code text-s10">{l.percent}%</span>
              </div>
              <Meter percent={l.percent} aria-label={`${account.label} ${l.label}`} />
            </div>
          ))}
          {tight && (account.limits.length ?? 0) > 1 && (
            <span className="flex-none self-center font-mono text-meta text-s7">
              +{account.limits.length - 1}
            </span>
          )}
        </div>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-code text-s7">
          <StatusDot status={blind ? 'critical' : 'idle'} />
          <span className="truncate">{account.limitsUnknown}</span>
        </span>
      )}

      <span className="flex w-20 flex-none items-baseline justify-end gap-2">
        <span className={cx('font-mono text-sec', account.spend > 0 ? 'text-s11' : 'text-s7')}>
          {usd(account.spend)}
        </span>
        {/* The affordance appears on approach — the row is a reading first, a door second. */}
        <span className="slip font-mono text-meta text-s7 opacity-0 group-hover:opacity-100">
          ›
        </span>
      </span>
    </button>
  );
}

/* --------------------------------- the tools view --------------------------------- */

/** Key health is a service's only real meter — so this view leads with the pools, and every
 *  row is a door to its keys on auth (a service has no dashboard of its own). */
function ToolsView(): React.JSX.Element {
  const added = useMockAuth((s) => s.added);
  const credentials = useMockAuth((s) => s.credentials);
  const chains = useMockAuth((s) => s.chains);
  const services = addedProviders(added, 'service');

  if (services.length === 0) {
    return <SurfaceEmpty title="No tool services" hint="Add one on the auth surface." />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-8">
      <div className="mx-auto max-w-220">
        <SectionHead caption="Tool services" right="Key health · coa's circuit breaker" />
        {services.map((p) => (
          <ServiceRow
            key={p.id}
            provider={p}
            usage={serviceUsage(credentials, p.id)}
            positions={chainPositions(chains, p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ServiceRow({
  provider,
  usage,
  positions,
}: {
  provider: ProviderDescriptor;
  usage: ServiceUsage;
  positions: string[];
}): React.JSX.Element {
  const enabled = useMockAuth((s) => s.enabled[provider.id] ?? true);
  const all = useMockAuth((s) => s.credentials);
  const credentials = credentialsOf(all, provider.id);
  const setSurface = useShell((s) => s.setSurface);
  const select = useAuthUi((s) => s.select);

  // A service has no dashboard of its own — its detail IS its key pool, which lives on auth. So
  // the row is a door to exactly that, rather than a dead line stapled to the end of the page.
  const openInAuth = (): void => {
    select(provider.id);
    setSurface('auth');
  };

  return (
    <button
      type="button"
      // Named for what the click DOES: the row and its view both say "tavily", and only
      // one of them opens the key pool.
      aria-label={`${provider.label} keys`}
      onClick={openInAuth}
      className={cx(
        'slip group -mx-3 flex w-[calc(100%+24px)] cursor-pointer items-center gap-4 rounded-r3 px-3 py-2.5 text-left hover:bg-s2',
        !enabled && 'opacity-45',
      )}
    >
      <div className="flex min-w-0 flex-[2] items-center gap-2.5">
        <BrandMark spec={provider.mark} muted={!enabled} />
        <span className="min-w-0">
          <span className="block truncate text-sec text-s11">{provider.label}</span>
          <span className="block truncate font-mono text-meta text-s7">
            {positions.join(' · ') || 'In no chain'}
          </span>
        </span>
      </div>

      {/* Pips are the pool's SHAPE; the words are the reading. The words get their own space so
          a fat pool can never squeeze them out (it did, at seven keys). */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex flex-none items-center gap-1">
          {credentials.map((c) => (
            <span
              key={c.id}
              aria-hidden
              className={cx(
                'h-1.5 w-3.5 flex-none',
                c.disabled ? 'bg-s5' : c.coolingSec !== undefined ? 'bg-warn' : 'bg-ok',
              )}
            />
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-code text-s9">
          {healthWords(usage, enabled)}
        </span>
      </div>

      <span className="flex w-20 flex-none items-baseline justify-end gap-1.5">
        <span className="font-mono text-sec text-s10">
          {usage.calls === undefined ? '—' : usage.calls.toLocaleString()}
        </span>
        <span className="font-mono text-meta text-s7">calls</span>
      </span>
      <span className="slip flex-none font-mono text-meta text-s7 opacity-0 group-hover:opacity-100">
        Keys ›
      </span>
    </button>
  );
}

/* ------------------------------ the account dashboard ------------------------------ */

function AccountDashboard({
  account,
  range,
}: {
  account: AccountUsage;
  range: Range;
}): React.JSX.Element {
  const setRange = useUsageUi((s) => s.setRange);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-8">
      <div className="mx-auto flex max-w-220 flex-col gap-7 lg:flex-row lg:gap-8">
        <div className="min-w-0 flex-1">
          <SectionHead
            caption="Spend by day"
            right={
              <Segmented
                options={RANGE_OPTIONS}
                value={range}
                onChange={(r) => setRange(r as Range)}
                layoutId="account-range"
              />
            }
          />
          {account.byDay.length === 0 ? (
            <div className="py-6 text-sec text-s7">This account has not run a turn yet</div>
          ) : (
            <StackedDayChart
              series={account.byModel.map((m) => ({
                key: m.model,
                label: m.model.replace(/^(claude|deepseek)-/, ''),
                tone: m.series,
              }))}
              days={account.byDay}
              emphasizeLast={range === 'today'}
            />
          )}

          <div className="pt-8">
            <SectionHead
              caption={`By model · ${range}`}
              right={`${account.tokens} tokens · modelled cost`}
            />
            {account.byModel.map((m) => {
              const top = Math.max(...account.byModel.map((x) => x.cost), 0.01);
              return (
                <div
                  key={m.model}
                  className="slip -mx-3 flex items-center gap-3 rounded-r3 px-3 py-2 hover:bg-s2"
                >
                  <span className={cx('h-2 w-2 flex-none', SERIES[m.series])} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono text-code text-s10">
                    {m.model}
                  </span>
                  <span className="h-1 w-24 flex-none overflow-hidden bg-s4">
                    <span
                      className={cx('slip-move block h-full', SERIES[m.series])}
                      style={{ width: `${Math.max((m.cost / top) * 100, 2)}%` }}
                    />
                  </span>
                  <span className="w-16 flex-none text-right font-mono text-meta text-s7">
                    {m.tokens}
                  </span>
                  <span className="w-16 flex-none text-right font-mono text-code text-s11">
                    {usd(m.cost)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-full flex-none lg:w-56">
          <SectionHead caption="Limits now" right={account.limits ? 'Experimental' : undefined} />
          {account.limits === undefined ? (
            <div className="flex items-start gap-2 py-1 text-code text-s7">
              <span className="pt-1">
                <StatusDot status="idle" />
              </span>
              <span>{account.limitsUnknown}</span>
            </div>
          ) : (
            account.limits.map((l) => (
              <div key={l.id} className="pt-3.5 first:pt-1.5">
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="text-sec text-s10">{l.label}</span>
                  <span className="ml-auto font-mono text-code text-s11">{l.percent}%</span>
                </div>
                <Meter percent={l.percent} aria-label={`${account.label} ${l.label}`} />
                <div className="mt-1.5 font-mono text-meta text-s7">{l.resets}</div>
              </div>
            ))
          )}

          {account.subscription && (
            // The one honesty this whole surface turns on — a quiet line, not a callout box.
            <div className="mt-7 border-t border-s3 pt-3 text-code leading-relaxed text-s7">
              <span className="text-s9">These dollars were never billed.</span> {account.label} is a
              flat-fee {account.plan} subscription. This is the modelled API-equivalent cost of what
              you ran, so models and accounts stay comparable. The real ceiling is the limits above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- the day chart ---------------------------------- */

interface ChartSeries {
  key: string;
  label: string;
  tone: 1 | 2 | 3;
  /** Present ⇒ the legend doubles as the totals line (a reading, not furniture). */
  total?: number;
}

/** Spend per day, stacked. Bars, not a line: the days are discrete buckets and the question
 *  is "how much, split how" — magnitude and composition. Identity is carried by the legend
 *  and the hover card, never by color alone. With `emphasizeLast` (the `today` range) the
 *  padding days recede and today carries the ink — emphasis, not a filtered-away history. */
function StackedDayChart({
  series,
  days,
  emphasizeLast = false,
}: {
  series: ChartSeries[];
  days: DaySpend[];
  emphasizeLast?: boolean;
}): React.JSX.Element {
  // The hovered bar's SCREEN rect, not just its index: the card is portaled to the body and
  // positioned fixed, because a card anchored inside this pane is clipped by the pane's own
  // scroll container (and by the title bar and the dock beyond it).
  const [hover, setHover] = useState<{ i: number; rect: DOMRect }>();
  const totals = days.map((d) => d.costs.reduce((n, c) => n + c, 0));
  const peak = Math.max(...totals, 0.01);
  const dense = days.length > 10;
  const day = hover === undefined ? undefined : days[hover.i];
  const hoverTotal = hover === undefined ? 0 : (totals[hover.i] ?? 0);

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      {/* One series needs no legend — the block's title names it (the dataviz rule). */}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {series.map((m) => (
            <span key={m.key} className="flex items-center gap-1.5 font-mono text-meta text-s8">
              <span className={cx('h-2 w-2', SERIES[m.tone])} aria-hidden />
              {m.label}
              {m.total !== undefined && <span className="text-s10">{usd(m.total)}</span>}
            </span>
          ))}
        </div>
      )}

      <div className="relative flex h-36 items-end gap-1">
        {days.map((d, i) => {
          const total = totals[i] ?? 0;
          const on = hover?.i === i;
          const receded = hover !== undefined ? !on : emphasizeLast && i !== days.length - 1;
          return (
            <div
              key={`${d.day}-${i}`}
              className="slip group relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end"
              onMouseEnter={(e) => setHover({ i, rect: e.currentTarget.getBoundingClientRect() })}
              onMouseLeave={() => setHover(undefined)}
            >
              <div
                className={cx(
                  'slip flex w-full flex-col justify-end gap-px',
                  receded && 'opacity-55',
                )}
                style={{ height: `${Math.max((total / peak) * 100, total > 0 ? 2 : 0)}%` }}
              >
                {/* Segments run in fixed series order, so an identity is always the same band;
                    the 1px gap between them keeps the boundary legible at this scale. */}
                {[...d.costs]
                  .map((cost, s) => ({ cost, tone: series[s]?.tone ?? 3 }))
                  .reverse()
                  .map(({ cost, tone }, k) =>
                    cost <= 0 ? undefined : (
                      <span
                        key={k}
                        className={cx('block w-full', SERIES[tone])}
                        style={{ height: `${(cost / Math.max(total, 0.01)) * 100}%` }}
                      />
                    ),
                  )}
              </div>
              {(!dense || i % 5 === 0 || i === days.length - 1) && (
                <span
                  className={cx(
                    'slip mt-2 block truncate text-center font-mono text-meta',
                    on ? 'text-s10' : 'text-s7',
                  )}
                >
                  {d.day}
                </span>
              )}
              {dense && !(i % 5 === 0 || i === days.length - 1) && (
                <span className="mt-2 block h-3.25" aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      {/* The kit's viewport-safe hover panel: it measures itself, flips below the bar when
          the window top would clip it, and clamps to the screen on both axes. */}
      {hover !== undefined && day !== undefined && hoverTotal > 0 && (
        <FloatCard anchor={hover.rect} className="w-44">
          <div className="mb-1.5 font-mono text-meta text-s7">{day.day}</div>
          {day.costs.map((cost, s) => {
            const m = series[s];
            if (m === undefined || cost <= 0) return undefined;
            return (
              <div key={m.key} className="flex items-center gap-2 py-0.5 text-code">
                <span className={cx('h-2 w-2 flex-none', SERIES[m.tone])} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-s10">{m.label}</span>
                <span className="font-mono text-s11">{usd(cost)}</span>
              </div>
            );
          })}
          <div className="mt-1.5 flex border-t border-s5 pt-1.5 text-code">
            <span className="flex-1 text-s9">Total</span>
            <span className="font-mono font-semibold text-s12">{usd(hoverTotal)}</span>
          </div>
        </FloatCard>
      )}
    </div>
  );
}
