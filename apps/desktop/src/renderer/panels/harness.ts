import type { BrandMarkSpec } from '@coa/console-kit';

/**
 * Which harness actually runs an agent. Derived, never chosen: the Claude path layers
 * coa's rendered prompt onto the vendor's `claude_code` preset (see `buildBaseOptions`
 * in packages/adapter-claude-sdk/src/sdk-options.ts), while a pure-API backend gets no
 * vendor frame at all, so coa supplies the whole prompt scaffold itself. An unset
 * provider resolves to Claude, mirroring the daemon's own `?? 'claude'` default
 * (`session.ts`, `prompt-freeze.ts`, `session-handlers.ts`, `baseline-pieces.ts`,
 * `model-cache.ts`) — this line states what actually RUNS, so it has to resolve the
 * default the same way the runtime does, not the opposite of it.
 */
export type Harness = 'claude-code' | 'coa';

export function harnessOf(provider: string | undefined): Harness {
  return provider === undefined || provider === 'claude' ? 'claude-code' : 'coa';
}

const HARNESS_LABEL: Record<Harness, string> = {
  'claude-code': 'Claude Code',
  coa: 'coa scaffold',
};

/** The label the model picker groups its options under — the vocabulary a first open
 *  teaches, rather than something a glyph alone would have to guess at. */
export function harnessLabel(h: Harness): string {
  return HARNESS_LABEL[h];
}

const HARNESS_BLURB: Record<Harness, string> = {
  // Prose still starts with a capital even though the harness LABEL ('coa scaffold') is
  // deliberately lowercase — that exception covers the label, not arbitrary sentences —
  // so neither sentence opens on the product name.
  'claude-code': "Runs Anthropic's own Claude Code preset with coa's prompt layered on.",
  coa: 'This backend has no vendor preset, so coa supplies the whole prompt scaffold.',
};

/** The tooltip sentence: what actually running on this harness means. The harness has
 *  nothing to pick, so this is the one place it gets explained. */
export function harnessBlurb(h: Harness): string {
  return HARNESS_BLURB[h];
}

/** coa's own mark: no vendor art exists for coa itself, so `BrandMark` draws the
 *  monogram tile — the harness reuses the same extensibility floor providerMarks.ts
 *  established for third-party vendors with no bundled logo. Unlike a vendor hex
 *  (ADR-0015's carve-out — "the OUTSIDE world's brand colour... not a token and
 *  never will be"), this IS coa's own mark, so it wears a token and re-themes with
 *  everything else instead of being nailed to one retired brass hex forever.
 *  `--color-s10` keeps it in the neutral family SetBox's own `added` fill uses
 *  (`bg-s10 text-s1`, resolvedSet.tsx) — quiet, not a vendor-style accent hue. */
export const COA_MARK: BrandMarkSpec = { name: 'coa', color: 'var(--color-s10)', monogram: 'c' };
