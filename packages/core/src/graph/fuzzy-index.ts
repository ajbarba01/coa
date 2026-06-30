import type { RankedCandidate, SymbolRecord } from '@coa/shared';

/**
 * The miss-path nearest-match index over symbol identifier strings. It is built
 * on the daemon's idle time (registered via `scheduleIdle`) and queried **only**
 * on a `lookup` miss — the hit path is one map read, so only the rare miss pays
 * for fuzzy search. The floor ranks by normalized edit distance; the richer
 * signals (WAL rename provenance, graph/scope proximity, signature similarity)
 * are a later batch. Each candidate carries an explicit confidence.
 */
export class FuzzyIndex {
  private records: SymbolRecord[] = [];

  build(records: SymbolRecord[]): void {
    this.records = [...records];
  }

  match(name: string, limit = 5): RankedCandidate[] {
    const cutoff = Math.max(1, Math.floor(name.length / 2));
    const scored: RankedCandidate[] = [];
    for (const symbol of this.records) {
      const distance = editDistance(name, symbol.name);
      if (distance > cutoff) continue;
      const confidence = 1 - distance / Math.max(name.length, symbol.name.length);
      scored.push({ symbol, confidence, why: `edit distance ${distance}` });
    }
    return scored.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
  }
}

/** Levenshtein distance with a rolling single-row table. */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((row[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, prev + cost);
      prev = temp;
    }
  }
  return row[b.length] ?? 0;
}
