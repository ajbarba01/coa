import type { SymbolRecord } from '@coa/shared';

/**
 * The resident `name → SymbolRecord` index — the graph's node-set index, which
 * is why it lives in the kernel, not the parser module. The kernel builds it by driving the parser's `extractSymbols` on
 * each reparse (see `reparse.ts`) and feeding the path-qualified records here.
 * Records are tracked by their defining file so a reparse cleanly replaces a
 * file's symbols rather than leaking stale names.
 */
export class SymbolTable {
  private readonly byPath = new Map<string, SymbolRecord[]>();
  private readonly byName = new Map<string, SymbolRecord[]>();

  /** Replace `path`'s symbols with `records` (the reparse contract). */
  indexFile(path: string, records: SymbolRecord[]): void {
    this.removeFile(path);
    this.byPath.set(path, records);
    for (const record of records) {
      const bucket = this.byName.get(record.name);
      if (bucket) bucket.push(record);
      else this.byName.set(record.name, [record]);
    }
  }

  removeFile(path: string): void {
    const existing = this.byPath.get(path);
    if (!existing) return;
    for (const record of existing) {
      const bucket = this.byName.get(record.name);
      if (!bucket) continue;
      const remaining = bucket.filter((r) => r !== record);
      if (remaining.length > 0) this.byName.set(record.name, remaining);
      else this.byName.delete(record.name);
    }
    this.byPath.delete(path);
  }

  /** O(1) read; on a collision the first-indexed record wins (callers refine via the graph). */
  lookup(name: string): SymbolRecord | undefined {
    return this.byName.get(name)?.[0];
  }

  names(): string[] {
    return [...this.byName.keys()];
  }
}
