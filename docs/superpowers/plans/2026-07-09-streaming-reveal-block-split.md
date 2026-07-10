# Streaming per-word reveal via a block-split `StreamingMarkdown` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **SHIPPED WITH A LIVE-DRIVEN REVISION (2026-07-09).** This plan was executed, then the maintainer
> live-tested and revised the trailing-block behavior: a per-word prose trailing block that
> reformatted on completion read as jarring (a re-blur + a width reflow), and markdown that streamed
> per-word-raw then reformatted was unwanted. Final shipped behavior: **agent output reveals whole
> markdown blocks only** (the in-progress block is held until it completes; nothing streams per-word),
> and **the reasoning trace is the only per-word surface**. `StreamingMarkdown` gained a `perWord`
> prop; `FormingCodeBlock`, `parseOpenFence`, and structured-block detection were removed as unused
> under this model. Tasks 1–3 below describe the block-split scaffold that still stands; the
> trailing-per-word specifics in Task 2 were superseded by the whole-blocks-only output.

**Goal:** Give the live transcript a performant, actually-visible per-word reveal by splitting the accumulating agent/reasoning text into markdown blocks: completed blocks render formatted + memoized (parsed once) with a one-time whole-block entrance, while the trailing in-progress block reveals per-word as plain text with **stable React keys** (so already-shown words never remount and their one-shot blur completes).

**Architecture:** A new console-only `StreamingMarkdown` component (`packages/console-ui/src/dense/`) fed by a pure, fenced-code-aware splitter. It replaces `<Markdown streaming>` at the two live callers (`TranscriptRow` agent-text branch + `ThinkingCard` reasoning body). Completed-block entrance and per-word blur are CSS one-shots keyed off the existing `defaultReveal` config seam; keyframes live in `apps/desktop/src/renderer/globals.css` (the established home). Settled/reloaded blocks stay plain `<Markdown>` (D85, byte-identical). No daemon/adapter/schema/persistence touch.

**Tech Stack:** React 19 (StrictMode ON), TypeScript strict (`exactOptionalPropertyTypes` ON), `react-markdown` + `remark-gfm` (already used by `Markdown`), Tailwind v4, Vitest + jsdom + `@testing-library/react`.

## Global Constraints

- **TypeScript strict, no `any`.** `exactOptionalPropertyTypes` is ON — optional fields via guarded spreads (`...(x !== undefined ? { x } : {})`), never `x: undefined`.
- **Run typecheck, not just eslint+vitest** — `pnpm --filter @coa/console-ui typecheck` and `pnpm --filter @coa/desktop typecheck` (`tsc -b` excludes `.test` files, so a broken test only surfaces under vitest).
- **Do NOT reveal per-word through react-markdown.** react-markdown re-parses the whole block every frame → remounts the word spans → animation restarts each ~16ms → invisible + laggy. The trailing block is **plain text with stable keys**; react-markdown is only for settled/completed blocks (parsed once).
- **Never mutate a ref during render** (StrictMode double-renders). The split is a pure `useMemo`; per-word state lives in stable keys, not render-time refs. (This is why the old `seenChars` approach is gone.)
- **D85** — a settled or reloaded transcript is byte-identical to plain `<Markdown>`; `coa raw` frames never get the reveal; reload (opening a past session) must NOT animate. `StreamingMarkdown` is only mounted while `streaming === true`, so it never renders history.
- **Perf** — opacity/filter/transform only; no per-frame markdown parse of the growing block; the only layout animation anywhere is the (pre-existing) reasoning collapse. Per-frame cost = the small trailing block's words + one cheap string split; completed blocks are memoized so react-markdown parses each once.
- **Reduced motion** — honored globally by `[data-motion='reduce'] *` in globals.css (zeroes animation-duration). No per-effect media query needed; there is no WAAPI path in this plan.
- **Commits:** subject-only Conventional Commits, no body, no trailer, no module/phase IDs. Stage files BY NAME. Never `git add -A`. Never stage `DEV-NOTES.md`, `TEMP.txt`, `project.md`, or `docs/superpowers/plans/2026-07-08-sdk-streaming-input-steering.md`. One logical unit per commit.
- **Live verification is authoritative.** Every streaming bug in this arc was invisible to fakes. A green vitest suite is necessary, not sufficient — Task 4 verifies in the real Electron app.
- **Some pnpm packages lack a `test` script** — use `pnpm vitest run <path>`. The exit code is authoritative even when console-ui prints nothing.

---

## File Structure

- **Create** `packages/console-ui/src/dense/markdownBlocks.ts` — pure helpers: `splitStreamingMarkdown`, `splitWords`, `parseOpenFence` (fenced-code-aware; no DOM, no React).
- **Create** `packages/console-ui/src/dense/markdownBlocks.test.ts` — the pure-core TDD (the heaviest test surface; the animation is live-only).
- **Create** `packages/console-ui/src/dense/StreamingMarkdown.tsx` — the component + its `CompletedBlock` (memoized), `TrailingProse` (per-word stable keys), `FormingCodeBlock` (open fence) subcomponents.
- **Create** `packages/console-ui/src/dense/StreamingMarkdown.test.tsx` — render tests (span structure, completed vs trailing, forming code, stable-key node reuse).
- **Modify** `packages/console-ui/src/dense/Transcript.tsx` — `TranscriptRow` agent-text branch + `ThinkingCard` body switch to `StreamingMarkdown` while streaming.
- **Modify** `packages/console-ui/src/dense/Markdown.tsx` — remove the now-dead `streaming` no-op prop + its stale doc comment.
- **Modify** `packages/console-ui/src/index.ts` — export `StreamingMarkdown`.
- **Modify** `apps/desktop/src/renderer/globals.css` — `.cx-word` per-word keyframes + `.cx-block-enter` whole-block keyframes.
- **Modify** `packages/console-ui/src/dense/Transcript.test.tsx` — caller-branch tests.
- **Modify** `ROADMAP.md` (M10 row), `docs/superpowers/specs/2026-07-09-streaming-reveal-effect-design.md` (supersede §2), and the old plan `docs/superpowers/plans/2026-07-09-streaming-reveal-effect.md` (mark superseded) — Task 4, same commit as final tidy.

---

## Task 1: The pure block splitter (`markdownBlocks.ts`)

The testable core. Fenced-code-aware, append-only friendly, pure. TDD heavily.

**Files:**
- Create: `packages/console-ui/src/dense/markdownBlocks.ts`
- Test: `packages/console-ui/src/dense/markdownBlocks.test.ts`

**Interfaces:**
- Produces:
  - `interface StreamSplit { completed: string[]; trailing: string; trailingIsOpenCode: boolean }`
  - `splitStreamingMarkdown(text: string): StreamSplit` — completed blocks (each a settled markdown block), the in-progress trailing region, and whether that trailing region is an unclosed code fence.
  - `interface WordToken { value: string; word: boolean }` and `splitWords(text: string): WordToken[]` — word / whitespace runs, whitespace preserved.
  - `parseOpenFence(text: string): { language?: string; body: string }` — the language + partial body of an open fence.

- [ ] **Step 1: Write the failing test** — `markdownBlocks.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseOpenFence, splitStreamingMarkdown, splitWords } from './markdownBlocks.js';

describe('splitStreamingMarkdown', () => {
  it('treats a single in-progress paragraph as the trailing block', () => {
    expect(splitStreamingMarkdown('hello world')).toEqual({
      completed: [],
      trailing: 'hello world',
      trailingIsOpenCode: false,
    });
  });

  it('is empty for empty input', () => {
    expect(splitStreamingMarkdown('')).toEqual({ completed: [], trailing: '', trailingIsOpenCode: false });
  });

  it('splits a completed paragraph (blank-line boundary) from the trailing one', () => {
    expect(splitStreamingMarkdown('para one\n\npara two')).toEqual({
      completed: ['para one'],
      trailing: 'para two',
      trailingIsOpenCode: false,
    });
  });

  it('does NOT complete a paragraph on a trailing single newline (soft-break ambiguity)', () => {
    // 'para\n' could still gain a soft-break continuation next frame — must stay trailing,
    // or completed[] would flip-flop and break append-only stability + memo keys.
    expect(splitStreamingMarkdown('para\n')).toEqual({
      completed: [],
      trailing: 'para',
      trailingIsOpenCode: false,
    });
    expect(splitStreamingMarkdown('para\nmore')).toEqual({
      completed: [],
      trailing: 'para\nmore',
      trailingIsOpenCode: false,
    });
  });

  it('completes a paragraph on a confirmed blank line even before the next block arrives', () => {
    expect(splitStreamingMarkdown('para\n\n')).toEqual({
      completed: ['para'],
      trailing: '',
      trailingIsOpenCode: false,
    });
  });

  it('flags an open code fence as the trailing block', () => {
    expect(splitStreamingMarkdown('```js\nconst x = 1')).toEqual({
      completed: [],
      trailing: '```js\nconst x = 1',
      trailingIsOpenCode: true,
    });
  });

  it('closes a fence into a completed block (highlighting happens on render)', () => {
    expect(splitStreamingMarkdown('```js\nconst x = 1\n```')).toEqual({
      completed: ['```js\nconst x = 1\n```'],
      trailing: '',
      trailingIsOpenCode: false,
    });
  });

  it('keeps blank lines inside a fence (not a block boundary)', () => {
    expect(splitStreamingMarkdown('```\na\n\nb')).toEqual({
      completed: [],
      trailing: '```\na\n\nb',
      trailingIsOpenCode: true,
    });
  });

  it('flushes prose before a fence that opens without a blank line', () => {
    expect(splitStreamingMarkdown('intro\n```js\nx')).toEqual({
      completed: ['intro'],
      trailing: '```js\nx',
      trailingIsOpenCode: true,
    });
  });

  it('appends only (earlier completed blocks are stable as text grows)', () => {
    const a = splitStreamingMarkdown('one\n\ntwo\n\nthr');
    expect(a.completed).toEqual(['one', 'two']);
    const b = splitStreamingMarkdown('one\n\ntwo\n\nthree');
    expect(b.completed).toEqual(['one', 'two']); // unchanged prefix
    expect(b.trailing).toBe('three');
  });
});

describe('splitWords', () => {
  it('splits into word and whitespace runs, preserving whitespace', () => {
    expect(splitWords('a  b')).toEqual([
      { value: 'a', word: true },
      { value: '  ', word: false },
      { value: 'b', word: true },
    ]);
  });
  it('is empty for empty text', () => {
    expect(splitWords('')).toEqual([]);
  });
});

describe('parseOpenFence', () => {
  it('reads the language + partial body of an open fence', () => {
    expect(parseOpenFence('```js\nconst x = 1')).toEqual({ language: 'js', body: 'const x = 1' });
  });
  it('omits the language when the opener has no info string', () => {
    expect(parseOpenFence('```\ncode')).toEqual({ body: 'code' });
  });
  it('has an empty body when only the opener has arrived', () => {
    expect(parseOpenFence('```js')).toEqual({ language: 'js', body: '' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm vitest run packages/console-ui/src/dense/markdownBlocks.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `markdownBlocks.ts`

```ts
/** Pure, fenced-code-aware segmentation of accumulating streamed markdown into settled blocks
 *  plus the in-progress trailing region. A blank line is a block boundary only when NOT inside a
 *  ``` / ~~~ fence; a closing fence ends its block; a trailing single newline stays trailing
 *  (soft-break ambiguity) so `completed` is append-only as text grows. Append-only is what lets
 *  the caller memoize each completed block by content and key it by index. No DOM, no React;
 *  re-run each frame under `useMemo` (StrictMode-safe — no mutation).
 *  See docs/superpowers/plans/2026-07-09-streaming-reveal-block-split.md. */
export interface StreamSplit {
  completed: string[];
  trailing: string;
  trailingIsOpenCode: boolean;
}

const FENCE = /^\s*(`{3,}|~{3,})/;

function fenceChar(line: string): '`' | '~' | undefined {
  const m = FENCE.exec(line);
  if (m === null) return undefined;
  return m[1]![0] as '`' | '~';
}

/** A closing fence: the marker char repeated (>=3), only whitespace around it, no info string. */
function isFenceClose(line: string, ch: '`' | '~'): boolean {
  const t = line.trim();
  return t.length >= 3 && [...t].every((c) => c === ch);
}

export function splitStreamingMarkdown(text: string): StreamSplit {
  const lines = text.split('\n');
  const completed: string[] = [];
  let current: string[] = [];
  let fence: '`' | '~' | undefined;

  const flush = (): void => {
    if (current.length > 0) {
      completed.push(current.join('\n'));
      current = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const isLast = i === lines.length - 1;

    if (fence !== undefined) {
      current.push(line);
      if (isFenceClose(line, fence)) {
        // A closing fence unambiguously ends the block, even as the last line so far — its
        // content is frozen (append-only), so completing it now is safe.
        fence = undefined;
        flush();
      }
      continue;
    }

    const ch = fenceChar(line);
    if (ch !== undefined) {
      flush(); // any prose before the fence is its own completed block
      fence = ch;
      current.push(line);
      continue;
    }

    if (line.trim() === '') {
      // A blank line ends a block — but a TRAILING blank (the final line) is left pending: the
      // stream may add a soft-break continuation next frame. Only an interior blank commits.
      if (!isLast) flush();
      continue;
    }

    current.push(line);
  }

  return {
    completed,
    trailing: current.join('\n'),
    trailingIsOpenCode: fence !== undefined,
  };
}

export interface WordToken {
  value: string;
  /** True for a non-whitespace run (an animated word), false for a whitespace run. */
  word: boolean;
}

/** Split into alternating word / whitespace runs, keeping whitespace as its own tokens so
 *  wrapping is unaffected (per the OSS survey: never split per-character). */
export function splitWords(text: string): WordToken[] {
  return (text.match(/\s+|\S+/g) ?? []).map((value) => ({ value, word: /\S/.test(value) }));
}

/** The language + partial body of an OPEN fence (first line is the ```/~~~ opener). */
export function parseOpenFence(text: string): { language?: string; body: string } {
  const nl = text.indexOf('\n');
  const opener = nl === -1 ? text : text.slice(0, nl);
  const language = opener.replace(FENCE, '').trim();
  const body = nl === -1 ? '' : text.slice(nl + 1);
  return { ...(language !== '' ? { language } : {}), body };
}
```

- [ ] **Step 4: Run tests + typecheck** — `pnpm vitest run packages/console-ui/src/dense/markdownBlocks.test.ts` → PASS; `pnpm --filter @coa/console-ui typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/markdownBlocks.ts packages/console-ui/src/dense/markdownBlocks.test.ts
git commit -m "feat: add a fenced-code-aware streaming markdown block splitter"
```

---

## Task 2: The `StreamingMarkdown` component + keyframes

**Files:**
- Create: `packages/console-ui/src/dense/StreamingMarkdown.tsx`
- Create: `packages/console-ui/src/dense/StreamingMarkdown.test.tsx`
- Modify: `apps/desktop/src/renderer/globals.css`
- Modify: `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `splitStreamingMarkdown`, `splitWords`, `parseOpenFence` (Task 1), `defaultReveal` (`reveal.ts`), `Markdown` (`Markdown.tsx`).
- Produces: `interface StreamingMarkdownProps { source: string; muted?: boolean | undefined }` and `StreamingMarkdown(props): React.JSX.Element`. While mounted (streaming only), it renders completed blocks as memoized formatted `<Markdown>` (each with a one-time `.cx-block-enter`) plus the trailing block as per-word `.cx-word` spans (or a `.cx-block-enter` forming code container when the trailing region is an open fence).

- [ ] **Step 1: Write the failing test** — `StreamingMarkdown.test.tsx`

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StreamingMarkdown } from './StreamingMarkdown.js';

describe('StreamingMarkdown', () => {
  it('reveals the trailing in-progress paragraph per word', () => {
    const { container } = render(<StreamingMarkdown source="hello world" />);
    expect(container.querySelectorAll('span.cx-word').length).toBe(2);
  });

  it('renders a completed block as formatted markdown + a trailing per-word block', () => {
    const { container } = render(<StreamingMarkdown source={'para one\n\npara two'} />);
    // completed block parsed to a real <p>; trailing "para two" is two cx-word spans
    expect(container.querySelector('.cx-block-enter p')?.textContent).toBe('para one');
    expect(container.querySelectorAll('span.cx-word').length).toBe(2);
  });

  it('shows an OPEN fence as a forming code container (not per-word)', () => {
    const { container } = render(<StreamingMarkdown source={'```js\nconst x = 1'} />);
    expect(container.querySelector('pre')?.textContent).toContain('const x = 1');
    expect(container.querySelectorAll('span.cx-word').length).toBe(0);
  });

  it('reuses already-revealed word nodes across frames (stable keys)', () => {
    const { container, rerender } = render(<StreamingMarkdown source="alpha beta" />);
    const first = container.querySelectorAll('span.cx-word')[0];
    rerender(<StreamingMarkdown source="alpha beta gamma" />);
    const after = container.querySelectorAll('span.cx-word');
    expect(after.length).toBe(3);
    // the first word is the SAME DOM node — React reused it, so its one-shot blur is not restarted
    expect(after[0]).toBe(first);
  });

  it('does not render the reveal for a settled (non-fence) block boundary', () => {
    // trailing empty when input ends on a confirmed blank line
    const { container } = render(<StreamingMarkdown source={'done\n\n'} />);
    expect(container.querySelectorAll('span.cx-word').length).toBe(0);
    expect(container.querySelector('.cx-block-enter p')?.textContent).toBe('done');
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm vitest run packages/console-ui/src/dense/StreamingMarkdown.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement** — `StreamingMarkdown.tsx`

```tsx
import { memo, useMemo } from 'react';
import { cx } from '../lib/cx.js';
import { Markdown } from './Markdown.js';
import { defaultReveal } from './reveal.js';
import { parseOpenFence, splitStreamingMarkdown, splitWords } from './markdownBlocks.js';

export interface StreamingMarkdownProps {
  /** The accumulating streamed text (grows every frame). */
  source: string;
  /** Muted foreground for secondary prose (the reasoning trace). */
  muted?: boolean | undefined;
}

/** A completed markdown block: parsed to formatted Markdown ONCE — memoized by content so a later
 *  streamed frame never re-parses it (this is what keeps per-frame cost at O(trailing) and kills
 *  the old whole-block re-parse lag). A one-time `.cx-block-enter` plays as the block arrives;
 *  memoized blocks are never remounted, so it never re-runs. */
const CompletedBlock = memo(function CompletedBlock({
  content,
  muted,
}: {
  content: string;
  muted?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div
      className="cx-block-enter"
      data-enter={defaultReveal.block.variant}
      style={{ '--enter-dur': `${defaultReveal.block.durationMs}ms` } as React.CSSProperties}
    >
      <Markdown source={content} muted={muted} />
    </div>
  );
});

/** The trailing in-progress prose: per-word, append-only, PLAIN TEXT with STABLE KEYS (key = token
 *  index). React reuses each word's DOM node across frames, so an already-revealed word is never
 *  remounted (its one-shot blur completes instead of restarting each ~16ms) and the growing last
 *  word only updates its text content — only a newly-arrived word mounts + animates. Whitespace
 *  stays as bare keyed nodes and the container preserves it (`whitespace-pre-wrap`) so wrapping is
 *  unaffected. Font/leading mirror `Markdown` so the swap to formatted on completion doesn't jump. */
function TrailingProse({
  text,
  muted,
}: {
  text: string;
  muted?: boolean | undefined;
}): React.JSX.Element {
  const tokens = splitWords(text);
  return (
    <div
      className={cx(
        'whitespace-pre-wrap wrap-break-word text-body leading-[1.5]',
        muted ? 'text-muted' : 'text-fg',
      )}
      data-reveal={defaultReveal.text.variant}
      style={{ '--reveal-dur': `${defaultReveal.text.durationMs}ms` } as React.CSSProperties}
    >
      {tokens.map((t, i) =>
        t.word ? (
          <span key={i} className="cx-word">
            {t.value}
          </span>
        ) : (
          <span key={i}>{t.value}</span>
        ),
      )}
    </div>
  );
}

/** A trailing OPEN code fence: a monospace container that fills in steadily (NOT per-word). When
 *  the fence closes it becomes a completed block and settles into the highlighted `CodeBlock` (via
 *  Markdown) with the whole-block entrance — structured markdown "arrives as a block" while prose
 *  flows per-word. Chrome mirrors `CodeBlock` so the settle swap is near-seamless. */
function FormingCodeBlock({ text }: { text: string }): React.JSX.Element {
  const { language, body } = parseOpenFence(text);
  return (
    <div
      className="cx-block-enter rounded-surface border border-hairline bg-subtle"
      data-enter={defaultReveal.block.variant}
      style={{ '--enter-dur': `${defaultReveal.block.durationMs}ms` } as React.CSSProperties}
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-eyebrow uppercase tracking-[0.06em] text-faint">{language ?? 'text'}</span>
      </div>
      <div className="overflow-x-auto p-2">
        <pre className="whitespace-pre font-mono text-label">{body}</pre>
      </div>
    </div>
  );
}

/** Live-only renderer for a streaming agent-text / reasoning block. The caller mounts this ONLY
 *  while `streaming === true` and swaps to plain `<Markdown>` on settle (D85 — byte-identical, no
 *  re-animate). Splits the accumulating text into settled blocks (formatted, memoized, entrance)
 *  plus a trailing block (per-word prose, or a forming code container). */
export function StreamingMarkdown({ source, muted }: StreamingMarkdownProps): React.JSX.Element {
  const { completed, trailing, trailingIsOpenCode } = useMemo(
    () => splitStreamingMarkdown(source),
    [source],
  );
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {completed.map((block, i) => (
        <CompletedBlock key={i} content={block} muted={muted} />
      ))}
      {trailing.length > 0 &&
        (trailingIsOpenCode ? (
          <FormingCodeBlock text={trailing} />
        ) : (
          <TrailingProse text={trailing} muted={muted} />
        ))}
    </div>
  );
}
```

- [ ] **Step 4: Add the keyframes** to `apps/desktop/src/renderer/globals.css` (append after the `.cx-collapse` block, ~line 259):

```css
/* Streaming per-word reveal (docs/superpowers/plans/2026-07-09-streaming-reveal-block-split.md).
   The trailing in-progress block renders each word as a `.cx-word` span with a STABLE React key,
   so an already-revealed word is never remounted — each word's one-shot blur runs exactly once as
   it arrives (the fix for the react-markdown per-frame remount that made words invisible). GPU-only
   (opacity/filter/transform). `[data-motion='reduce'] *` above already zeroes the duration. */
.cx-word {
  display: inline-block;
  animation-name: cx-word-fade-in;
  animation-duration: var(--reveal-dur, 190ms);
  animation-timing-function: cubic-bezier(0.2, 0.65, 0.3, 1);
  animation-fill-mode: both;
}
[data-reveal='blurIn'] .cx-word { animation-name: cx-word-blur-in; }
[data-reveal='fadeIn'] .cx-word { animation-name: cx-word-fade-in; }
[data-reveal='slideUp'] .cx-word { animation-name: cx-word-slide-up; }
[data-reveal='none'] .cx-word { animation: none; }
@keyframes cx-word-blur-in { from { opacity: 0; filter: blur(5px); } to { opacity: 1; filter: blur(0); } }
@keyframes cx-word-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes cx-word-slide-up { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }

/* Whole-block entrance for a completed streamed block as it "arrives" (blocks come in as whole
   blocks; prose flows per-word above). One-shot on mount; memoized blocks never re-run it. Variant
   + duration come from `defaultReveal.block`. `[data-motion='reduce']` zeroes it. */
.cx-block-enter {
  animation-duration: var(--enter-dur, 500ms);
  animation-timing-function: cubic-bezier(0.2, 0.65, 0.3, 1);
  animation-fill-mode: both;
}
.cx-block-enter[data-enter='blurRise'] { animation-name: cx-block-blur-rise; }
.cx-block-enter[data-enter='fadeRise'] { animation-name: cx-block-fade-rise; }
.cx-block-enter[data-enter='fade'] { animation-name: cx-block-fade; }
.cx-block-enter[data-enter='scale'] { animation-name: cx-block-scale; }
.cx-block-enter[data-enter='none'] { animation: none; }
@keyframes cx-block-blur-rise { from { opacity: 0; filter: blur(6px); transform: translateY(4px); } to { opacity: 1; filter: blur(0); transform: none; } }
@keyframes cx-block-fade-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes cx-block-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cx-block-scale { from { opacity: 0; transform: scale(0.985) translateY(3px); } to { opacity: 1; transform: none; } }
```

- [ ] **Step 5: Export** from `packages/console-ui/src/index.ts` — beside the existing `Markdown` export (line ~79):

```ts
export { StreamingMarkdown, type StreamingMarkdownProps } from './dense/StreamingMarkdown.js';
```

- [ ] **Step 6: Run tests + typecheck** — `pnpm vitest run packages/console-ui/src/dense/StreamingMarkdown.test.tsx` → PASS; `pnpm --filter @coa/console-ui typecheck` → 0.

- [ ] **Step 7: Commit**

```bash
git add packages/console-ui/src/dense/StreamingMarkdown.tsx packages/console-ui/src/dense/StreamingMarkdown.test.tsx packages/console-ui/src/index.ts apps/desktop/src/renderer/globals.css
git commit -m "feat: add a block-split streaming markdown renderer with a per-word reveal"
```

---

## Task 3: Wire the two live callers to `StreamingMarkdown`

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (`TranscriptRow` agent-text branch + `ThinkingCard` body)
- Modify: `packages/console-ui/src/dense/Markdown.tsx` (remove the dead `streaming` no-op prop)
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:**
- Consumes: `StreamingMarkdown` (Task 2). The `streaming?: boolean` flag on `TranscriptFrame` text/thinking kinds and on `ThinkingCard` already exists — unchanged.
- Produces: while `streaming === true`, agent text + reasoning render via `StreamingMarkdown`; settled/reloaded render via plain `<Markdown>` (D85). `Markdown` no longer has a `streaming` prop.

- [ ] **Step 0: Grounding grep** — confirm no other caller passes `streaming` to `Markdown` before removing the prop:

```bash
git grep -n "streaming" -- packages/console-ui/src packages/console-viewmodel/src apps/desktop/src | grep -i markdown
```

Expected: only the two `Transcript.tsx` call sites (the agent-text branch ~line 619 and `ThinkingCard` ~line 269). If any other caller appears, switch it the same way (streaming → `StreamingMarkdown`) in this task rather than removing the prop out from under it.

- [ ] **Step 1: Write the failing test** — add to `Transcript.test.tsx`

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TranscriptRow } from './Transcript.js';

describe('TranscriptRow streaming reveal', () => {
  it('reveals a streaming agent text frame per word via StreamingMarkdown', () => {
    const frame = { id: 'a', role: 'agent', kind: 'text', text: 'hello world', streaming: true } as const;
    const { container } = render(<TranscriptRow frame={frame} />);
    expect(container.querySelectorAll('span.cx-word').length).toBe(2);
  });

  it('renders a settled agent text frame as plain markdown (no reveal spans)', () => {
    const frame = { id: 'a', role: 'agent', kind: 'text', text: 'hello world' } as const;
    const { container } = render(<TranscriptRow frame={frame} />);
    expect(container.querySelectorAll('span.cx-word').length).toBe(0);
  });

  it('reveals streaming reasoning per word (auto-expanded)', () => {
    const frame = { id: 't', role: 'agent', kind: 'thinking', text: 'weighing options', streaming: true } as const;
    const { container } = render(<TranscriptRow frame={frame} />);
    expect(container.querySelectorAll('span.cx-word').length).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm vitest run packages/console-ui/src/dense/Transcript.test.tsx -t "streaming reveal"` → FAIL (0 `cx-word` spans; `Markdown streaming` is a no-op today).

- [ ] **Step 3: Implement**

In `Transcript.tsx`, add the import beside the `Markdown` import (line ~11):
```ts
import { StreamingMarkdown } from './StreamingMarkdown.js';
```

Replace the `frame.kind === 'text'` render (the `<Markdown source={frame.text} {...streaming}/>` at ~line 619-622) with:
```tsx
        {frame.kind === 'text' && (
          <div className="group relative">
            {!isUser && (
              <div className="absolute right-0 top-0 opacity-0 transition-opacity group-hover:opacity-100">
                <CopyButton text={frame.text} />
              </div>
            )}
            {frame.streaming === true ? (
              <StreamingMarkdown source={frame.text} />
            ) : (
              <Markdown source={frame.text} />
            )}
          </div>
        )}
```

In `ThinkingCard` (the reasoning body at ~line 268-270), replace the `<Markdown source={text} muted {...streaming}/>` with:
```tsx
          <div className="py-0.5 text-label italic">
            {streaming === true ? (
              <StreamingMarkdown source={text} muted />
            ) : (
              <Markdown source={text} muted />
            )}
          </div>
```

- [ ] **Step 4: Remove the dead `streaming` prop** from `Markdown.tsx` — delete `streaming?: boolean | undefined;` from `MarkdownProps` and its multi-line doc comment (lines 11-16), leaving `source` / `className` / `muted`. The signature already destructures only `{ source, className, muted }`, so no body change is needed. Update the top-of-interface comment if it references streaming.

- [ ] **Step 5: Run tests + typecheck** — `pnpm vitest run packages/console-ui/src/dense/Transcript.test.tsx` → PASS; `pnpm --filter @coa/console-ui typecheck` → 0; `pnpm --filter @coa/desktop typecheck` → 0. (The desktop typecheck catches any `ChatPanel`/other consumer that still passed `streaming` to `Markdown`.)

- [ ] **Step 6: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Markdown.tsx packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "feat: render live agent text and reasoning through the block-split streaming renderer"
```

---

## Task 4: Live verification + docs (same-commit) + final review

The authoritative pass. The animation is live-only; fakes have missed every real bug this arc.

**Files:**
- Modify: `ROADMAP.md` (M10 row)
- Modify: `docs/superpowers/specs/2026-07-09-streaming-reveal-effect-design.md` (supersede §2)
- Modify: `docs/superpowers/plans/2026-07-09-streaming-reveal-effect.md` (mark superseded)

- [ ] **Step 1: Full green** — from the repo root:
  - `pnpm --filter @coa/console-ui typecheck` → 0
  - `pnpm --filter @coa/desktop typecheck` → 0
  - `pnpm vitest run packages/console-ui/src/dense` → all pass
  - `pnpm --filter @coa/desktop exec vitest run` → pass (a known `ShowcasePanel` flake passes in isolation on re-run)

- [ ] **Step 2: Live-verify in the real Electron app** — `pnpm --filter @coa/desktop dev`. (If it collides with a running instance — "Port 5173 in use" + an electron-MAIN esm error — that is orthogonal to renderer changes; electron-vite HMR hot-reloads committed renderer edits into the running instance.) Open a session on a **pure-API account (`ds`/`lc`)** AND on **Claude**; send a prompt that yields a long answer + visible reasoning + a code block + a tool call. Confirm, watching live:
  - (a) words **blur in AND are visible during** the stream (not invisible-until-settle — the #1 bug this reworks);
  - (b) **scrolling history mid-generation is smooth** (the #4 lag regression — the load-bearing fix);
  - (c) the elapsed-seconds timer keeps pace (no `f87dc4f` regression);
  - (d) a code block **forms** (monospace container fills in) then settles into the highlighted `CodeBlock`;
  - (e) reasoning auto-expands while thinking, then collapses when output begins (not at message end);
  - (f) settling does NOT flicker or re-animate; opening a past session does NOT bulk-animate history (`coa raw` never reveals);
  - (g) Settings → reduced motion → instant reveal, no animation.

  If (a)/(b) fail, STOP and debug (systematic-debugging) — do not paper over with unit tests. Note results in `.superpowers/sdd/progress.md`.

- [ ] **Step 3: Correct the M10 ROADMAP row** — read the current M10 line first (`git grep -n "reveal" ROADMAP.md`), then replace the "streaming reveal" claim with the shipped block-split reality: "a block-split streaming renderer (`StreamingMarkdown`): settled markdown blocks arrive formatted with a whole-block entrance while the trailing block reveals per-word (stable-key, append-only) and an open code fence forms then settles to a highlighted block; reasoning auto-expands then collapses; all behind the `reveal` config seam". Keep the same-commit doc rule.

- [ ] **Step 4: Supersede the design spec §2** — in `docs/superpowers/specs/2026-07-09-streaming-reveal-effect-design.md`, replace the "### 2. Per-word reveal — `rehype` plugin on `Markdown`" section with a "### 2. Per-word reveal — block-split `StreamingMarkdown`" section describing: the pure splitter (`splitStreamingMarkdown`), completed blocks (memoized `<Markdown>` + `.cx-block-enter`), the trailing per-word block (plain text, **stable keys**, `.cx-word`), and the forming code container. Note explicitly that the react-markdown-per-frame approach was abandoned (remount → invisible + laggy) and why stable keys fix it. Also update the "Testing" bullet that names `rehypeReveal` to name `splitStreamingMarkdown` + the component render tests, and bump the "Design date" note.

- [ ] **Step 5: Mark the old plan superseded** — add a top note to `docs/superpowers/plans/2026-07-09-streaming-reveal-effect.md`:
```markdown
> **SUPERSEDED (2026-07-09):** the per-word reveal via a `rehype` plugin on `Markdown` (Tasks 2-3
> below) was reverted — react-markdown re-parses the whole block every frame, remounting the word
> spans (invisible) and re-reconciling hundreds of spans (laggy). The reveal was reworked as a
> block-split `StreamingMarkdown`; see docs/superpowers/plans/2026-07-09-streaming-reveal-block-split.md.
> Tasks 1, 4, 5, 6, 7 of this plan landed and still hold.
```

- [ ] **Step 6: Verify docs + commit** — `pnpm docs:check` (expect it to fail ONLY on the maintainer's untracked `project.md`; `docs/superpowers/**` is not router-counted — do NOT "fix" `project.md`).

```bash
git add ROADMAP.md docs/superpowers/specs/2026-07-09-streaming-reveal-effect-design.md docs/superpowers/plans/2026-07-09-streaming-reveal-effect.md docs/superpowers/plans/2026-07-09-streaming-reveal-block-split.md
git commit -m "docs: record the block-split streaming reveal"
```

- [ ] **Step 7: Final whole-branch review** — request an opus review of the full range (per the arc's practice; the live pass is authoritative for a streaming change). Verify against the invariants: D85 (settled/reloaded byte-identical, `coa raw` untouched), reduced motion, console-only (no daemon/adapter/schema touch), perf (no per-frame markdown parse of the growing block). Address findings and re-verify live.

---

## Self-Review

**Spec coverage** (against the handoff DESIGN 1-4 + residual risks):
- (1) completed blocks → memoized `<Markdown>` + whole-block entrance → Task 2 `CompletedBlock`.
- (2) trailing per-word, append-only, stable keys, plain text, blur ~190ms no caret → Task 2 `TrailingProse` + Task 1 `splitWords` + CSS `.cx-word` (`defaultReveal.text` = `blurIn`/190ms, `caret:false`).
- (3) open code fence → forming container, settles to highlighted `CodeBlock` → Task 2 `FormingCodeBlock` + Task 1 `parseOpenFence`.
- (4) settle → plain `<Markdown>`, byte-identical, no animate → Task 3 caller branch + Task 4 live-verify (f).
- Residual: incremental split → mitigated by pure `useMemo` split (cheap string scan) + memoized completed-block render; a ref-based incremental cache is deliberately avoided (StrictMode ref-mutation trap) and noted as an unneeded optimization. Fenced-code detection → Task 1 `splitStreamingMarkdown` (fence-aware boundaries, tested). Lists/tables mid-stream → stream per-word-raw, format on completion (flagged in the design spec §2 rewrite, Task 4 Step 4).
- Reasoning body → `StreamingMarkdown muted` (Task 3 `ThinkingCard`).
- Wiring/thread of `streaming` flag → already present (verified in `reads.ts`/`ChatPanel`/`Transcript`); this plan only switches the renderer.

**Type consistency:** `StreamSplit`/`WordToken` (Task 1) consumed by `StreamingMarkdown` (Task 2); `splitStreamingMarkdown`/`splitWords`/`parseOpenFence` signatures match their call sites; `StreamingMarkdownProps { source; muted? }` used consistently at both callers (Task 3); `defaultReveal.text`/`.block` fields (`variant`, `durationMs`) match `reveal.ts` as it stands (no reveal.ts change needed).

**Placeholder scan:** none — every code step carries real code + exact commands.

**Decisions locked during planning (surface to maintainer if any is wrong):**
- The split is a pure `useMemo` (not a ref-incremental cache) — deliberately, to avoid the StrictMode ref-mutation bug that already bit this arc; the memoized completed-block render is the real perf fix.
- Completed-block entrance is a **CSS one-shot** (`.cx-block-enter`) rather than reusing `MemoRow`'s WAAPI path — no cascade counter is needed (blocks arrive singly) and it avoids a circular import (`StreamingMarkdown` ← `Transcript`). `MemoRow`'s own entrance is untouched.
- Every completed block gets the entrance, including a prose paragraph that already revealed per-word; the blur-rise masks the raw→formatted reflow. If live-verify (f) finds this redundant, gate the entrance to structured blocks (code/heading/list/table) via a one-line predicate — a config-respecting refinement, not a rewrite.
