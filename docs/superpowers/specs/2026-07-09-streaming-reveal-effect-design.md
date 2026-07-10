# Streaming reveal effect — design

_Phase 0 streaming polish. Console-only (M10). No new ADR — this is presentation, not a
cross-module contract. Design date: 2026-07-09._

## Problem

Streaming output works (piece B / ADR 0013) and the render is coalesced to one
`requestAnimationFrame` flush (`f87dc4f`), but the maintainer finds it "could be a little
smoother." The felt gap is **perceived cadence**, not frame rate: tokens arrive from the
network in bursts, so text appears in lumps even at a steady 60fps. The industry answer —
opencode, Cursor, Vercel Streamdown / shadcn `ai-elements` — is a short per-token reveal
animation that **decouples visual smoothness from network burstiness**. This design adds
that reveal, plus a coherent entrance for the non-streamed blocks, as a small tunable layer
over the existing pipeline.

Reference (from the OSS survey): the ecosystem has converged on **per-word `<span>` + a
short GPU-only opacity/blur keyframe + a "skip already-visible words" guard**, with the
animation markup **shed entirely on settle**. We port that idiom into our own renderer.

## Scope

**In:** the visual reveal only. Three surfaces:

1. **Streaming agent text/thinking** → per-word reveal.
2. **Reasoning block** → auto-expand while thinking, smooth collapse on settle.
3. **Every other newly-arrived block** (tool card, tool-result, plan, error, approval,
   subagent, deny, user turn, note) → a block-level entrance, cascaded when a batch mounts
   in one flush.

**Out (flagged, not built):** the O(n)/frame markdown re-parse of the growing live block —
`react-markdown` re-parses the whole block each flush, so a very long single answer costs
O(n) per frame. Real but separate; a future perf item, not bundled here.

## Locked feel (maintainer-approved via the interactive sandbox)

| Surface | Effect | Notes |
| --- | --- | --- |
| Output text | per-word **blur-in**, ~190ms, no caret | blur masks the burst pop |
| Reasoning | **auto-expand** while streaming → "Thought for Ns" → **smooth height-ease collapse** meshing into the next block | today it is collapse-by-default, so streaming reasoning is currently invisible |
| Whole blocks | **blur + rise**, ~500ms, cascaded stagger when batched | animates the **content column only** so the spine/dots stay fixed |
| Reduced motion | instant reveal, no shimmer | free via the global `[data-motion='reduce']` rule |

## Invariants (must not regress)

- **D85** — a settled or reloaded transcript is byte-identical to today; `coa raw` untouched
  (raw frames never get the reveal). The live→settled swap must be pixel-identical (the last
  live frame already shows every word at full opacity), so settling never flickers.
- **E-substrate / ADR 0013** — deltas stay delivery-only; this is pure view-layer, touches no
  persistence, no daemon, no adapter, no wire schema.
- **Perf** — reveal + entrance are opacity/filter/transform only (compositor-friendly). The
  one layout-animating effect is the reasoning collapse, a one-shot gesture, not per-frame.
  Must not reintroduce the render lag `f87dc4f` fixed; verified live.
- **Spine** — the continuous dot-to-dot gutter must stay unbroken during entrances.
- **Memo-row / content-visibility safe** — the reveal must not defeat `MemoRow`'s
  memoization (only the growing streaming row re-renders) nor fight `content-visibility: auto`.

## Architecture

Everything lives in **`packages/console-ui`** (the kit) with keyframes in the app's
**`apps/desktop/src/renderer/globals.css`** — the established home for kit-component
animation CSS (toast/overlay/sheet keyframes already live there; components reference the
class, the app defines the frames). Reduced motion is already neutralized globally there.

### 1. The config seam (`packages/console-ui/src/dense/reveal.ts`, new)

A single source of truth for every tunable, so changing any effect is a one-line edit (the
maintainer's repeated ask). Exported const + type; components import the default and accept
an optional override prop.

```
export interface RevealConfig {
  text:  { variant: 'blurIn' | 'fadeIn' | 'slideUp' | 'none'; durationMs: number; staggerMs: number };
  caret: boolean;
  reasoning: { mode: 'auto-expand' | 'shimmer' | 'peek' | 'static';
               collapseDelayMs: number; collapseDurationMs: number };
  block: { variant: 'blurRise' | 'fadeRise' | 'fade' | 'scale' | 'none';
           durationMs: number; staggerMs: number; staggerCap: number };
}
export const defaultReveal: RevealConfig = { /* the locked feel above */ };
```

Variants map to a CSS class / `data-` attribute; durations/staggers apply as inline CSS
custom properties (`--reveal-dur`, `--enter-dur`) so no per-value CSS is generated. `'none'`
degrades to a literal pass-through (D85-style: the feature off is never worse than plain).

### 2. Per-word reveal — `rehype` plugin on `Markdown`

`Markdown` gains `streaming?: boolean` and reads `defaultReveal.text`. A new
`rehypeReveal` plugin (`packages/console-ui/src/dense/rehype-reveal.ts`) runs **only when
`streaming` is true**:

- Walks the HAST, splits each text node into words, wraps each in
  `<span class="cx-tok">word</span>`; whitespace stays as bare text nodes (preserves
  wrap/justification). **Skips `code`/`pre`/`svg`/`math` subtrees.**
- **Skip-guard:** the plugin receives `seenChars` — the block's length at the *previous*
  render (a `useRef` in `Markdown`, read then updated to `source.length` each render). Words
  whose start offset `< seenChars` get `data-seen` and no animation; only newly-arrived words
  animate. This is what makes rAF-batched bursts smooth instead of re-animating the paragraph
  every frame. Robust regardless of React reconciliation (old words carry `animation: none`).
- CSS (globals.css): `.cx-tok:not([data-seen])` runs the variant keyframe
  (`blurIn`/`fadeIn`/`slideUp`) at `var(--reveal-dur)`. GPU-only.

When `streaming` is false the plugin is absent → the settled/reloaded block is plain markdown
with **zero reveal spans** (sheds on settle; historical reload never animates). Because the
last live frame already painted every word opaque, the swap is pixel-identical.

The `streaming` flag is threaded: `reads.ts` view frame (already has it) →
`TranscriptFrame` (add `streaming?` to the `text` and `thinking` kinds) →
`toGovernedFrame` maps it → `TranscriptRow` passes `streaming` to `Markdown` (and
`ThinkingCard`). Raw mode never sets it (D85).

### 3. Reasoning — `ThinkingCard` auto-expand + smooth collapse

`ThinkingCard` gains `streaming?: boolean` and reads `defaultReveal.reasoning`. Behavior for
`mode: 'auto-expand'`:

- On `streaming` true → auto-open; body renders via `Markdown streaming` in the muted/italic
  style.
- On `streaming` false→true→false transition (thinking ended) → after `collapseDelayMs`,
  auto-collapse; label swaps "Thinking" → "Thought for Ns" (N from a start-time ref).
- **Smooth collapse:** wrap the body in a `grid-template-rows: 0fr↔1fr` container
  (`transition` at `collapseDurationMs`) so it eases closed and the following block eases up
  to meet it — no snap. Reduced motion drops the transition (global rule).
- Manual click still toggles and sets a "user touched" flag that suppresses further auto —
  the user's explicit choice wins.

Other modes (`shimmer`/`peek`/`static`) are supported by the config for tunability but
`auto-expand` is the shipped default; `shimmer` (label-only) is the natural fallback for a
collapsed-while-streaming look.

### 4. Whole-block entrance — `MemoRow`

Replaces the current 140ms Web-Animations fade+translate (which animates the whole row,
including the gutter). New behavior:

- Animate the existing `MemoRow` outer wrapper on mount via the Web Animations API (as the
  prior 140ms mount animation already did — this is not a new stacking of animation on the
  row). The lift is small (≤6px over ~500ms) and the prior code already animated the whole
  row's `translateY`, so the spine tolerates it; a content-column-only wrapper was considered
  and dropped as unnecessary (it would require restructuring `TranscriptRow`'s gutter).
- **Suppressed** for the streaming text/thinking frames (they use the per-word reveal
  instead — no double animation) and for `raw` frames (D85).
- **Live-only:** a row present at the transcript's initial mount does **not** animate (opening
  a past session should not bulk-animate history); only rows appended after first paint enter.
  Implemented with an "initial load done" guard (a ref flipped in a first-commit effect).
- **Cascade:** rows mounting within the same animation frame get an incremental
  `animation-delay` (`min(batchIndex, staggerCap) * staggerMs`) via a module-level counter
  reset on `requestAnimationFrame`, so a coalesced batch of blocks cascades rather than
  popping simultaneously.

### 5. Spine

Independent of animation: a regression test locks that the real `SpineGutter` still emits its
dot + connector segments for agent rows and omits them for user rows, so the entrance work
cannot silently break the continuous spine.

## Testing

Unit (Vitest, the pure/isolable parts — the arc's lesson is that fakes miss streaming, so
these are necessary-not-sufficient and the live pass is authoritative):

- `rehypeReveal`: word-wrapping, whitespace preserved, code/pre skipped, `seenChars`
  skip-guard marks old words `data-seen` and animates only new ones, empty/settled source is
  a pass-through.
- `reveal.ts` defaults shape; `'none'` variants degrade to pass-through.
- `TranscriptFrame`/`toGovernedFrame` carries `streaming` through; raw mode never sets it.
- `MemoRow`: streaming text/thinking + raw suppress the entrance; the cascade index resets
  per frame; the initial-load guard suppresses history.
- `ThinkingCard`: auto-open on streaming, "Thought for Ns" + collapse after
  `collapseDelayMs`, manual-touch suppresses auto.

**Live (authoritative)** — the real Electron app against real backends (DeepSeek `ds` /
LongCat `lc` pure-API + Claude): a long streaming turn reveals smoothly, the elapsed-seconds
timer keeps pace, the reasoning block auto-expands then melts closed into the answer, a batch
of tool cards cascades in, the spine stays continuous, and settling does not flicker. Confirm
`f87dc4f`'s smoothness is not regressed. Also run the piece-B Claude streaming live gate clean
(`COA_LIVE=1 … streaming-output-smoke.live.test.ts`).

## Rollout

One console-only change set; no daemon/adapter/schema/persistence touch. `coa raw` and
reloaded transcripts are byte-identical. Ships behind `defaultReveal`; any effect (or the
whole thing, via `variant: 'none'`) is a one-line revert.
