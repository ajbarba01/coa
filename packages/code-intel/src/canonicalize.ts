import type { CanonicalForm, CanonicalizationProfile } from '@coa/shared';
import { hasGrammar } from './languages.js';
import { parse } from './parser.js';
import { walk, type SerializedNode } from './cst.js';

/**
 * The G0 shared primitive: reduce an artifact to a canonical form so "equal
 * modulo formatting?" is a byte-compare of two {@link CanonicalForm}s. The v1
 * floor is a token stream (a sound reduction): where a grammar exists, the
 * artifact's leaf tokens are emitted in document order joined by single spaces,
 * so spacing/indentation/line-break differences vanish while tokens and comments
 * are preserved (`a+b` and `a + b` collapse; `x` and `y` do not). Where no
 * grammar exists it degrades to collapsing whitespace runs (D85).
 *
 * `ignoreRegions` blanks byte ranges (length-preserving, so later ranges stay
 * valid) before tokenizing; `stripBanner` drops a leading comment. `sortKeys` is
 * a deferred profile knob — the v1 floor never reorders tokens.
 */
export function canonicalize(artifact: string, profile: CanonicalizationProfile): CanonicalForm {
  const preprocessed = blankRegions(artifact, profile.ignoreRegions);
  const canonicalBytes = hasGrammar(profile.lang)
    ? grammaredTokens(preprocessed, profile)
    : whitespaceFloor(stripFloorBanner(preprocessed, profile.stripBanner));
  return { lang: profile.lang, canonicalBytes };
}

/** Replace each ignored `[start, end)` byte range with spaces, preserving length. */
function blankRegions(
  artifact: string,
  regions: readonly (readonly [number, number])[] | undefined,
): string {
  if (!regions || regions.length === 0) return artifact;
  const chars = [...artifact];
  for (const [start, end] of regions) {
    for (let i = start; i < end && i < chars.length; i++) chars[i] = ' ';
  }
  return chars.join('');
}

/** The grammared path: leaf-token stream, optionally dropping leading comment tokens. */
function grammaredTokens(artifact: string, profile: CanonicalizationProfile): string {
  const result = parse({ lang: profile.lang, bytes: artifact });
  if ('ok' in result) {
    return whitespaceFloor(stripFloorBanner(artifact, profile.stripBanner));
  }
  let tokens = leafTokens(result.tree as SerializedNode);
  if (profile.stripBanner === true) {
    while (tokens.length > 0 && tokens[0]?.type === 'comment') tokens = tokens.slice(1);
  }
  return tokens.map((t) => t.text).join(' ');
}

interface Token {
  type: string;
  text: string;
}

/** Concrete leaf tokens (childless nodes) in document order, skipping whitespace-only text. */
function leafTokens(root: SerializedNode): Token[] {
  const tokens: Token[] = [];
  for (const node of walk(root)) {
    if (node.children.length > 0) continue;
    const text = node.text.trim();
    if (text.length > 0) tokens.push({ type: node.type, text });
  }
  return tokens;
}

/** The Tier-0 floor: collapse every whitespace run to a single space and trim. */
function whitespaceFloor(artifact: string): string {
  return artifact.replace(/\s+/g, ' ').trim();
}

/** Drop a leading run of comment-looking lines (the floor's banner heuristic). */
function stripFloorBanner(artifact: string, stripBanner: boolean | undefined): string {
  if (stripBanner !== true) return artifact;
  const lines = artifact.split('\n');
  let i = 0;
  while (i < lines.length && /^\s*(\/\/|#|\/\*|\*)/.test(lines[i] ?? '')) i++;
  return lines.slice(i).join('\n');
}
