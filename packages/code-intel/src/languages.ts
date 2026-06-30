/**
 * The pure language registry: which `lang` ids have a bounded tree-sitter grammar
 * this round, and how to derive a `lang` from a file path. No native binding is
 * touched here — only data — so the byte-pure extractors (`extractMetrics`,
 * `tierFor`) can ask "is there a grammar?" without loading the parser addon.
 *
 * Grammar coverage this round (a ratified decision): the Tier-0 universal floor
 * plus the TS/JS bounded grammar. Everything else degrades to the floor (D85).
 */

/** A `lang` id with a bounded grammar. The native Language objects load in {@link ./parser}. */
export type GrammaredLang = 'typescript' | 'tsx' | 'javascript';

/** The set of `lang` ids that light up the Tier-2 bounded layer this round. */
const GRAMMARED: ReadonlySet<string> = new Set<GrammaredLang>(['typescript', 'tsx', 'javascript']);

/** Lower-cased file extension (no dot) -> canonical `lang` id. */
const EXTENSION_TO_LANG: ReadonlyMap<string, GrammaredLang> = new Map([
  ['ts', 'typescript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],
  ['tsx', 'tsx'],
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['jsx', 'javascript'],
]);

/** True when `lang` has a bounded grammar (the Tier-2 bounded layer engages). */
export function hasGrammar(lang: string): lang is GrammaredLang {
  return GRAMMARED.has(lang);
}

/** Derive a `lang` id from a file path's extension, or `undefined` if none is known. */
export function langFromPath(path: string): GrammaredLang | undefined {
  const lastDot = path.lastIndexOf('.');
  if (lastDot < 0) return undefined;
  const ext = path.slice(lastDot + 1).toLowerCase();
  return EXTENSION_TO_LANG.get(ext);
}
