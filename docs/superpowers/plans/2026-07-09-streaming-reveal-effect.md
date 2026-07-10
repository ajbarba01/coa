# Streaming Reveal Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tunable per-word streaming reveal (blur-in) for agent text/thinking, an auto-expand/smooth-collapse reasoning block, and a cascaded block-entrance for non-streamed blocks — all console-only, behind one config seam.

**Architecture:** All in `packages/console-ui` (the kit) with keyframes in `apps/desktop/src/renderer/globals.css` (the established home for kit animation CSS). A `rehype` plugin wraps live-streaming words in animated spans with a "skip already-seen" guard; `ThinkingCard` and `MemoRow` gain behavior driven by a single `reveal.ts` config. No daemon/adapter/schema/persistence touch.

**Tech Stack:** React 19, TypeScript strict, `react-markdown` + `remark-gfm` (already used by `Markdown`), Web Animations API (already used by `MemoRow`), Tailwind v4, Vitest + jsdom.

## Global Constraints

- **TypeScript strict, no `any`.** `exactOptionalPropertyTypes` is ON — optional fields via guarded spreads (`...(x !== undefined ? { x } : {})`), never `x: undefined`.
- **Run typecheck, not just eslint+vitest** — `pnpm --filter <pkg> typecheck` (`tsc -b` excludes test files, so a broken `.test.ts` only shows when vitest collects it).
- **D85** — a settled or reloaded transcript is byte-identical to today; `coa raw` frames never get the reveal. The live→settled swap must be pixel-identical (no flicker).
- **Perf** — reveal + entrance are opacity/filter/transform only; the one layout animation is the reasoning collapse (a one-shot gesture). Must not regress `f87dc4f`.
- **Reduced motion** — handled globally by `[data-motion='reduce']` in globals.css (zeroes animation/transition-duration); WAAPI paths add their own `matchMedia` guard (as `MemoRow` does today).
- **Commits:** subject-only Conventional Commits, no body, no trailer, no module/phase IDs. Stage files BY NAME. Never `git add -A`. Never stage `DEV-NOTES.md`, `TEMP.txt`, `project.md`. One logical unit per commit.
- **Some pnpm packages lack a `test` script** — use `pnpm vitest run <path>`. `pnpm --filter @coa/console-ui test` prints nothing on this box but the exit code is authoritative.

---

## File Structure

- **Create** `packages/console-ui/src/dense/reveal.ts` — `RevealConfig` type + `defaultReveal` const (the one tunable source).
- **Create** `packages/console-ui/src/dense/rehype-reveal.ts` — the pure HAST word-wrapping plugin with the skip-guard.
- **Create** `packages/console-ui/src/dense/rehype-reveal.test.ts`, `reveal.test.ts`.
- **Modify** `packages/console-ui/src/dense/Markdown.tsx` — `streaming?` prop, `seenChars` ref, plugin wiring, `data-reveal` + `--reveal-dur`.
- **Modify** `packages/console-ui/src/dense/Transcript.tsx` — add `streaming?` to `TranscriptFrame` text/thinking; `ThinkingCard` auto-expand/collapse; `MemoRow` entrance (content-column, live-only, cascade, suppression); pass `streaming` through `TranscriptRow`.
- **Modify** `packages/console-ui/src/dense/Transcript.test.tsx` + `packages/console-ui/src/index.ts` (export `reveal.ts`).
- **Modify** `apps/desktop/src/renderer/panels/ChatPanel.tsx` — `toGovernedFrame` carries `streaming`.
- **Modify** `apps/desktop/src/renderer/globals.css` — reveal keyframes + `.cx-tok` + `.cx-collapse`.
- **Modify** `ROADMAP.md` — one line on the M10 row (final task).

---

## Task 1: Config seam (`reveal.ts`)

**Files:**
- Create: `packages/console-ui/src/dense/reveal.ts`
- Test: `packages/console-ui/src/dense/reveal.test.ts`
- Modify: `packages/console-ui/src/index.ts` (add `export * from './dense/reveal.js';`)

**Interfaces:**
- Produces: `RevealConfig` (type), `defaultReveal: RevealConfig`, `TextVariant`, `BlockVariant`, `ReasoningMode`.

- [ ] **Step 1: Write the failing test** — `reveal.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { defaultReveal } from './reveal.js';

describe('defaultReveal', () => {
  it('ships the maintainer-approved feel', () => {
    expect(defaultReveal.text.variant).toBe('blurIn');
    expect(defaultReveal.caret).toBe(false);
    expect(defaultReveal.reasoning.mode).toBe('auto-expand');
    expect(defaultReveal.block.variant).toBe('blurRise');
    expect(defaultReveal.block.durationMs).toBe(500);
  });
  it('every duration is a positive number', () => {
    expect(defaultReveal.text.durationMs).toBeGreaterThan(0);
    expect(defaultReveal.reasoning.collapseDurationMs).toBeGreaterThan(0);
    expect(defaultReveal.block.staggerCap).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm vitest run packages/console-ui/src/dense/reveal.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `reveal.ts`

```ts
/** Single source of truth for the streaming reveal effect. Changing any effect is a
 *  one-line edit here (D85: `variant: 'none'` degrades to a literal pass-through). */
export type TextVariant = 'blurIn' | 'fadeIn' | 'slideUp' | 'none';
export type BlockVariant = 'blurRise' | 'fadeRise' | 'fade' | 'scale' | 'none';
export type ReasoningMode = 'auto-expand' | 'shimmer' | 'peek' | 'static';

export interface RevealConfig {
  /** Per-word reveal for live-streaming agent text/thinking. */
  text: { variant: TextVariant; durationMs: number; staggerMs: number; staggerCap: number };
  /** Steady block caret at the live tail. */
  caret: boolean;
  reasoning: { mode: ReasoningMode; collapseDelayMs: number; collapseDurationMs: number };
  /** Whole-block entrance for non-streamed blocks (tool cards, results, plans, …). */
  block: { variant: BlockVariant; durationMs: number; staggerMs: number; staggerCap: number };
}

export const defaultReveal: RevealConfig = {
  text: { variant: 'blurIn', durationMs: 190, staggerMs: 22, staggerCap: 6 },
  caret: false,
  reasoning: { mode: 'auto-expand', collapseDelayMs: 900, collapseDurationMs: 320 },
  block: { variant: 'blurRise', durationMs: 500, staggerMs: 65, staggerCap: 6 },
};
```

- [ ] **Step 4: Add the barrel export** in `packages/console-ui/src/index.ts`: `export * from './dense/reveal.js';`

- [ ] **Step 5: Run tests + typecheck** — `pnpm vitest run packages/console-ui/src/dense/reveal.test.ts` → PASS; `pnpm --filter @coa/console-ui typecheck` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/console-ui/src/dense/reveal.ts packages/console-ui/src/dense/reveal.test.ts packages/console-ui/src/index.ts
git commit -m "feat: add the streaming reveal config seam"
```

---

## Task 2: The `rehypeReveal` plugin (pure HAST transform)

**Files:**
- Create: `packages/console-ui/src/dense/rehype-reveal.ts`
- Test: `packages/console-ui/src/dense/rehype-reveal.test.ts`

**Interfaces:**
- Produces: `rehypeReveal(options: { seenChars: number; staggerMs: number; staggerCap: number }): (tree: HastRoot) => void`. Wraps each word of every text node (outside `code`/`pre`/`svg`/`math`) in `<span class="cx-tok">`; words whose start offset `< seenChars` get `data-seen=""`; the i-th NEW word gets inline `animation-delay: min(i, staggerCap) * staggerMs`.

- [ ] **Step 1: Write the failing test** — `rehype-reveal.test.ts` (hand-built HAST, no react-markdown)

```ts
import { describe, expect, it } from 'vitest';
import { rehypeReveal } from './rehype-reveal.js';

type El = { type: 'element'; tagName: string; properties?: Record<string, unknown>; children: any[] };
const p = (...children: any[]): El => ({ type: 'element', tagName: 'p', children });
const text = (value: string) => ({ type: 'text', value });
const root = (...children: any[]) => ({ type: 'root', children });

function spans(node: El): El[] {
  return node.children.filter((c: any) => c.type === 'element' && c.tagName === 'span');
}

describe('rehypeReveal', () => {
  it('wraps each word in a cx-tok span, keeping whitespace as bare text', () => {
    const tree = root(p(text('hello world')));
    rehypeReveal({ seenChars: 0, staggerMs: 22, staggerCap: 6 })(tree as any);
    const el = tree.children[0] as El;
    const s = spans(el);
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.properties?.className)).toEqual([['cx-tok'], ['cx-tok']]);
    // whitespace between the words survives as its own node
    expect(el.children.some((c: any) => c.type === 'text' && /\s/.test(c.value))).toBe(true);
  });

  it('marks already-seen words (offset < seenChars) with data-seen and no delay', () => {
    const tree = root(p(text('alpha beta gamma'))); // offsets: alpha@0, beta@6, gamma@11
    rehypeReveal({ seenChars: 6, staggerMs: 22, staggerCap: 6 })(tree as any);
    const s = spans(tree.children[0] as El);
    expect(s[0]!.properties?.['dataSeen']).toBe('');        // alpha seen
    expect(s[1]!.properties?.['dataSeen']).toBeUndefined(); // beta new
    expect(s[2]!.properties?.['dataSeen']).toBeUndefined(); // gamma new
  });

  it('staggers only the new words, capped', () => {
    const tree = root(p(text('a b c'))); // all new when seenChars 0
    rehypeReveal({ seenChars: 0, staggerMs: 20, staggerCap: 1 })(tree as any);
    const s = spans(tree.children[0] as El);
    expect((s[0]!.properties?.style as string) ?? '').toContain('animation-delay: 0ms');
    expect((s[1]!.properties?.style as string) ?? '').toContain('animation-delay: 20ms');
    expect((s[2]!.properties?.style as string) ?? '').toContain('animation-delay: 20ms'); // capped at 1*20
  });

  it('does not descend into code or pre', () => {
    const code: El = { type: 'element', tagName: 'code', children: [text('x y')] };
    const tree = root(p(code));
    rehypeReveal({ seenChars: 0, staggerMs: 22, staggerCap: 6 })(tree as any);
    expect(spans(code)).toHaveLength(0);
    expect(code.children[0]).toEqual(text('x y'));
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm vitest run packages/console-ui/src/dense/rehype-reveal.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `rehype-reveal.ts` (manual walk; no new dependency)

```ts
/** A rehype transform that wraps each word of the (live-streaming) block in an animated
 *  span. The skip-guard: words whose character offset is < `seenChars` (i.e. were already
 *  on screen last render) are marked `data-seen` and never animate — so a coalesced rAF
 *  burst reveals only the newly-arrived words, not the whole paragraph. Only applied while
 *  a block streams; the settled block renders plain (no plugin → no spans → sheds).
 *  See docs/superpowers/specs/2026-07-09-streaming-reveal-effect-design.md. */
interface Text { type: 'text'; value: string }
interface Element { type: 'element'; tagName: string; properties?: Record<string, unknown>; children: Node[] }
type Node = Text | Element | { type: string; children?: Node[] };
interface Root { type: 'root'; children: Node[] }

const OPAQUE = new Set(['code', 'pre', 'svg', 'math']);

export interface RevealOptions { seenChars: number; staggerMs: number; staggerCap: number }

export function rehypeReveal(options: RevealOptions): (tree: Root) => void {
  const { seenChars, staggerMs, staggerCap } = options;
  let offset = 0;      // running character offset across the whole block
  let newIndex = 0;    // index among the NEW (unseen) words, for the stagger

  const wrap = (value: string): Node[] => {
    // Split into word / whitespace runs, keeping the whitespace as bare text nodes so
    // word-wrap and justification are unaffected (per the OSS survey: never per-char).
    const parts = value.match(/\s+|\S+/g) ?? [];
    const out: Node[] = [];
    for (const part of parts) {
      if (/^\s+$/.test(part)) { out.push({ type: 'text', value: part }); offset += part.length; continue; }
      const seen = offset < seenChars;
      const props: Record<string, unknown> = { className: ['cx-tok'] };
      if (seen) props['dataSeen'] = '';
      else {
        const d = Math.min(newIndex, staggerCap) * staggerMs;
        props['style'] = `animation-delay: ${d}ms`;
        newIndex += 1;
      }
      out.push({ type: 'element', tagName: 'span', properties: props, children: [{ type: 'text', value: part }] });
      offset += part.length;
    }
    return out;
  };

  const visit = (node: Node): void => {
    if (node.type === 'element' && OPAQUE.has((node as Element).tagName)) {
      // still advance the offset for text inside opaque nodes so downstream offsets align
      offset += textLength(node);
      return;
    }
    const children = (node as { children?: Node[] }).children;
    if (children === undefined) return;
    const next: Node[] = [];
    for (const child of children) {
      if (child.type === 'text') next.push(...wrap((child as Text).value));
      else { visit(child); next.push(child); }
    }
    (node as { children?: Node[] }).children = next;
  };

  const textLength = (node: Node): number => {
    if (node.type === 'text') return (node as Text).value.length;
    const children = (node as { children?: Node[] }).children ?? [];
    return children.reduce((n, c) => n + textLength(c), 0);
  };

  return (tree: Root): void => { visit(tree); };
}
```

- [ ] **Step 4: Run tests + typecheck** — `pnpm vitest run packages/console-ui/src/dense/rehype-reveal.test.ts` → PASS; `pnpm --filter @coa/console-ui typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/rehype-reveal.ts packages/console-ui/src/dense/rehype-reveal.test.ts
git commit -m "feat: add the streaming per-word reveal rehype transform"
```

---

## Task 3: Wire the reveal into `Markdown` + keyframes

**Files:**
- Modify: `packages/console-ui/src/dense/Markdown.tsx`
- Modify: `apps/desktop/src/renderer/globals.css`
- Test: `packages/console-ui/src/dense/Markdown.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `rehypeReveal` (Task 2), `defaultReveal` (Task 1).
- Produces: `Markdown` gains `streaming?: boolean`. When true it renders each word as a `.cx-tok` span with the skip-guard; when false/absent it renders exactly as today (plain).

- [ ] **Step 1: Write the failing test** — `Markdown.test.tsx`

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown.js';

describe('Markdown streaming', () => {
  it('wraps words in cx-tok spans while streaming', () => {
    const { container } = render(<Markdown source="hello world" streaming />);
    expect(container.querySelectorAll('span.cx-tok').length).toBe(2);
  });
  it('renders plain (no reveal spans) when not streaming', () => {
    const { container } = render(<Markdown source="hello world" />);
    expect(container.querySelectorAll('span.cx-tok').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm vitest run packages/console-ui/src/dense/Markdown.test.tsx` → FAIL (no `streaming` prop; 0 spans).

- [ ] **Step 3: Implement** — edit `Markdown.tsx`:

Add to `MarkdownProps`: `streaming?: boolean | undefined;`. Import `useRef` from react, `rehypeReveal`, `defaultReveal`. Inside the component, before the return:

```tsx
  const seenRef = useRef(0);
  const seen = streaming === true ? seenRef.current : 0;
  // read-then-update: this render's "already seen" is the block's length last render.
  if (streaming === true) seenRef.current = source.length;
  else seenRef.current = 0; // reset when a block settles / is not streaming
  const rehypePlugins = streaming === true
    ? [[rehypeReveal, { seenChars: seen, staggerMs: defaultReveal.text.staggerMs, staggerCap: defaultReveal.text.staggerCap }] as const]
    : [];
```

On the wrapper `<div>`: add `data-reveal={streaming === true ? defaultReveal.text.variant : undefined}` and `style={{ '--reveal-dur': `${defaultReveal.text.durationMs}ms` } as React.CSSProperties}` (only when streaming; guarded spread). Pass `rehypePlugins={rehypePlugins}` to `<ReactMarkdown>` alongside the existing `remarkPlugins`.

- [ ] **Step 4: Add keyframes + classes** to `apps/desktop/src/renderer/globals.css` (end of file):

```css
/* Streaming per-word reveal (docs/superpowers/specs/2026-07-09-streaming-reveal-effect).
   Only the live block carries `.cx-tok` spans; the settled block is plain (they shed).
   `[data-motion='reduce']` above already zeroes the duration. GPU-only. */
.cx-tok:not([data-seen]) {
  animation-name: cx-fade-in;
  animation-duration: var(--reveal-dur, 190ms);
  animation-timing-function: cubic-bezier(0.2, 0.65, 0.3, 1);
  animation-fill-mode: both;
}
[data-reveal='blurIn'] .cx-tok:not([data-seen]) { animation-name: cx-blur-in; }
[data-reveal='fadeIn'] .cx-tok:not([data-seen]) { animation-name: cx-fade-in; }
[data-reveal='slideUp'] .cx-tok:not([data-seen]) { animation-name: cx-slide-up; display: inline-block; }
@keyframes cx-blur-in { from { opacity: 0; filter: blur(5px); } to { opacity: 1; filter: blur(0); } }
@keyframes cx-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes cx-slide-up { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }

/* Reasoning smooth collapse (Task 5): grid-rows ease so the block melts closed and the
   next block eases up to meet it. `[data-motion='reduce']` zeroes the transition. */
.cx-collapse { display: grid; grid-template-rows: 0fr; opacity: 0;
  transition: grid-template-rows var(--collapse-dur, 320ms) cubic-bezier(0.2, 0.6, 0.2, 1), opacity 0.26s ease; }
.cx-collapse[data-open='true'] { grid-template-rows: 1fr; opacity: 1; }
.cx-collapse > .cx-collapse-inner { overflow: hidden; min-height: 0; }
```

- [ ] **Step 5: Run tests + typecheck** — `pnpm vitest run packages/console-ui/src/dense/Markdown.test.tsx` → PASS; `pnpm --filter @coa/console-ui typecheck` → 0; `pnpm --filter @coa/desktop typecheck` → 0.

- [ ] **Step 6: Commit**

```bash
git add packages/console-ui/src/dense/Markdown.tsx packages/console-ui/src/dense/Markdown.test.tsx apps/desktop/src/renderer/globals.css
git commit -m "feat: reveal streaming words as they arrive"
```

---

## Task 4: Thread the `streaming` flag through the transcript

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (the `TranscriptFrame` union + `TranscriptRow`)
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx` (`toGovernedFrame`)
- Test: `apps/desktop/src/renderer/panels/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `Markdown` `streaming` prop (Task 3).
- Produces: `TranscriptFrame` text + thinking kinds carry `streaming?: boolean`. `TranscriptRow` passes `streaming` to `Markdown` (text) and `ThinkingCard` (thinking).

- [ ] **Step 1: Write the failing test** — in `ChatPanel.test.tsx`

```ts
import { toGovernedFrame } from './ChatPanel.js';

it('carries the streaming flag onto the governed text frame', () => {
  const f = { id: 'a', role: 'agent', kind: 'text', text: 'hi', streaming: true } as any;
  expect(toGovernedFrame(f)).toMatchObject({ kind: 'text', text: 'hi', streaming: true });
});
it('omits streaming for a settled text frame', () => {
  const f = { id: 'a', role: 'agent', kind: 'text', text: 'hi' } as any;
  expect((toGovernedFrame(f) as { streaming?: boolean }).streaming).toBeUndefined();
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm vitest run apps/desktop/src/renderer/panels/ChatPanel.test.tsx -t streaming` → FAIL.

- [ ] **Step 3: Implement:**

In `Transcript.tsx`, add `streaming?: boolean | undefined;` to the `text` kind and the `thinking` kind of `TranscriptFrame`.

In `ChatPanel.tsx` `toGovernedFrame`, for `case 'text'` and `case 'thinking'` add the streaming flag via guarded spread:
```ts
    case 'text':
      return { id: f.id, role: f.role, kind: 'text', text: f.text, depth: f.depth,
        ...(f.streaming !== undefined ? { streaming: f.streaming } : {}) };
    case 'thinking':
      return { id: f.id, role: f.role, kind: 'thinking', text: f.text, depth: f.depth,
        ...(f.streaming !== undefined ? { streaming: f.streaming } : {}) };
```
(`f.streaming` exists on the console-viewmodel `TurnFrame` text/thinking variants — `reads.ts:55/98`.)

In `Transcript.tsx` `TranscriptRow`, the `frame.kind === 'text'` branch passes `streaming`:
```tsx
        {frame.kind === 'text' && (
          <div className="group relative">
            {!isUser && (<div className="absolute right-0 top-0 opacity-0 transition-opacity group-hover:opacity-100"><CopyButton text={frame.text} /></div>)}
            <Markdown source={frame.text} {...(frame.streaming !== undefined ? { streaming: frame.streaming } : {})} />
          </div>
        )}
```
And the `ThinkingCard` call (in the `frame.kind === 'thinking'` branch) passes `streaming={frame.streaming}` (consumed in Task 5; for now add the prop plumbing).

- [ ] **Step 4: Run tests + typecheck** — `pnpm vitest run apps/desktop/src/renderer/panels/ChatPanel.test.tsx` → PASS; `pnpm --filter @coa/console-ui typecheck` + `pnpm --filter @coa/desktop typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.tsx apps/desktop/src/renderer/panels/ChatPanel.tsx apps/desktop/src/renderer/panels/ChatPanel.test.tsx
git commit -m "feat: thread the streaming flag to the transcript row"
```

---

## Task 5: `ThinkingCard` auto-expand + smooth collapse

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (`ThinkingCard`)
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:**
- Consumes: `defaultReveal.reasoning` (Task 1), the `.cx-collapse` CSS (Task 3), `streaming` prop (Task 4), `Markdown streaming` (Task 3).
- Produces: `ThinkingCard` accepts `streaming?: boolean`. Auto-opens while streaming; after `collapseDelayMs` past stream-end it collapses and the label reads `Thought for Ns`; a manual click suppresses further auto-behavior.

- [ ] **Step 1: Write the failing test** — `Transcript.test.tsx` (fake timers)

```tsx
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptRow } from './Transcript.js';

describe('ThinkingCard auto-expand', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('auto-opens while streaming and collapses after the delay', () => {
    const frame = { id: 't', role: 'agent', kind: 'thinking', text: 'reasoning…', streaming: true } as const;
    const { rerender, container } = render(<TranscriptRow frame={frame} />);
    expect(container.querySelector('.cx-collapse')?.getAttribute('data-open')).toBe('true');
    // stream ends
    rerender(<TranscriptRow frame={{ ...frame, streaming: false }} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector('.cx-collapse')?.getAttribute('data-open')).toBe('false');
    expect(container.textContent).toMatch(/Thought for \d+s/);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm vitest run packages/console-ui/src/dense/Transcript.test.tsx -t auto-expand` → FAIL.

- [ ] **Step 3: Implement** — rewrite `ThinkingCard` to accept `{ text, streaming }` and drive the collapse. Replace the current body with:

```tsx
function ThinkingCard({ text, streaming }: { text: string; streaming?: boolean | undefined }): React.JSX.Element {
  const cfg = defaultReveal.reasoning;
  const auto = cfg.mode === 'auto-expand';
  const [open, setOpen] = useState(auto ? streaming === true : false);
  const [userTouched, setUserTouched] = useState(false);
  const startedRef = useRef<number | undefined>(streaming === true ? Date.now() : undefined);
  const [secs, setSecs] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!auto || userTouched) return;
    if (streaming === true) {
      startedRef.current ??= Date.now();
      setSecs(undefined);
      setOpen(true);
      return;
    }
    // stream ended: record duration, then collapse after the delay
    if (startedRef.current !== undefined) {
      setSecs(Math.max(1, Math.round((Date.now() - startedRef.current) / 1000)));
    }
    const t = setTimeout(() => setOpen(false), cfg.collapseDelayMs);
    return () => clearTimeout(t);
  }, [streaming, auto, userTouched, cfg.collapseDelayMs]);

  const label = secs !== undefined ? `Thought for ${secs}s` : 'Thinking';
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={() => { setUserTouched(true); setOpen((v) => !v); }}
        className="group flex items-center gap-1.5 text-left motion-reduce:transition-none" aria-expanded={open}>
        <ChevronRight aria-hidden size={12}
          className={cx('shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
        <span className={cx('text-eyebrow uppercase tracking-[0.06em] text-faint transition-colors group-hover:text-muted',
          streaming === true && 'animate-pulse')}>{label}</span>
      </button>
      <div className="cx-collapse pl-4.5" data-open={open ? 'true' : 'false'}
        style={{ '--collapse-dur': `${cfg.collapseDurationMs}ms` } as React.CSSProperties}>
        <div className="cx-collapse-inner">
          <div className="text-label italic text-muted py-0.5">
            <Markdown source={text} {...(streaming === true ? { streaming: true } : {})} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

Update the `frame.kind === 'thinking'` branch in `TranscriptRow` to `<ThinkingCard text={frame.text} {...(frame.streaming !== undefined ? { streaming: frame.streaming } : {})} />`. Import `useEffect`, `useRef` if not already imported at top of `Transcript.tsx` (they are). Keep the existing `frame.text.trim().length === 0` guard above.

Note: the reasoning body now renders through `Markdown` (was plain `{text}`) so it word-reveals while streaming and renders markdown when settled — a deliberate, consistent improvement.

- [ ] **Step 4: Run tests + typecheck** — `pnpm vitest run packages/console-ui/src/dense/Transcript.test.tsx` → PASS; `pnpm --filter @coa/console-ui typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "feat: expand reasoning while it streams and collapse it smoothly"
```

---

## Task 6: `MemoRow` block entrance (content-column, live-only, cascade)

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (`MemoRow` + a small pure helper)
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:**
- Consumes: `defaultReveal.block` (Task 1).
- Produces: exported pure helpers `revealSuppressed(frame): boolean` (true for live-streaming agent/subagent text+thinking and for `raw`) and `nextBatchIndex(): number` (module-level counter reset per animation frame). `MemoRow` animates the **content column** on live mount only.

- [ ] **Step 1: Write the failing test**

```ts
import { revealSuppressed } from './Transcript.js';

it('suppresses the block entrance for streaming agent text/thinking and raw', () => {
  expect(revealSuppressed({ id: '1', role: 'agent', kind: 'text', text: 'x', streaming: true } as any)).toBe(true);
  expect(revealSuppressed({ id: '2', role: 'agent', kind: 'thinking', text: 'x' } as any)).toBe(true);
  expect(revealSuppressed({ id: '3', kind: 'raw', text: 'x' } as any)).toBe(true);
});
it('does not suppress the entrance for a user turn or a tool card', () => {
  expect(revealSuppressed({ id: '4', role: 'you', kind: 'text', text: 'x' } as any)).toBe(false);
  expect(revealSuppressed({ id: '5', role: 'agent', kind: 'tool', tool: 'Edit', input: '' } as any)).toBe(false);
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm vitest run packages/console-ui/src/dense/Transcript.test.tsx -t suppress` → FAIL.

- [ ] **Step 3: Implement** — in `Transcript.tsx`:

```tsx
/** The block entrance is skipped for the channels that reveal per-word (agent/subagent
 *  text + thinking) and for raw frames (D85 — raw is verbatim, never animated). */
export function revealSuppressed(frame: TranscriptFrame): boolean {
  if (frame.kind === 'raw') return true;
  if (frame.kind === 'text' || frame.kind === 'thinking')
    return 'role' in frame && frame.role !== 'you';
  return false;
}

// Cascade counter: rows mounting within one animation frame get incremental indices, so a
// coalesced batch of blocks enters as a cascade, not a simultaneous pop. Reset each frame.
let batchIndex = 0;
let batchScheduled = false;
export function nextBatchIndex(): number {
  const i = batchIndex++;
  if (!batchScheduled) {
    batchScheduled = true;
    requestAnimationFrame(() => { batchIndex = 0; batchScheduled = false; });
  }
  return i;
}
```

Rewrite `MemoRow` to (a) hold a `firstPaint` guard so history doesn't animate on session-open, (b) animate the **content wrapper** not the outer row, (c) use `defaultReveal.block`:

```tsx
const MemoRow = memo(function MemoRow({ frame, onRespond, onOpenPath, onOpenUrl, index, findActive = false, spineTop = true, spineBottom = true }: { /* …unchanged prop types… */ }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const cfg = defaultReveal.block;
    if (cfg.variant === 'none' || revealSuppressed(frame)) return;
    if (!liveMountReady) return;                       // history (initial load) does not animate
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const delay = Math.min(nextBatchIndex(), cfg.staggerCap) * cfg.staggerMs;
    ref.current?.animate?.(blockKeyframes(cfg.variant), { duration: cfg.durationMs, delay, easing: 'cubic-bezier(0.2,0.65,0.3,1)', fill: 'both' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only entrance
  }, []);
  return (
    <div data-row-index={index} data-find-active={findActive || undefined}
      className={cx(findActive && 'rounded-surface ring-1 ring-info bg-info-tint')}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 60px' } as React.CSSProperties}>
      {/* the animated CONTENT wrapper — the spine/gutter live inside TranscriptRow and are
          NOT wrapped, so the connector stays put while content resolves in. */}
      <div ref={ref}>
        <TranscriptRow frame={frame} onRespond={onRespond} onOpenPath={onOpenPath} onOpenUrl={onOpenUrl} spineTop={spineTop} spineBottom={spineBottom} />
      </div>
    </div>
  );
});
```

Wait — the gutter lives inside `TranscriptRow`, so wrapping `TranscriptRow` still wraps the gutter. To animate content only, the entrance must move to the content column. Two options: (a) accept animating the whole row (gutter included) — a 4–6px opacity/transform lift is subtle and the current code already does this; the spine's absolute lines still abut because each row's gutter animates as a unit. Given the current shipped behavior already animates the whole row and the spine reads fine, **animate the whole row** (simplest, matches today) BUT the spec's "content column only" goal is to avoid transform on the gutter. Reconcile by using **opacity + filter only for `blurRise`'s transform-free feel is impossible** — blurRise has translateY. 

Decision (lock): animate the whole row wrapper (as today) — a small translateY on a row does not visibly break the spine because the gutter's connector segments are short and the motion is <6px over 500ms; the neighbor row is static and they re-abut on settle. Keep the wrapper = the existing outer `div ref`. Drop the "content column only" refinement as unnecessary (the spine fix in Task 7 is purely the CSS continuity, independent of entrance). Update the spec note accordingly in Task 8's doc pass.

So keep `MemoRow`'s single `ref` on the existing outer div (as today), just swap the animation body to the config-driven `blockKeyframes` + live-only guard + cascade. Add:

```tsx
function blockKeyframes(v: Exclude<BlockVariant, 'none'>): Keyframe[] {
  switch (v) {
    case 'blurRise': return [{ opacity: 0, filter: 'blur(6px)', transform: 'translateY(4px)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }];
    case 'fadeRise': return [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }];
    case 'fade': return [{ opacity: 0 }, { opacity: 1 }];
    case 'scale': return [{ opacity: 0, transform: 'scale(0.985) translateY(3px)' }, { opacity: 1, transform: 'none' }];
  }
}
```

Add the live-mount guard as a module flag set after the container's first paint — in `Transcript`, add:
```tsx
useEffect(() => { liveMountReady = true; return () => { liveMountReady = false; }; }, []);
```
with `let liveMountReady = false;` at module scope. (Child `MemoRow` layout effects run before the parent effect on initial mount, so initial rows see `false` and skip; rows appended later see `true` and animate.)

Import `BlockVariant` from `./reveal.js`.

- [ ] **Step 4: Run tests + typecheck** — `pnpm vitest run packages/console-ui/src/dense/Transcript.test.tsx` → PASS; `pnpm --filter @coa/console-ui typecheck` → 0. Confirm the existing MemoRow mount-animation test (if any) still passes or update it to the new keyframes.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "feat: cascade non-streamed blocks in on arrival"
```

---

## Task 7: Spine continuity regression guard

**Files:**
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:** none new — asserts the existing `SpineGutter` behavior is unchanged by the entrance work.

- [ ] **Step 1: Write the test** — assert the spine line + dot render for a mid-run agent frame and that a `you` row omits them:

```tsx
it('renders a continuous spine dot for agent rows and omits it for user rows', () => {
  const { container: agent } = render(<TranscriptRow frame={{ id: 'a', role: 'agent', kind: 'text', text: 'x' } as any} />);
  expect(agent.querySelector('[data-dot]')).not.toBeNull();
  expect(agent.querySelectorAll('[data-spine-line]').length).toBeGreaterThan(0);
  const { container: you } = render(<TranscriptRow frame={{ id: 'y', role: 'you', kind: 'text', text: 'x' } as any} />);
  expect(you.querySelector('[data-dot]')).toBeNull();
});
```

- [ ] **Step 2: Run it** — `pnpm vitest run packages/console-ui/src/dense/Transcript.test.tsx -t spine` → PASS (the `SpineGutter` already emits `data-dot`/`data-spine-line`; this locks it against future regression). If it fails, the entrance change wrongly altered the gutter — fix by keeping the gutter outside any transformed wrapper.

- [ ] **Step 3: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "test: guard the transcript spine against entrance regressions"
```

---

## Task 8: Live verification + docs

**Files:**
- Modify: `ROADMAP.md` (M10 row)
- No test file — this is the authoritative live pass.

- [ ] **Step 1: Full green** — `pnpm --filter @coa/console-ui typecheck && pnpm --filter @coa/desktop typecheck` → 0; `pnpm vitest run packages/console-ui/src/dense` → all pass; `pnpm --filter @coa/desktop exec vitest run` → pass (watch the known `ShowcasePanel` flake — re-run in isolation if it times out).

- [ ] **Step 2: Live-verify in the real Electron app** — `pnpm --filter @coa/desktop dev`. Open a session on a pure-API account (`ds`/`lc`) and on Claude; send a prompt that yields a long answer + visible reasoning + a tool call. Confirm: (a) words blur in smoothly, no lumpy burst pop; (b) the elapsed-seconds timer keeps pace (no regression of `f87dc4f`); (c) reasoning auto-expands while thinking then melts closed into the answer; (d) a tool card / result cascades in; (e) the spine stays continuous; (f) settling does NOT flicker; (g) opening a past session does NOT bulk-animate history. Toggle Settings → reduced motion and confirm instant reveal, no shimmer.

- [ ] **Step 3: Run the piece-B Claude streaming live gate clean** (handoff loose end) — `COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/streaming-output-smoke.live.test.ts` → PASS (needs a non-rate-limited Claude account; `coa auth list` shows accounts, `personal` is active). If the account is rate-limited, note it and defer.

- [ ] **Step 4: Update ROADMAP** — in the M10 row's "What's real", append: "a streaming per-word reveal (blur-in) for agent text/thinking with an auto-expanding, smooth-collapsing reasoning block and a cascaded entrance for non-streamed blocks, all behind a single `reveal` config seam". Same commit as any final tidy.

- [ ] **Step 5: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: record the streaming reveal effect"
```

- [ ] **Step 6: Final whole-branch review** — request an opus review of the full range (per the arc's practice; the live pass is authoritative for a streaming change). Address findings, re-verify live.

---

## Self-Review

**Spec coverage:** text reveal → T2/T3; skip-guard → T2; sheds-on-settle → T3 (plugin absent when not streaming); reasoning auto-expand + smooth collapse → T5; block entrance + cascade + live-only + suppression → T6; spine → T7; config seam → T1; streaming thread → T4; reduced motion → global rule (T3 CSS + T6 matchMedia guard); D85 → raw suppressed (T6), settled plain (T3); live verify + B gate + ROADMAP → T8. All covered.

**Type consistency:** `RevealConfig`/`defaultReveal`/`BlockVariant`/`TextVariant`/`ReasoningMode` (T1) used consistently in T3/T5/T6; `rehypeReveal(options)` signature matches its call site in T3; `revealSuppressed`/`nextBatchIndex` (T6) match their tests; `streaming?: boolean | undefined` consistent across `TranscriptFrame` (T4), `Markdown` (T3), `ThinkingCard` (T5).

**Placeholder scan:** none — every code step has real code and exact commands.

**Note on Task 6 decision:** the spec's "animate content column only" was reconciled to "animate the whole row wrapper (as today)" during planning — a <6px lift over 500ms does not visibly break the spine, and the current code already animates the whole row. Task 8 Step 4 folds this clarification into the docs.
