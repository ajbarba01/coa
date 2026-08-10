import { credentialsOf, poolHealth, type Credential } from './authStore.js';
import type { Range } from './format.js';
import { providerById } from './providers.js';

/**
 * Usage = spend + limits. No caps (out of scope this round).
 *
 * Honest degradation is the whole job here:
 *   · Claude alone publishes rate limits — and through an EXPERIMENTAL, explicitly-unstable
 *     SDK method, so "unknown" is a first-class state, not a bug.
 *   · Every other backend gets spend only. We never draw a bar we can't fill honestly.
 *   · Tool services have no meter at all; their real, knowable state is key health, which
 *     comes from coa's own circuit breaker.
 *   · On a subscription, the dollars were NEVER BILLED. We show the modelled API-equivalent
 *     cost — what the same work would have cost at API rates — because that is the number
 *     that lets you compare models and accounts. It is labelled as such everywhere it appears.
 *
 * ONE ledger, every number derived from it. Spend, the per-model split, and the chart are all
 * sums over the same daily series — so the range control genuinely moves them, and no two
 * figures on the surface can disagree.
 */

/** The mock ledger is 30 days deep, so `all` is 30 — an honest "everything we have", not an
 *  invented longer history. */
export const LEDGER_DAYS = 30;

export function daysIn(range: Range): number {
  if (range === 'today') return 1;
  if (range === '7d') return 7;
  return LEDGER_DAYS;
}

export interface LimitWindow {
  id: string;
  label: string;
  percent: number;
  resets: string;
}

/** Series index is the model's IDENTITY — fixed per model, never reassigned by rank, so a
 *  filter that drops a model never repaints the survivors. */
export interface ModelSpend {
  model: string;
  series: 1 | 2 | 3;
  tokens: string;
  cost: number;
}

export interface DaySpend {
  day: string;
  /** Cost per model, index-aligned to `byModel`. */
  costs: number[];
}

/** The one unknown a row must not sit quietly on: coa cannot read this login at all. Named
 *  so the row tests identity rather than the prose, which is free to be reworded. */
export const LIMITS_UNREADABLE = 'Limits unknown · re-login to read them';

export interface AccountUsage {
  credentialId: string;
  providerId: string;
  label: string;
  identity?: string;
  plan?: string;
  /** Absent ⇒ this provider publishes no limits API. `limitsUnknown` says why we have none. */
  limits?: LimitWindow[];
  limitsUnknown?: string;
  /** Modelled API-equivalent cost when `subscription` — see the file header. */
  spend: number;
  subscription: boolean;
  byModel: ModelSpend[];
  byDay: DaySpend[];
  tokens: string;
}

export interface ServiceUsage {
  providerId: string;
  healthy: number;
  cooling: number;
  disabled: number;
  /** coa's OWN invocation count. It is not the provider's quota — coa cannot see that. */
  calls?: number;
}

interface Fixture {
  limits?: LimitWindow[];
  models: { model: string; series: 1 | 2 | 3; perDay: number; tokensPerDollar: number }[];
  /** Deterministic day-to-day variation: a flat ledger looks fake, a random one is unstable. */
  rhythm: number[];
}

const FIXTURES: Record<string, Fixture> = {
  worm: {
    limits: [
      { id: '5h', label: '5-hour', percent: 0, resets: 'Resets 17:40' },
      { id: '7d', label: '7-day', percent: 52, resets: 'Resets Fri 07:00' },
      { id: '7d-opus', label: 'opus 7-day', percent: 78, resets: 'Resets Fri 07:00' },
    ],
    models: [
      { model: 'claude-opus-4-8', series: 1, perDay: 2.05, tokensPerDollar: 600_000 },
      { model: 'claude-sonnet-5', series: 2, perDay: 0.42, tokensPerDollar: 1_800_000 },
      { model: 'claude-haiku-4-5', series: 3, perDay: 0.11, tokensPerDollar: 14_000_000 },
    ],
    rhythm: [0.8, 0.45, 1.2, 1.5, 0.9, 0.35, 1.9],
  },
  school: {
    limits: [
      { id: '5h', label: '5-hour', percent: 12, resets: 'Resets 19:05' },
      { id: '7d', label: '7-day', percent: 4, resets: 'Resets Sun 09:00' },
      { id: '7d-opus', label: 'opus 7-day', percent: 0, resets: 'Resets Sun 09:00' },
    ],
    models: [{ model: 'claude-sonnet-5', series: 2, perDay: 0.05, tokensPerDollar: 1_800_000 }],
    rhythm: [0, 1.4, 0, 2.1, 0, 1.1, 0.3],
  },
  personal: {
    models: [{ model: 'claude-sonnet-5', series: 2, perDay: 0.02, tokensPerDollar: 1_800_000 }],
    rhythm: [1.6, 0, 0, 0.4, 0, 0, 0],
  },
  ds: {
    models: [{ model: 'deepseek-chat', series: 2, perDay: 0.05, tokensPerDollar: 1_400_000 }],
    rhythm: [0.6, 1.3, 0.4, 1.1, 0.8, 0, 0.7],
  },
  lc: { models: [], rhythm: [] },
};

const SERVICE_CALLS: Record<string, number> = { tavily: 1243, firecrawl: 318 };

/** Day 0 is today, counting back. The rhythm repeats, damped with age, so recent days carry
 *  the detail and older ones settle — the shape a real ledger has. */
function dayCost(fixture: Fixture, modelIndex: number, daysAgo: number): number {
  const model = fixture.models[modelIndex];
  if (model === undefined || fixture.rhythm.length === 0) return 0;
  const beat = fixture.rhythm[daysAgo % fixture.rhythm.length] ?? 0;
  const damp = 1 - Math.min(daysAgo, LEDGER_DAYS) / (LEDGER_DAYS * 2.2);
  return Math.round(model.perDay * beat * damp * 100) / 100;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Pure: one backend credential's usage over a range. An account with no fixture is not an
 *  error — it is an account with no history, and says $0.00 rather than inventing one. */
export function accountUsage(c: Credential, range: Range = 'today'): AccountUsage {
  const provider = providerById(c.providerId);
  const fixture = FIXTURES[c.label];
  const days = daysIn(range);
  // The chart always shows at least a week: one bar is not a shape you can read.
  const chartDays = Math.max(days, 7);
  const now = Date.now();

  const byModel: ModelSpend[] = (fixture?.models ?? []).map((m, i) => {
    let cost = 0;
    for (let d = 0; d < days; d++) cost += dayCost(fixture as Fixture, i, d);
    cost = Math.round(cost * 100) / 100;
    return {
      model: m.model,
      series: m.series,
      cost,
      tokens: formatTokens(cost * m.tokensPerDollar),
    };
  });

  const byDay: DaySpend[] = [];
  if (fixture !== undefined && fixture.models.length > 0) {
    for (let d = chartDays - 1; d >= 0; d--) {
      const date = new Date(now - d * 86_400_000);
      byDay.push({
        day: d === 0 ? 'today' : (DAY_NAMES[date.getDay()] ?? ''),
        costs: fixture.models.map((_m, i) => dayCost(fixture, i, d)),
      });
    }
  }

  const spend = Math.round(byModel.reduce((n, m) => n + m.cost, 0) * 100) / 100;
  const tokens = (fixture?.models ?? []).reduce(
    (n, m, i) => n + (byModel[i]?.cost ?? 0) * m.tokensPerDollar,
    0,
  );

  const usage: AccountUsage = {
    credentialId: c.id,
    providerId: c.providerId,
    label: c.label,
    spend,
    subscription: c.plan !== undefined,
    byModel,
    byDay,
    tokens: formatTokens(tokens),
  };
  if (c.identity !== undefined) usage.identity = c.identity;
  if (c.plan !== undefined) usage.plan = c.plan;

  // Three honest shapes, in priority order: a broken pointer can't be read at all; a provider
  // with no limits API has nothing to read; otherwise, the snapshot.
  if (c.expired === true) usage.limitsUnknown = LIMITS_UNREADABLE;
  else if (provider?.id !== 'claude') usage.limitsUnknown = 'No limits API · spend only';
  else if (fixture?.limits !== undefined) usage.limits = fixture.limits;
  else usage.limitsUnknown = 'Limits not read yet';

  return usage;
}

/** A benched provider is not serving, whatever its keys say — so its pool reads as benched,
 *  not as "1 healthy". */
export function serviceUsage(credentials: Credential[], providerId: string): ServiceUsage {
  const health = poolHealth(credentialsOf(credentials, providerId));
  const calls = SERVICE_CALLS[providerId];
  const usage: ServiceUsage = { providerId, ...health };
  if (calls !== undefined) usage.calls = calls;
  return usage;
}

/* --------------------------- the workspace aggregate --------------------------- */

/** A provider's series token is its IDENTITY — fixed here, never assigned by rank, so a
 *  range or view change can never repaint a provider. (Three shipped backends, three
 *  validated series tokens; a fourth backend is a palette decision, not a generated hue.) */
const PROVIDER_SERIES: Record<string, 1 | 2 | 3> = { claude: 1, deepseek: 2, longcat: 3 };

export interface WorkspaceSeries {
  providerId: string;
  series: 1 | 2 | 3;
  /** This provider's spend over the range — the legend doubles as the totals line. */
  spend: number;
}

export interface WorkspaceSpend {
  providers: WorkspaceSeries[];
  /** Cost per provider per day, index-aligned to `providers`. */
  byDay: DaySpend[];
  total: number;
}

/** Pure: every backend account folded into one daily series, stacked BY PROVIDER. Sums over
 *  the same per-account ledgers the rows show — the aggregate can never disagree with them. */
export function workspaceUsage(accounts: AccountUsage[]): WorkspaceSpend {
  const ids = [...new Set(accounts.map((a) => a.providerId))].filter((id) =>
    accounts.some((a) => a.providerId === id && a.byDay.length > 0),
  );
  const providers: WorkspaceSeries[] = ids.map((id) => ({
    providerId: id,
    series: PROVIDER_SERIES[id] ?? 3,
    spend:
      Math.round(
        accounts.filter((a) => a.providerId === id).reduce((n, a) => n + a.spend, 0) * 100,
      ) / 100,
  }));

  const depth = Math.max(0, ...accounts.map((a) => a.byDay.length));
  const byDay: DaySpend[] = [];
  for (let d = 0; d < depth; d++) {
    let day = '';
    const costs = ids.map((id) =>
      accounts
        .filter((a) => a.providerId === id)
        .reduce((n, a) => {
          const bucket = a.byDay[d];
          if (bucket === undefined) return n;
          day = bucket.day;
          return n + bucket.costs.reduce((c, x) => c + x, 0);
        }, 0),
    );
    byDay.push({ day, costs: costs.map((c) => Math.round(c * 100) / 100) });
  }

  const total = Math.round(providers.reduce((n, p) => n + p.spend, 0) * 100) / 100;
  return { providers, byDay, total };
}

export interface AccountSeries {
  credentialId: string;
  label: string;
  series: 1 | 2 | 3;
  spend: number;
}

export interface ScopedSpend {
  accounts: AccountSeries[];
  /** Cost per account per day, index-aligned to `accounts`. */
  byDay: DaySpend[];
  total: number;
}

/** Pure: ONE provider's accounts as an account-stacked daily series — the scoped chart's
 *  reading ("which login is eating it"). Bands follow account order (identity, never
 *  rank), and a fourth-plus account folds into an `other` band rather than minting a
 *  hue the palette doesn't have. */
export function accountStackedUsage(accounts: AccountUsage[]): ScopedSpend {
  const active = accounts.filter((a) => a.byDay.length > 0);
  const solo = active.length <= 3 ? active : active.slice(0, 2);
  const folded = active.length <= 3 ? [] : active.slice(2);

  const series: AccountSeries[] = solo.map((a, i) => ({
    credentialId: a.credentialId,
    label: a.label,
    series: (i + 1) as 1 | 2 | 3,
    spend: a.spend,
  }));
  if (folded.length > 0) {
    series.push({
      credentialId: 'other',
      label: 'other',
      series: 3,
      spend: Math.round(folded.reduce((n, a) => n + a.spend, 0) * 100) / 100,
    });
  }

  const dayTotal = (a: AccountUsage, d: number): number =>
    (a.byDay[d]?.costs ?? []).reduce((n, c) => n + c, 0);
  const depth = Math.max(0, ...active.map((a) => a.byDay.length));
  const byDay: DaySpend[] = [];
  for (let d = 0; d < depth; d++) {
    const costs = [
      ...solo.map((a) => dayTotal(a, d)),
      ...(folded.length > 0 ? [folded.reduce((n, a) => n + dayTotal(a, d), 0)] : []),
    ];
    byDay.push({
      day: active.map((a) => a.byDay[d]?.day).find((x) => x !== undefined && x !== '') ?? '',
      costs: costs.map((c) => Math.round(c * 100) / 100),
    });
  }

  const total = Math.round(accounts.reduce((n, a) => n + a.spend, 0) * 100) / 100;
  return { accounts: series, byDay, total };
}

/* ------------------------------- needs-you items ------------------------------- */

/** One honest exception. `door` is where clicking it takes you: an account dashboard
 *  (drill), or a service's key pool on auth. */
export interface AttentionItem {
  door: { kind: 'account'; credentialId: string } | { kind: 'keys'; providerId: string };
  title: string;
  detail: string;
  /** Present for limit items — lets the row carry the meter. */
  percent?: number;
}

/** A limit is news at 75% — below that, headroom is not an exception. */
export const ATTENTION_PERCENT = 75;

/** Pure: what genuinely needs a person, in urgency order — unreadable logins first (coa
 *  is blind there), then limits by how close they are to the wall. Empty when all is
 *  well: a healthy dashboard renders NO attention block, not a padded one. */
export function attentionItems(accounts: AccountUsage[]): AttentionItem[] {
  const logins: AttentionItem[] = [];
  const limits: AttentionItem[] = [];
  for (const a of accounts) {
    if (a.limitsUnknown === LIMITS_UNREADABLE) {
      logins.push({
        door: { kind: 'account', credentialId: a.credentialId },
        title: a.label,
        detail: 'Login expired · its limits cannot be read',
      });
    }
    for (const l of a.limits ?? []) {
      if (l.percent < ATTENTION_PERCENT) continue;
      limits.push({
        door: { kind: 'account', credentialId: a.credentialId },
        title: `${a.label} · ${l.label}`,
        detail: l.resets,
        percent: l.percent,
      });
    }
  }
  limits.sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  return [...logins, ...limits];
}

/** Pure: a degraded pool's exception line, or nothing while it serves cleanly. */
export function poolAttention(
  provider: { id: string; label: string },
  usage: ServiceUsage,
  enabled: boolean,
): AttentionItem | undefined {
  if (!enabled) {
    return {
      door: { kind: 'keys', providerId: provider.id },
      title: provider.label,
      detail: 'Benched · not serving',
    };
  }
  if (usage.healthy === 0) {
    return {
      door: { kind: 'keys', providerId: provider.id },
      title: provider.label,
      detail: 'No healthy keys',
    };
  }
  if (usage.cooling > 0) {
    return {
      door: { kind: 'keys', providerId: provider.id },
      title: provider.label,
      detail: `${usage.cooling} cooling · the breaker is holding traffic`,
    };
  }
  return undefined;
}

export function formatTokens(n: number): string {
  if (n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}
