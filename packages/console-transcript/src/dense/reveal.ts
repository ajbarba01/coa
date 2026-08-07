/** Single source of truth for the streaming reveal effect. Changing any effect is a
 *  one-line edit here (`variant: 'none'` degrades to a literal pass-through, so a disabled
 *  reveal is never worse than the raw text). The
 *  transcript components read `defaultReveal` directly; each also accepts a prop override.
 *  See docs/superpowers/specs/2026-07-09-streaming-reveal-effect-design.md. */
export type TextVariant = 'blurIn' | 'fadeIn' | 'slideUp' | 'none';
export type BlockVariant = 'blurRise' | 'fadeRise' | 'fade' | 'scale' | 'none';
export type ReasoningMode = 'auto-expand' | 'shimmer' | 'peek' | 'static';

export interface RevealConfig {
  /** Per-word reveal for live-streaming agent text. Currently UNWIRED — the live per-word
   *  reveal is being reworked into a block-split `StreamingMarkdown` (react-markdown re-parses
   *  the whole block every frame, which remounted the per-word spans → invisible + laggy; see
   *  the handoff). Kept as the config seam the rework will re-consume. */
  text: { variant: TextVariant; durationMs: number };
  /** Steady block caret at the live tail. */
  caret: boolean;
  reasoning: { mode: ReasoningMode; collapseDelayMs: number; collapseDurationMs: number };
  /** Whole-block entrance for non-streamed blocks (tool cards, results, plans, …). */
  block: { variant: BlockVariant; durationMs: number; staggerMs: number; staggerCap: number };
}

export const defaultReveal: RevealConfig = {
  // The design reference's motion: a word blurs in and a block does a crisp fade + short
  // rise, both at the kit's `--dur-enter` (180ms) with the one Slipstream ease. No block
  // stagger — each block enters on its own arrival, the way the reference does it (a 500ms
  // blurRise with a cascade delay read as sluggish and un-crisp against the proto).
  text: { variant: 'blurIn', durationMs: 180 },
  caret: false,
  reasoning: { mode: 'auto-expand', collapseDelayMs: 900, collapseDurationMs: 320 },
  block: { variant: 'fadeRise', durationMs: 180, staggerMs: 0, staggerCap: 0 },
};
