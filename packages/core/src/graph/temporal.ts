/**
 * The WAL⨝structure temporal projection: coa's measured differentiator.
 * The WAL (every edit, finer than a git commit) joined with the structure graph
 * yields the temporal metrics pure-static tools cannot compute natively — churn,
 * hotspots (churn × complexity), and change/temporal coupling (co-change). This
 * is a deterministic projection (a *temporal* view), **not** a parallel
 * history store: the WAL is the only temporal substrate. The change-set boundary
 * (what counts as "changed together") is a grouping key — by `ts` by default.
 */
export interface FileTouch {
  seq: number;
  path: string;
  ts: string;
}

export interface TemporalView {
  node: string;
  churn: number;
  /** churn × complexity (degrades to churn when complexity is unknown). */
  hotspot: number;
  /** Other nodes that co-changed in the same change set, by frequency then name. */
  changeCoupling: { node: string; count: number }[];
}

export interface TemporalOptions {
  fromSeq?: number;
  toSeq?: number;
  complexity?: number;
  /** The change-set grouping key; defaults to the timestamp. */
  groupBy?: (touch: FileTouch) => string;
}

export function temporal(
  node: string,
  history: FileTouch[],
  options: TemporalOptions = {},
): TemporalView {
  const from = options.fromSeq ?? Number.NEGATIVE_INFINITY;
  const to = options.toSeq ?? Number.POSITIVE_INFINITY;
  const groupBy = options.groupBy ?? ((t: FileTouch): string => t.ts);
  const inWindow = history.filter((t) => t.seq >= from && t.seq <= to);

  const churn = inWindow.filter((t) => t.path === node).length;
  const hotspot = churn * (options.complexity ?? 1);

  const changeSets = new Map<string, Set<string>>();
  for (const t of inWindow) {
    const key = groupBy(t);
    const set = changeSets.get(key) ?? new Set<string>();
    set.add(t.path);
    changeSets.set(key, set);
  }

  const coChange = new Map<string, number>();
  for (const members of changeSets.values()) {
    if (!members.has(node)) continue;
    for (const other of members) {
      if (other === node) continue;
      coChange.set(other, (coChange.get(other) ?? 0) + 1);
    }
  }

  const changeCoupling = [...coChange.entries()]
    .map(([n, count]) => ({ node: n, count }))
    .sort((a, b) => b.count - a.count || (a.node < b.node ? -1 : 1));

  return { node, churn, hotspot, changeCoupling };
}
