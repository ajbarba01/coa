import { create } from 'zustand';

/**
 * The usage HUD: which limit meters the rail watches, and the pure projections
 * that turn account reads into HUD rows. The HUD is a PROJECTION of the same
 * reads the usage surface renders — never a second source of truth.
 */

export interface UsageHudState {
  /** `${accountLabel}:${limitId}` — what the rail actually draws. */
  meters: string[];
  showSpend: boolean;
  /** The quieting rule: a meter with headroom is not news. Off ⇒ show everything ticked. */
  onlyAboveHalf: boolean;
  toggleMeter: (id: string) => void;
  setShowSpend: (on: boolean) => void;
  setOnlyAboveHalf: (on: boolean) => void;
}

export const useUsageHud = create<UsageHudState>((set) => ({
  meters: ['worm:5h', 'worm:7d', 'worm:7d-opus', 'school:7d'],
  showSpend: true,
  onlyAboveHalf: false,
  toggleMeter: (id) =>
    set((s) => ({
      meters: s.meters.includes(id) ? s.meters.filter((m) => m !== id) : [...s.meters, id],
    })),
  setShowSpend: (showSpend) => set({ showSpend }),
  setOnlyAboveHalf: (onlyAboveHalf) => set({ onlyAboveHalf }),
}));

/** The slice of an account's usage the HUD projects — structurally satisfied by the
 *  usage surface's `AccountUsage`, whatever feeds it (the HUD never cares which). */
export interface HudAccount {
  label: string;
  limits?: { id: string; label: string; percent: number }[] | undefined;
}

export interface HudRow {
  id: string;
  name: string;
  percent: number;
}

/** Pure: what the rail HUD draws, given the accounts and the user's picks. */
export function hudRows(
  accounts: HudAccount[],
  meters: string[],
  onlyAboveHalf: boolean,
): HudRow[] {
  const rows: HudRow[] = [];
  for (const id of meters) {
    const [label, limitId] = id.split(':');
    const account = accounts.find((a) => a.label === label);
    const limit = account?.limits?.find((l) => l.id === limitId);
    if (limit === undefined) continue; // an unreadable meter draws nothing, never a fake zero
    if (onlyAboveHalf && limit.percent < 50) continue;
    rows.push({ id, name: `${label} · ${limit.label}`, percent: limit.percent });
  }
  return rows;
}

/** Every meter the user COULD tick — the gear's menu. */
export function hudChoices(accounts: HudAccount[]): { id: string; name: string }[] {
  return accounts.flatMap((a) =>
    (a.limits ?? []).map((l) => ({ id: `${a.label}:${l.id}`, name: `${a.label} · ${l.label}` })),
  );
}
