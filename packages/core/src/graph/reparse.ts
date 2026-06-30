import { extractSymbols, parse } from '@coa/code-intel';
import type { SymbolRecord } from '@coa/shared';

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
  const cst = parse({ lang: file.lang, bytes: file.bytes });
  if ('ok' in cst) return [];
  return extractSymbols(cst).map((record) => ({
    ...record,
    definedIn: `${file.path}:${record.definedIn}`,
  }));
}
