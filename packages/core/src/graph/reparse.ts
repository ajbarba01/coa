import { extractSymbols, parse } from '@coa/code-intel';
import type { CST, SymbolRecord } from '@coa/shared';

/**
 * The M1→M2 driving seam (the only M1↔M2 edge). M1 parses a file's bytes with
 * M2 and indexes the byte-local records, qualifying each `definedIn` with the
 * file path so the resident table keys on a repo-wide location. A parse
 * crash/timeout yields no symbols — M1 treats the file as the Tier-0 floor and
 * continues (the failure never throws across the boundary).
 */
export function reparseSymbols(file: {
  path: string;
  lang: string;
  bytes: string;
}): SymbolRecord[] {
  return reparseFile(file).symbols;
}

/** Parse a file once and return both its path-qualified symbols and the CST (for import/metric walks). */
export function reparseFile(file: { path: string; lang: string; bytes: string }): {
  symbols: SymbolRecord[];
  cst: CST | null;
} {
  const cst = parse({ lang: file.lang, bytes: file.bytes });
  if ('ok' in cst) return { symbols: [], cst: null };
  const symbols = extractSymbols(cst).map((record) => ({
    ...record,
    definedIn: `${file.path}:${record.definedIn}`,
  }));
  return { symbols, cst };
}
