import type { Tier } from '@coa/shared';
import { hasGrammar, langFromPath } from './languages.js';

/**
 * The neutral-floor / bounded-layer tier decision. A file is
 * Tier-2 (tags/refs) when a bounded grammar covers its language, else Tier-0
 * (the universal floor that always works). Tier-1 (outline) is not emitted this
 * round. `lang` wins over `path`; either may be absent.
 *
 * The input is deliberately structural so a {@link CanonicalizationProfile}
 * (which carries `lang`) is also a valid argument.
 */
export interface TierInput {
  path?: string;
  lang?: string;
}

export function tierFor(input: TierInput): Tier {
  const lang = input.lang ?? (input.path !== undefined ? langFromPath(input.path) : undefined);
  return lang !== undefined && hasGrammar(lang) ? 2 : 0;
}
