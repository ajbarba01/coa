/**
 * The usage vocabulary the live shell shares with the usage surface: the range
 * control's domain and the money format. Production code — it must never depend
 * on the mock ledger (mockUsage.ts imports from here, not the reverse).
 */

export type Range = 'today' | '7d' | '30d' | 'all';
export const RANGES: Range[] = ['today', '7d', '30d', 'all'];

/** Value/label split: the ids key the ledger arithmetic and the view state, the labels are
 *  the only thing the range control shows. `7d`/`30d` are durations, not words. */
export const RANGE_LABEL: Record<Range, string> = {
  today: 'Today',
  '7d': '7d',
  '30d': '30d',
  all: 'All',
};

/** Money, the way this console says it. */
export function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}
