/**
 * The highlighting vocabulary: which grammars are registered, and which short names
 * resolve to them.
 *
 * One table for both callers, because a fence tag and a file extension are the same
 * vocabulary — `ts` means TypeScript in both ```ts and `auth.ts`. Kept as two tables
 * they drifted immediately (one grew `shell`/`console`, the other did not).
 */

/**
 * Every grammar registered with the highlighter, under the id it is registered as.
 * `syntaxTheme.tsx` types its registration map against this, so a grammar added in one
 * place and not the other is a type error rather than a silent gap.
 */
export const GRAMMARS = [
  'bash',
  'css',
  'go',
  'javascript',
  'json',
  'markdown',
  'python',
  'rust',
  'sql',
  'typescript',
  'xml',
  'yaml',
] as const;

export type Grammar = (typeof GRAMMARS)[number];

const REGISTERED = new Set<string>(GRAMMARS);

/** Short names that name a grammar registered under a different id. A registered id
 *  resolves to itself and is checked first, so repeating one here would be dead config
 *  — and pointing one at a DIFFERENT grammar would silently do nothing. Pinned by test. */
export const ALIASES: Record<string, Grammar> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  md: 'markdown',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
};

/**
 * The registered grammar a short name means, or `undefined` when none is registered for it.
 *
 * Worth resolving rather than forwarding the name as written: an id the highlighter does
 * not know is not treated as "no language", it is treated as "work out which" — it scores
 * the code against every registered grammar and renders whichever wins. So a ```ts block,
 * the commonest fence there is, was guessed at instead of read as TypeScript. Names with no
 * entry here still take that path; this narrows it to the ones we can answer for.
 */
export function grammarForTag(tag: string): Grammar | undefined {
  const key = tag.toLowerCase();
  return REGISTERED.has(key) ? (key as Grammar) : ALIASES[key];
}

/** The grammar for a file path, by extension; undefined when unknown or absent.
 *  Pure; never throws. */
export function languageForPath(path: string): Grammar | undefined {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined; // no extension, or a dotfile like `.gitignore`
  return grammarForTag(base.slice(dot + 1));
}
