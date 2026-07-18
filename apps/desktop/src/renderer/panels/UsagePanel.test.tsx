// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { UsageStrip, UsageSurface, healthWords } from './UsagePanel.js';
import { useMockAuth, type Credential } from './mockAuth.js';
import {
  accountStackedUsage,
  accountUsage,
  attentionItems,
  hudRows,
  poolAttention,
  useUsageHud,
  workspaceUsage,
  type AccountUsage,
} from './mockUsage.js';
import { useAuthUi, useUsageUi } from './surfaceUi.js';
import { useShell } from '../shell/store.js';

// The store is empty until `hydrate()` resolves (Task 10 — live daemon reads). This file
// never mocks `../console.js`, so the surface's mount-time `hydrate()` fires the REAL
// `rpcAuthView` against an absent `window.coa` in jsdom, rejects, and is swallowed (SC-1,
// see AuthPanel/UsagePanel's mount effects) — leaving whatever this fixture seeds directly
// below untouched. Usage stays Phase 2 mock: these are rendering assertions against a known
// credential set, not RPC wiring (that's AuthPanel.test.tsx's job).
const EMPTY_STATE = useMockAuth.getState();
const FIXTURE_CREDENTIALS: Credential[] = [
  {
    id: 'x',
    providerId: 'claude',
    label: 'worm',
    masked: '~/.claude',
    identity: 'wormsegment1000@gmail.com',
    plan: 'Claude Pro',
    disabled: false,
  },
  {
    id: 'y',
    providerId: 'claude',
    label: 'school',
    masked: '~/.claude-school',
    identity: 'alex@barba.edu',
    plan: 'Claude Pro',
    disabled: false,
  },
  {
    id: 'z',
    providerId: 'claude',
    label: 'personal',
    masked: '~/.claude-personal',
    expired: true,
    disabled: false,
  },
  { id: 'd', providerId: 'deepseek', label: 'ds', masked: 'sk-9…4f1', disabled: false },
  { id: 'l', providerId: 'longcat', label: 'lc', masked: 'lc-2…c07', disabled: false },
  { id: 't', providerId: 'tavily', label: 'tavily-1', masked: 'tvly…8f2', disabled: false },
];
const FIXTURE_ADDED = ['claude', 'deepseek', 'longcat', 'tavily'];
const FIXTURE_ENABLED = { claude: true, deepseek: true, longcat: true, tavily: true };
const HUD_SEED = useUsageHud.getState();
const UI_SEED = useUsageUi.getState();
const AUTH_UI_SEED = useAuthUi.getState();
beforeEach(() => {
  useMockAuth.setState(EMPTY_STATE, true);
  useMockAuth.setState({
    added: FIXTURE_ADDED,
    credentials: FIXTURE_CREDENTIALS,
    enabled: FIXTURE_ENABLED,
  });
  useUsageHud.setState(HUD_SEED, true);
  useUsageUi.setState(UI_SEED, true);
  useAuthUi.setState(AUTH_UI_SEED, true);
  useShell.getState().setSurface('usage');
});

/** The strip is part of the surface — it carries the range control and the running total. */
function renderUsage(): void {
  render(
    <>
      <UsageStrip />
      <UsageSurface />
    </>,
  );
}

const credential = (over: Partial<Credential> = {}): Credential => ({
  id: 'x',
  providerId: 'claude',
  label: 'worm',
  masked: '~/.claude',
  disabled: false,
  ...over,
});

describe('honest degradation', () => {
  it('gives Claude its limits and everyone else spend only', () => {
    const claude = accountUsage(credential({ plan: 'Claude Pro' }));
    const deepseek = accountUsage(credential({ providerId: 'deepseek', label: 'ds' }));
    expect(claude.limits?.length).toBe(3);
    expect(deepseek.limits).toBeUndefined();
    expect(deepseek.limitsUnknown).toBe('no limits API — spend only');
  });

  it('says a broken login is unreadable rather than showing zeros', () => {
    const expired = accountUsage(credential({ label: 'personal', expired: true }));
    expect(expired.limits).toBeUndefined();
    expect(expired.limitsUnknown).toMatch(/re-login/);
  });

  it('gives a brand-new account no history instead of borrowing someone else’s', () => {
    const fresh = accountUsage(credential({ providerId: 'deepseek', label: 'just-added' }));
    expect(fresh.spend).toBe(0);
    expect(fresh.byModel).toEqual([]);
    expect(fresh.byDay).toEqual([]);
  });

  it('flags a subscription’s dollars as modelled, never billed', () => {
    expect(accountUsage(credential({ plan: 'Claude Pro' })).subscription).toBe(true);
    expect(accountUsage(credential({ providerId: 'deepseek', label: 'ds' })).subscription).toBe(
      false,
    );
  });

  it('says a pool’s health in words, and a benched provider is not "healthy"', () => {
    const pool = { providerId: 'tavily', healthy: 5, cooling: 1, disabled: 1 };
    expect(healthWords(pool, true)).toBe('5 healthy · 1 cooling · 1 benched');
    // A benched provider serves nothing, whatever its keys say.
    expect(
      healthWords({ providerId: 'parallel', healthy: 1, cooling: 0, disabled: 0 }, false),
    ).toBe('benched');
  });
});

describe('the range control moves the numbers', () => {
  it('sums more of the same ledger as the range widens — never a different series', () => {
    const today = accountUsage(credential({ plan: 'Claude Pro' }), 'today');
    const week = accountUsage(credential({ plan: 'Claude Pro' }), '7d');
    const month = accountUsage(credential({ plan: 'Claude Pro' }), '30d');
    expect(week.spend).toBeGreaterThan(today.spend);
    expect(month.spend).toBeGreaterThan(week.spend);
  });

  it('keeps the account total equal to the sum of its models — no two figures disagree', () => {
    const a = accountUsage(credential({ plan: 'Claude Pro' }), '7d');
    const sum = a.byModel.reduce((n, m) => n + m.cost, 0);
    expect(a.spend).toBeCloseTo(sum, 2);
  });

  it('always charts at least a week, so one bar is never the whole shape', () => {
    expect(accountUsage(credential({ plan: 'Claude Pro' }), 'today').byDay.length).toBe(7);
    expect(accountUsage(credential({ plan: 'Claude Pro' }), '30d').byDay.length).toBe(30);
  });
});

describe('the workspace aggregate', () => {
  const worm = accountUsage(credential({ plan: 'Claude Pro' }), '7d');
  const school = accountUsage(credential({ label: 'school', plan: 'Claude Pro' }), '7d');
  const ds = accountUsage(credential({ providerId: 'deepseek', label: 'ds' }), '7d');
  // longcat has never run a turn — no history means no series, not a zero-height one.
  const idle = accountUsage(credential({ providerId: 'longcat', label: 'lc' }), '7d');

  it('folds the account ledgers per provider — the aggregate can never disagree with the rows', () => {
    const w = workspaceUsage([worm, school, ds, idle]);
    const claude = w.providers.find((p) => p.providerId === 'claude');
    expect(claude?.spend).toBeCloseTo(worm.spend + school.spend, 2);
    expect(w.total).toBeCloseTo(worm.spend + school.spend + ds.spend, 2);
  });

  it('sums each day across the provider’s accounts, aligned to the same ledger days', () => {
    const w = workspaceUsage([worm, school]);
    expect(w.byDay.length).toBe(worm.byDay.length);
    const lastDay = w.byDay.at(-1);
    const wormLast = (worm.byDay.at(-1)?.costs ?? []).reduce((n, c) => n + c, 0);
    const schoolLast = (school.byDay.at(-1)?.costs ?? []).reduce((n, c) => n + c, 0);
    expect(lastDay?.costs[0]).toBeCloseTo(wormLast + schoolLast, 2);
    expect(lastDay?.day).toBe('today');
  });

  it('gives an idle provider no series at all — never a flat zero band', () => {
    const w = workspaceUsage([worm, idle]);
    expect(w.providers.map((p) => p.providerId)).toEqual(['claude']);
  });

  it('keeps a provider’s series token fixed — a range change can never repaint it', () => {
    const week = workspaceUsage([worm, ds]);
    const alone = workspaceUsage([ds]);
    expect(week.providers.find((p) => p.providerId === 'deepseek')?.series).toBe(
      alone.providers.find((p) => p.providerId === 'deepseek')?.series,
    );
  });
});

describe('the scoped (account-stacked) reading', () => {
  const worm = accountUsage(credential({ plan: 'Claude Pro' }), '7d');
  const school = accountUsage(credential({ label: 'school', plan: 'Claude Pro' }), '7d');
  const personal = accountUsage(credential({ label: 'personal' }), '7d');
  const idle = accountUsage(credential({ providerId: 'longcat', label: 'lc' }), '7d');

  it('stacks one provider by account, bands fixed by account order — never by rank', () => {
    const s = accountStackedUsage([worm, school, personal]);
    expect(s.accounts.map((a) => a.label)).toEqual(['worm', 'school', 'personal']);
    expect(s.accounts.map((a) => a.series)).toEqual([1, 2, 3]);
    expect(s.total).toBeCloseTo(worm.spend + school.spend + personal.spend, 2);
  });

  it('folds a fourth account into `other` rather than minting a hue', () => {
    const ds = accountUsage(credential({ providerId: 'deepseek', label: 'ds' }), '7d');
    const s = accountStackedUsage([worm, school, personal, ds]);
    expect(s.accounts.map((a) => a.label)).toEqual(['worm', 'school', 'other']);
    expect(s.accounts[2]?.spend).toBeCloseTo(personal.spend + ds.spend, 2);
  });

  it('skips an account with no history — never a zero band', () => {
    const s = accountStackedUsage([worm, idle]);
    expect(s.accounts.map((a) => a.label)).toEqual(['worm']);
  });

  it('sums each day across the accounts, on the same ledger days', () => {
    const s = accountStackedUsage([worm, school]);
    const last = s.byDay.at(-1);
    expect(last?.day).toBe('today');
    const wormLast = (worm.byDay.at(-1)?.costs ?? []).reduce((n, c) => n + c, 0);
    expect(last?.costs[0]).toBeCloseTo(wormLast, 2);
  });
});

describe('needs-you items', () => {
  const worm = accountUsage(credential({ plan: 'Claude Pro' }));
  const school = accountUsage(credential({ label: 'school', plan: 'Claude Pro' }));
  const expired = accountUsage(credential({ label: 'personal', expired: true }));

  it('surfaces a nearly-spent limit and an unreadable login — and nothing else', () => {
    const items = attentionItems([worm, school, expired]);
    expect(items.map((i) => i.title)).toEqual(['personal', 'worm · opus 7-day']);
  });

  it('is empty when all is well — a healthy dashboard renders no attention block', () => {
    expect(attentionItems([school])).toEqual([]);
  });

  it('doors a limit to its account and a degraded pool to its keys', () => {
    const [limit] = attentionItems([worm]);
    expect(limit?.door).toEqual({ kind: 'account', credentialId: 'x' });
    const pool = poolAttention(
      { id: 'tavily', label: 'tavily' },
      { providerId: 'tavily', healthy: 2, cooling: 1, disabled: 0 },
      true,
    );
    expect(pool?.door).toEqual({ kind: 'keys', providerId: 'tavily' });
    expect(pool?.detail).toMatch(/cooling/);
  });

  it('says nothing about a pool that is serving cleanly, and "benched" outranks its keys', () => {
    expect(
      poolAttention(
        { id: 'tavily', label: 'tavily' },
        { providerId: 'tavily', healthy: 3, cooling: 0, disabled: 0 },
        true,
      ),
    ).toBeUndefined();
    expect(
      poolAttention(
        { id: 'parallel', label: 'parallel' },
        { providerId: 'parallel', healthy: 1, cooling: 0, disabled: 0 },
        false,
      )?.detail,
    ).toMatch(/benched/);
  });
});

describe('the rail HUD', () => {
  const accounts: AccountUsage[] = [
    accountUsage(credential({ plan: 'Claude Pro' })),
    accountUsage(credential({ label: 'school', plan: 'Claude Pro' })),
  ];

  it('draws the meters you ticked', () => {
    const rows = hudRows(accounts, ['worm:7d', 'school:7d'], false);
    expect(rows.map((r) => r.percent)).toEqual([52, 4]);
  });

  it('draws nothing at all for a meter the backend never gave us — never a fake zero', () => {
    expect(hudRows(accounts, ['personal:7d'], false)).toEqual([]);
  });

  it('quiets everything with headroom when asked to', () => {
    const rows = hudRows(accounts, ['worm:5h', 'worm:7d', 'worm:7d-opus', 'school:7d'], true);
    expect(rows.map((r) => r.id)).toEqual(['worm:7d', 'worm:7d-opus']);
  });
});

describe('UsageSurface', () => {
  it('lines every account’s limits up in one glance — no clicking to compare', () => {
    renderUsage();
    // worm + school each publish three windows; personal, ds and lc publish none — plus the
    // needs-you rows carry meters of their own (worm's opus window at 78%).
    expect(screen.getByLabelText('worm 7-day')).toHaveAttribute('aria-valuenow', '52');
    expect(screen.getByLabelText('school 7-day')).toHaveAttribute('aria-valuenow', '4');
    // Both keyed backends (deepseek, longcat) say it — a bar we cannot fill is never drawn.
    expect(screen.getAllByText('no limits API — spend only').length).toBe(2);
  });

  it('leads with the workspace spend, stacked by provider — the legend is the totals line', () => {
    renderUsage();
    // The lede chart's legend names the providers that actually spent (identity ≠ color alone).
    expect(screen.getAllByText('claude').length).toBeGreaterThan(0);
    expect(screen.getAllByText('deepseek').length).toBeGreaterThan(0);
  });

  it('surfaces the honest exceptions as doors — and only the exceptions', async () => {
    const user = userEvent.setup();
    renderUsage();
    expect(screen.getByText('needs you')).toBeTruthy();
    // personal's login is expired; worm's opus window is at 78%. school is fine — no row.
    expect(screen.getByText(/login expired/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /worm · opus 7-day/i }));
    // The limit row doors into the account dashboard.
    expect(await screen.findByText('claude-opus-4-8')).toBeTruthy();
  });

  it('drills into an account for the per-model breakdown', async () => {
    const user = userEvent.setup();
    renderUsage();
    await user.click(screen.getByRole('button', { name: /wormsegment/i }));
    expect(await screen.findByText('claude-opus-4-8')).toBeTruthy();
    expect(screen.getByText(/never billed/i)).toBeTruthy();
    expect(screen.getByText(/modelled API-equivalent cost/i)).toBeTruthy();
  });

  it('splits providers and tools into two views — the strip toggle swaps them', async () => {
    const user = userEvent.setup();
    renderUsage();
    // Providers view carries no service rows any more…
    expect(screen.queryByRole('button', { name: 'tavily keys' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'tools' }));
    // …and the tools view carries no account rows.
    expect(await screen.findByRole('button', { name: 'tavily keys' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText('worm 7-day')).toBeNull());
  });

  it('scopes the reading to any combination of providers; clearing every tile reads as all', async () => {
    const user = userEvent.setup();
    renderUsage();
    await user.click(screen.getByRole('button', { name: 'scope deepseek' }));
    // The claude accounts leave the inventory (exit animation → awaited)…
    await waitFor(() => expect(screen.queryByLabelText('worm 7-day')).toBeNull());
    // …the deepseek account stays, and so does its "spend only" honesty.
    expect(screen.getAllByText('no limits API — spend only').length).toBe(1);
    // Adding claude widens the combination — both providers' accounts show.
    await user.click(screen.getByRole('button', { name: 'scope claude' }));
    expect(await screen.findByLabelText('worm 7-day')).toBeTruthy();
    // Toggling both off clears the scope entirely: everything is back.
    await user.click(screen.getByRole('button', { name: 'scope deepseek' }));
    await user.click(screen.getByRole('button', { name: 'scope claude' }));
    expect(screen.getAllByText('no limits API — spend only').length).toBe(2); // ds + lc again
  });

  it('sends a tool service to its keys on auth — it has no dashboard of its own', async () => {
    const user = userEvent.setup();
    useUsageUi.getState().setView('tools');
    renderUsage();
    await user.click(screen.getByRole('button', { name: 'tavily keys' }));
    expect(useShell.getState().surface).toBe('auth');
    expect(useAuthUi.getState().selected).toBe('tavily');
  });

  it('closes an open drill-down when the view switches — tools has no level 2', async () => {
    const user = userEvent.setup();
    renderUsage();
    await user.click(screen.getByRole('button', { name: /wormsegment/i }));
    expect(await screen.findByText(/never billed/i)).toBeTruthy();
    useUsageUi.getState().setView('tools');
    expect(useUsageUi.getState().opened).toBeUndefined();
  });

  it('meters nothing when there is nothing to meter', () => {
    useMockAuth.setState({ added: [], credentials: [] });
    renderUsage();
    expect(screen.getByText(/nothing to meter/i)).toBeTruthy();
  });
});
