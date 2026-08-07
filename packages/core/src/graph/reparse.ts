import { extractSymbols, parse } from '@coa/code-intel';
import type { CST, SymbolRecord } from '@coa/shared';

/**
 * The kernel→parser driving seam (the only kernel↔parser edge). The kernel parses a file's bytes with
 * the parser module and indexes the byte-local records, qualifying each `definedIn` with the
 * file path so the resident table keys on a repo-wide location. A parse
 * crash/timeout yields no symbols — the kernel treats the file as the Tier-0 floor and
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
