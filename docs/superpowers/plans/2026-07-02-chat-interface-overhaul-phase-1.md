# Chat Interface Overhaul — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the console conversation surface — distinct per-kind block rendering, clean markdown with
syntax-highlighted copy-able code, subagent nesting, and a redesigned multiline composer — entirely over data
already streaming on the wire (zero backend changes).

**Architecture:** Widen the two frame unions (view `TurnFrame` in `console-viewmodel`, `TranscriptFrame` in
`console-ui`) so the view-model stops discarding the wire taxonomy; add two `console-ui` kit members (`Markdown`,
`CopyButton`); rework the `Transcript` to render each kind distinctly with nesting + autoscroll; replace the
single-line composer with a multiline control carrying model/effort/expand. Backend seams (`getToolDetail`,
`interruptSession`, `resolveRef`, enriched approvals, `permissionMode`, `status` Push) are **Phase 2** — Phase 1
renders their placeholders with honest degradation.

**Tech Stack:** TypeScript (strict), React 19, `@coa/console-ui` kit (tokens + Radix), `react-markdown` +
`remark-gfm`, `react-syntax-highlighter`, `react-virtuoso`, Vitest + Testing Library (jsdom).

## Global Constraints

- **TypeScript `strict`, no `any`.** Every new type is explicit; edge data is Zod-parsed.
- **Build from the kit, no raw values.** New controls/surfaces are `@coa/console-ui` members with a lint-enforced
  `intent` block; styling uses semantic tokens only (`text-{eyebrow…metric}`, `h-control-{sm,md}`, `bg-*`,
  `rounded-*`, named z bands) — no literal hex/px/rem/duration/radius.
- **No `dangerouslySetInnerHTML`.** Markdown renders through React components (react-markdown); highlighting renders
  React `<span>`s (react-syntax-highlighter) — never innerHTML. (Renderer-isolation, D128.)
- **Byte-faithful (D128).** Diffs/code render exactly; the highlighter colorizes, never mutates or truncates bytes.
- **SC-1 preserved.** The console adds no block; approval cards surface only; the two denies come through
  `DenyNotice`.
- **Strict-superset (D85).** `coa raw` stays sacred; every new kind still degrades to the raw `tokens` floor.
- **New kit member checklist:** `Component.tsx` + `Component.intent.ts` (via `assertIntent`) + `Component.test.tsx`,
  registered in `src/registry.ts` (`allIntents`), exported from `src/index.ts`, then regenerate the catalogue:
  `npx tsx packages/console-ui/scripts/gen-catalog.ts` (the `registry.test.ts` COMPONENTS.md check enforces this).
- **Commits:** subject-only Conventional Commits — no body, no `Co-Authored-By`/trailer, no internal identifiers
  (no module IDs / phase numbers). Stage files by name (never `git add -A`).
- **Tests:** component tests start with `// @vitest-environment jsdom`. Pure mappers/selectors need no environment.
  Run from repo root: `pnpm -C packages/<pkg> test` (or `pnpm -w test` for all).

---

## Task 0: Design grounding + showcase mockups (gate — no production wiring)

**This task produces reviewed mockups + one decision, not shipped chat code.** It exists because the maintainer
requires design grounding + showcase mockups before any panel wiring (spec item 5).

**Files:**
- Read: `docs/UI.md`, `docs/superpowers/specs/2026-06-30-console-frontend-foundation-design.md`,
  `packages/console-ui/COMPONENTS.md`, `packages/console-ui/src/tokens/semantic.ts`.
- Create: `apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx` (static specimens rendered in the existing
  Showcase panel — see `apps/desktop/src/renderer/panels/showcase/Specimen.tsx` for the pattern).

- [ ] **Step 1: Ground in the design system.** Invoke the `frontend-design:frontend-design` skill. Read the four
  files above. Write a 5–8 bullet note (in the PR/handoff, not committed) on how the forge palette + brass system
  color + the density tokens apply to: block-kind differentiation, the subagent nesting spine, the approval card,
  and the composer.

- [ ] **Step 2: Build static showcase specimens.** In `ChatMockups.tsx`, render non-interactive mockups (hardcoded
  data, kit components + tokens only) for: (a) the block-kind stack — `you` text, agent markdown text with a code
  block, thinking, tool-use collapsed + expanded, plan checklist, tool-result, error; (b) a depth-1 subagent nest
  with a parent roll-up chip; (c) the diff-led approval card with once/session/tool-pattern buttons; (d) the
  composer (multiline + send/stop + model/effort + expand). Wire it as a Showcase sub-tab so the maintainer can view
  it live (`pnpm -C apps/desktop dev`).

- [ ] **Step 3: Highlighter A/B.** In the same showcase, render the SAME fenced code sample two ways —
  `react-syntax-highlighter` (hljs build, themed from tokens) vs a Shiki-via-hast rendering with a coa-forge theme.
  Note bundle-size + fidelity + no-innerHTML compliance for each.

- [ ] **Step 4: Maintainer review + decision.** Present the mockups + the A/B. Record the chosen highlighter in the
  design doc's §4 (edit `docs/superpowers/specs/2026-07-02-chat-interface-overhaul-design.md`, change the "resolve
  via Phase-0 A/B" line to the decision). **The rest of this plan assumes `react-syntax-highlighter` (hljs);** if
  Shiki wins, only `CodeBlock`'s internals (Task 5, Step 4) change — same props, same tests.

- [ ] **Step 5: Commit.**
```bash
git add apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx apps/desktop/src/renderer/panels/ShowcasePanel.tsx docs/superpowers/specs/2026-07-02-chat-interface-overhaul-design.md
git commit -m "feat: add chat surface mockups and highlighter comparison to the showcase"
```

---

## Task 1: Widen the view `TurnFrame` union

**Files:**
- Modify: `packages/console-viewmodel/src/reads.ts` (the `TurnFrameSchema` discriminated union, ~L46-89)
- Test: `packages/console-viewmodel/src/reads.test.ts`

**Interfaces:**
- Produces: new view frame kinds `thinking`, `plan`, `error`, `subagent`, plus `handle?` on `tool-use`/`tool-result`
  and a `depth?` already present. Shapes:
  - `{ id; role; kind:'thinking'; text; depth? }`
  - `{ id; role; kind:'plan'; items: { text: string; status: 'pending'|'in-progress'|'done' }[]; depth? }`
  - `{ id; role; kind:'error'; message: string; origin?: 'tool'|'loop'|'daemon'; depth? }`
  - `{ id; kind:'subagent'; childWorktree: string; event: 'spawn-proposal'|'spawn'|'running'|'idle'|'done'|'rollup'; depth?; rollup?: { tools?: number; tokens?: number; cost?: number; status?: string } }`
  - `tool-use`/`tool-result` gain `handle: z.string().optional()`.

- [ ] **Step 1: Write the failing test.** Append to `reads.test.ts`:
```ts
it('parses the widened taxonomy: thinking, plan, error, subagent', () => {
  const frames = [
    { id: 'a', role: 'agent', kind: 'thinking', text: 'hmm' },
    { id: 'b', role: 'agent', kind: 'plan', items: [{ text: 'do it', status: 'in-progress' }] },
    { id: 'c', role: 'agent', kind: 'error', message: 'boom', origin: 'tool' },
    { id: 'd', kind: 'subagent', childWorktree: 'wt-1', event: 'rollup', rollup: { tools: 2, cost: 0.1 } },
    { id: 'e', role: 'agent', kind: 'tool-use', tool: 'Read', input: '{}', handle: 'h1' },
  ];
  expect(() => TurnStreamSchema.parse(frames)).not.toThrow();
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm -C packages/console-viewmodel test reads` → FAIL (unknown kinds).

- [ ] **Step 3: Add the union members.** In `reads.ts`, add to `TurnFrameSchema` (before the closing `]`):
```ts
  z.object({
    id: z.string(),
    role: TurnRoleSchema,
    kind: z.literal('thinking'),
    text: z.string(),
    depth: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    role: TurnRoleSchema,
    kind: z.literal('plan'),
    items: z.array(
      z.object({ text: z.string(), status: z.enum(['pending', 'in-progress', 'done']) }),
    ),
    depth: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    role: TurnRoleSchema,
    kind: z.literal('error'),
    message: z.string(),
    origin: z.enum(['tool', 'loop', 'daemon']).optional(),
    depth: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('subagent'),
    childWorktree: z.string(),
    event: z.enum(['spawn-proposal', 'spawn', 'running', 'idle', 'done', 'rollup']),
    depth: z.number().optional(),
    rollup: z
      .object({
        tools: z.number().optional(),
        tokens: z.number().optional(),
        cost: z.number().optional(),
        status: z.string().optional(),
      })
      .optional(),
  }),
```
Then add `handle: z.string().optional(),` to the `tool-use` and `tool-result` objects.

- [ ] **Step 4: Run it, verify it passes.** `pnpm -C packages/console-viewmodel test reads` → PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/console-viewmodel/src/reads.ts packages/console-viewmodel/src/reads.test.ts
git commit -m "feat: widen the conversation frame model with thinking, plan, error and subagent kinds"
```

---

## Task 2: Rewire `turn-map` to stop dropping the taxonomy

**Files:**
- Modify: `packages/console-viewmodel/src/turn-map.ts` (`mapFrame` ~L57-72, `pushToViewFrames` ~L40-45)
- Test: `packages/console-viewmodel/src/turn-map.test.ts`

**Interfaces:**
- Consumes: wire `TurnFrame` (`@coa/shared` `turnFrameSchema`) + the widened view `TurnFrame` (Task 1).
- Produces: `mapFrame(frame, id, depth?)` now returns `thinking`/`plan`/`error`/`subagent` view frames and carries
  `handle`; `pushToViewFrames` passes `depth: push.parentTurn ? 1 : undefined`.

- [ ] **Step 1: Write the failing tests.** Replace the "shows thinking as an agent text line" and "drops
  lifecycle-only frames" tests in `turn-map.test.ts` with:
```ts
it('maps thinking to a thinking frame', () => {
  expect(pushToViewFrames(turn({ t: 'thinking', text: 'hmm' }))[0]).toMatchObject({
    kind: 'thinking', role: 'agent', text: 'hmm',
  });
});
it('maps error to an error frame with origin', () => {
  expect(pushToViewFrames(turn({ t: 'error', message: 'boom', origin: 'tool' }))[0]).toMatchObject({
    kind: 'error', message: 'boom', origin: 'tool',
  });
});
it('maps a TodoWrite tool_use to a plan frame', () => {
  const f = pushToViewFrames(turn({
    t: 'tool_use', tool: 'TodoWrite', handle: 'h',
    input: { todos: [{ content: 'ship it', status: 'in_progress', activeForm: 'Shipping it' }] },
  }))[0];
  expect(f).toMatchObject({ kind: 'plan', items: [{ text: 'ship it', status: 'in-progress' }] });
});
it('maps a non-TodoWrite tool_use to a tool-use frame carrying its handle', () => {
  expect(pushToViewFrames(turn({ t: 'tool_use', tool: 'Read', input: { path: 'a' }, handle: 'h9' }))[0])
    .toMatchObject({ kind: 'tool-use', tool: 'Read', handle: 'h9' });
});
it('maps a subagent frame and sets child depth from parentTurn', () => {
  const push = { ...turn({ t: 'subagent', childWorktree: 'wt', event: 'rollup' }),
    parentTurn: { sessionId: 's', seq: 0 } };
  expect(pushToViewFrames(push as Push)[0]).toMatchObject({ kind: 'subagent', childWorktree: 'wt', depth: 1 });
});
it('still drops turn-boundary and reconcile (deferred)', () => {
  expect(pushToViewFrames(turn({ t: 'turn-boundary', role: 'assistant' }))).toEqual([]);
  expect(pushToViewFrames(turn({ t: 'reconcile', changeSeq: 1, pointer: 'p' }))).toEqual([]);
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm -C packages/console-viewmodel test turn-map` → FAIL.

- [ ] **Step 3: Rewrite `mapFrame` + `pushToViewFrames`.** Replace them in `turn-map.ts`:
```ts
export function pushToViewFrames(push: Push): TurnFrame[] {
  if (push.kind !== 'turn') return [];
  const id = `${push.sessionId}:${push.seq}`;
  const depth = push.parentTurn ? 1 : undefined;
  const frame = mapFrame(push.frame, id, depth);
  return frame === undefined ? [] : [frame];
}

const TODO_STATUS: Record<string, 'pending' | 'in-progress' | 'done'> = {
  pending: 'pending', in_progress: 'in-progress', completed: 'done',
};

function mapFrame(frame: WireTurnFrame, id: string, depth?: number): TurnFrame | undefined {
  const d = depth === undefined ? {} : { depth };
  switch (frame.t) {
    case 'text':
      return { id, role: frame.role === 'user' ? 'you' : 'agent', kind: 'text', text: frame.text, ...d };
    case 'thinking':
      return { id, role: 'agent', kind: 'thinking', text: frame.text, ...d };
    case 'error':
      return { id, role: 'agent', kind: 'error', message: frame.message, origin: frame.origin, ...d };
    case 'tool_use':
      if (frame.tool === 'TodoWrite') return { id, role: 'agent', kind: 'plan', items: toPlanItems(frame.input), ...d };
      return { id, role: 'agent', kind: 'tool-use', tool: frame.tool, input: JSON.stringify(frame.input), handle: frame.handle, ...d };
    case 'tool_result':
      return { id, role: 'agent', kind: 'tool-result', tool: '', output: frame.pointer, ok: frame.ok, handle: frame.handle, ...d };
    case 'subagent':
      return { id, kind: 'subagent', childWorktree: frame.childWorktree, event: frame.event, ...d };
    default:
      return undefined; // turn-boundary, reconcile, permission — deferred/handled elsewhere
  }
}

function toPlanItems(input: Record<string, unknown>): { text: string; status: 'pending' | 'in-progress' | 'done' }[] {
  const todos = Array.isArray((input as { todos?: unknown }).todos) ? (input as { todos: unknown[] }).todos : [];
  return todos.flatMap((t) => {
    if (typeof t !== 'object' || t === null) return [];
    const { content, status } = t as { content?: unknown; status?: unknown };
    if (typeof content !== 'string') return [];
    return [{ text: content, status: TODO_STATUS[String(status)] ?? 'pending' }];
  });
}
```
Also update `reloadToViewFrames` to pass no depth (persisted frames carry their own; keep `mapFrame(t.frame, `t${t.seq}`)`). Update the doc-comment floor notes to reflect that thinking/error/subagent/plan are now mapped.

- [ ] **Step 4: Run it, verify it passes.** `pnpm -C packages/console-viewmodel test turn-map` → PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/console-viewmodel/src/turn-map.ts packages/console-viewmodel/src/turn-map.test.ts
git commit -m "feat: surface thinking, plan, error and subagent frames instead of flattening the stream"
```

---

## Task 3: Add dependencies + the `CopyButton` kit member

**Files:**
- Modify: `packages/console-ui/package.json` (dependencies)
- Create: `packages/console-ui/src/actions/CopyButton.tsx`, `.intent.ts`, `.test.tsx`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Produces: `CopyButton({ text: string; label?: string })` — an `IconButton` that writes `text` to the clipboard and
  flips its icon to a check for a beat.

- [ ] **Step 1: Add deps.** In `packages/console-ui/package.json` `dependencies`, add:
```json
    "react-markdown": "^9.0.1",
    "remark-gfm": "^4.0.0",
    "react-syntax-highlighter": "^15.5.0",
```
and in `devDependencies` add `"@types/react-syntax-highlighter": "^15.5.13"`. Run `pnpm install`.

- [ ] **Step 2: Write the failing test.** `CopyButton.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CopyButton } from './CopyButton.js';

describe('CopyButton', () => {
  it('writes its text to the clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyButton text="hello world" />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith('hello world');
  });
});
```

- [ ] **Step 3: Run it, verify it fails.** `pnpm -C packages/console-ui test CopyButton` → FAIL (module missing).

- [ ] **Step 4: Implement.** `CopyButton.tsx`:
```tsx
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from './IconButton.js';

export interface CopyButtonProps {
  text: string;
  label?: string;
}

export function CopyButton({ text, label = 'Copy' }: CopyButtonProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={copied ? 'Copied' : label}
      variant="tertiary"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    />
  );
}
```
`CopyButton.intent.ts`:
```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const copyButtonIntent: ComponentIntent = assertIntent({
  name: 'CopyButton',
  family: 'Actions',
  intent: 'A one-click control that copies a string to the clipboard with brief confirmation feedback.',
  useWhen: ['Offering copy on a code block, id, diff, or any short text payload.'],
  dontUseWhen: ['Copying requires formatting/serialization first — do that upstream and pass the final string.'],
  anatomy: 'An IconButton showing a copy glyph that swaps to a check for ~1.2s after a successful copy.',
  variantsStates: ['idle', 'copied'],
  accessibility: 'Native button; its accessible name announces Copy → Copied on success.',
  related: ['Code', 'IconButton'],
});
```

- [ ] **Step 5: Register + export + regenerate catalogue.** Add `copyButtonIntent` import + entry to `registry.ts`;
  add `export { CopyButton, type CopyButtonProps } from './actions/CopyButton.js';` to `index.ts`; run
  `npx tsx packages/console-ui/scripts/gen-catalog.ts`.

- [ ] **Step 6: Run tests, verify pass.** `pnpm -C packages/console-ui test` → PASS (incl. `registry` COMPONENTS.md check).

- [ ] **Step 7: Commit.**
```bash
git add packages/console-ui/package.json pnpm-lock.yaml packages/console-ui/src/actions/CopyButton.tsx packages/console-ui/src/actions/CopyButton.intent.ts packages/console-ui/src/actions/CopyButton.test.tsx packages/console-ui/src/registry.ts packages/console-ui/src/index.ts packages/console-ui/COMPONENTS.md
git commit -m "feat: add a copy-to-clipboard button to the component kit"
```

---

## Task 4: The `Markdown` kit member (GFM + highlighted, copy-able code)

**Files:**
- Create: `packages/console-ui/src/dense/CodeBlock.tsx`, `packages/console-ui/src/dense/Markdown.tsx`,
  `Markdown.intent.ts`, `Markdown.test.tsx`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `CopyButton` (Task 3), `Code`, `Link`.
- Produces: `Markdown({ source: string; className? })` — renders GFM; inline code → `Code`, links → `Link`
  (`external`), fenced code → `CodeBlock`. `CodeBlock({ code: string; language? })` — highlighted, byte-faithful,
  with a `CopyButton`.

- [ ] **Step 1: Write the failing tests.** `Markdown.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown.js';

describe('Markdown', () => {
  it('renders inline code and links as kit elements', () => {
    render(<Markdown source={'Use `M1.emit()` per [the docs](https://x.test).'} />);
    expect(screen.getByText('M1.emit()').tagName).toBe('CODE');
    expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute('href', 'https://x.test');
  });
  it('renders a fenced code block byte-faithfully with a copy button', () => {
    const src = '```ts\nconst a = 1;\n```';
    render(<Markdown source={src} />);
    expect(screen.getByText(/const a = 1;/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });
  it('renders GFM task lists', () => {
    render(<Markdown source={'- [x] done\n- [ ] todo'} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[0]).toBeChecked();
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm -C packages/console-ui test Markdown` → FAIL.

- [ ] **Step 3: Implement `CodeBlock.tsx`.**
```tsx
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { CopyButton } from '../actions/CopyButton.js';
import { cx } from '../lib/cx.js';

export interface CodeBlockProps {
  code: string;
  language?: string;
}

/** Token-derived highlight style: colors come from CSS variables so the block stays
 *  on-theme. Highlighting renders <span>s (no innerHTML); text is byte-faithful. */
const styleFromTokens = {
  hljs: { background: 'transparent', color: 'var(--fg)' },
} as const;

export function CodeBlock({ code, language }: CodeBlockProps): React.JSX.Element {
  return (
    <div className={cx('relative rounded-surface border border-hairline bg-subtle')}>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-eyebrow uppercase tracking-[0.06em] text-faint">{language ?? 'text'}</span>
        <CopyButton text={code} />
      </div>
      <SyntaxHighlighter
        language={language}
        style={styleFromTokens}
        customStyle={{ margin: 0, background: 'transparent', padding: '0.5rem' }}
        codeTagProps={{ className: 'font-mono text-label' }}
        PreTag="pre"
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
```
> If Task 0 selected Shiki, swap the `SyntaxHighlighter` body for a Shiki-via-hast render here; props/tests unchanged.

- [ ] **Step 4: Implement `Markdown.tsx`.**
```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code } from '../data/Code.js';
import { Link } from '../actions/Link.js';
import { cx } from '../lib/cx.js';
import { CodeBlock } from './CodeBlock.js';

export interface MarkdownProps {
  source: string;
  className?: string;
}

export function Markdown({ source, className }: MarkdownProps): React.JSX.Element {
  return (
    <div className={cx('text-body leading-[1.5] text-fg', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <Link href={href ?? '#'} external>
              {children}
            </Link>
          ),
          code: ({ className: cls, children }) => {
            const lang = /language-(\w+)/.exec(cls ?? '')?.[1];
            const text = String(children).replace(/\n$/, '');
            // react-markdown passes a language class only for fenced blocks.
            return lang !== undefined || text.includes('\n') ? (
              <CodeBlock code={text} language={lang} />
            ) : (
              <Code>{text}</Code>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 5: Add the intent + register + export + regenerate.** `Markdown.intent.ts`:
```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const markdownIntent: ComponentIntent = assertIntent({
  name: 'Markdown',
  family: 'Dense/Viz',
  intent: 'Renders GitHub-flavored markdown as kit elements, with highlighted, copy-able code blocks.',
  useWhen: ['Rendering agent/user prose that may contain markdown, code, links, or task lists.'],
  dontUseWhen: ['Showing raw, untrusted bytes that must not be interpreted — use Code block.'],
  anatomy: 'A prose container mapping markdown nodes to Link, Code, and CodeBlock; GFM tables/task-lists supported.',
  variantsStates: ['prose', 'inline-code', 'fenced-code', 'task-list', 'table', 'link'],
  accessibility: 'Semantic headings/lists/links; code blocks expose a labelled copy button; text is byte-faithful.',
  related: ['Code', 'CopyButton', 'Link', 'Transcript'],
});
```
Add `markdownIntent` to `registry.ts`; add `export { Markdown, type MarkdownProps } from './dense/Markdown.js';` and
`export { CodeBlock, type CodeBlockProps } from './dense/CodeBlock.js';` to `index.ts`; run
`npx tsx packages/console-ui/scripts/gen-catalog.ts`.

- [ ] **Step 6: Run tests, verify pass.** `pnpm -C packages/console-ui test` → PASS.

- [ ] **Step 7: Commit.**
```bash
git add packages/console-ui/src/dense/CodeBlock.tsx packages/console-ui/src/dense/Markdown.tsx packages/console-ui/src/dense/Markdown.intent.ts packages/console-ui/src/dense/Markdown.test.tsx packages/console-ui/src/registry.ts packages/console-ui/src/index.ts packages/console-ui/COMPONENTS.md
git commit -m "feat: add a markdown renderer with highlighted copy-able code blocks"
```

---

## Task 5: Widen `TranscriptFrame` + render `text` as markdown

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (union L11-40, `TranscriptRow` L69-158),
  `Transcript.intent.ts`
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:**
- Produces: the `TranscriptFrame` union gains `thinking`, `plan`, `error`, `subagent` (mirroring Task 1) and
  `handle?` on tool frames; `text` rows render via `Markdown`.

- [ ] **Step 1: Write the failing test.** In `Transcript.test.tsx`:
```tsx
it('renders a text frame as markdown (inline code becomes <code>)', () => {
  render(<TranscriptRow frame={{ id: '1', role: 'agent', kind: 'text', text: 'run `ls` now' }} />);
  expect(screen.getByText('ls').tagName).toBe('CODE');
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm -C packages/console-ui test Transcript` → FAIL (renders plain text).

- [ ] **Step 3: Widen the union + render markdown.** In `Transcript.tsx`, add the new members to `TranscriptFrame`
  (copy the shapes from Task 1: `thinking`, `plan` with `items`, `error` with `message`/`origin`, `subagent` with
  `childWorktree`/`event`/`rollup`; add `handle?` to `tool-use`/`tool-result`). Import `Markdown` and replace the
  `text` branch:
```tsx
{frame.kind === 'text' && <Markdown source={frame.text} />}
```

- [ ] **Step 4: Run it, verify it passes.** `pnpm -C packages/console-ui test Transcript` → PASS.

### Refinement (2026-07-02 mockup review): role differentiation, no gutter

Replace the `YOU`/`AGENT` gutter with structural differentiation (Claude-CLI style): **user turns** render flush as a
distinct raised/tinted block; **agent turns** indent one level under a **dotted vertical spine**. (Subagent turns get
a deeper spine in Task 9.)

- [ ] **Step 6: Write the failing tests.**
```tsx
it('renders a user turn as a flush distinct block without a role label', () => {
  const { container } = render(<TranscriptRow frame={{ id: '1', role: 'you', kind: 'text', text: 'hi' }} />);
  expect(screen.queryByText(/^you$/i)).not.toBeInTheDocument();
  expect(container.querySelector('[data-role="you"]')).not.toBeNull();
});
it('renders an agent turn under a dotted spine, no role label', () => {
  const { container } = render(<TranscriptRow frame={{ id: '2', role: 'agent', kind: 'text', text: 'sure' }} />);
  expect(screen.queryByText(/^agent$/i)).not.toBeInTheDocument();
  expect(container.querySelector('[data-role="agent"][data-spine="true"]')).not.toBeNull();
});
```
Remove/adjust any existing test that asserts the `you`/`agent` gutter text.

- [ ] **Step 7: Run it, verify it fails.** `pnpm -C packages/console-ui test Transcript` → FAIL.

- [ ] **Step 8: Implement.** Delete the `RoleGutter` component and `roleTint`/its usage. Change the shared trailing
  wrapper (the `return (<div … className="flex gap-2 px-2 py-1.5">` block for text/tool rows) to differentiate by
  role instead of printing a gutter. For non-lifecycle frames that carry a `role`:
```tsx
  const role = 'role' in frame ? frame.role : 'agent';
  const isUser = role === 'you';
  return (
    <div
      data-role={role}
      data-spine={!isUser}
      className={cx(
        'px-2 py-1.5',
        isUser
          ? 'my-1 rounded-surface border border-hairline bg-raised'
          : 'ml-2 border-l border-dotted border-border-default pl-3',
      )}
    >
      <div className="min-w-0 flex-1">
        {/* existing per-kind body (text/tool-use/tool-result) unchanged */}
      </div>
    </div>
  );
```
Keep the `indent` (depth) margin composing with this (depth adds to the agent indent). Do NOT print any role label.

- [ ] **Step 9: Run it, verify it passes; commit.**
```bash
pnpm -C packages/console-ui test Transcript
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "feat: differentiate user and agent turns by structure instead of a role label"
```

---

## Task 6: Render `thinking` and `error` blocks distinctly

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (`TranscriptRow`)
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

- [ ] **Step 1: Write the failing tests.**
```tsx
it('renders a thinking frame in a labelled, de-emphasized block', () => {
  render(<TranscriptRow frame={{ id: '1', role: 'agent', kind: 'thinking', text: 'considering' }} />);
  expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  expect(screen.getByText('considering')).toBeInTheDocument();
});
it('renders an error frame with a danger tone and its message', () => {
  render(<TranscriptRow frame={{ id: '2', role: 'agent', kind: 'error', message: 'it broke' }} />);
  expect(screen.getByRole('alert')).toHaveTextContent('it broke');
});
```

- [ ] **Step 2: Run it, verify it fails.** → FAIL.

- [ ] **Step 3: Implement.** In `TranscriptRow`, before the trailing default block, add:
```tsx
if (frame.kind === 'thinking') {
  return (
    <div style={indent} className="px-2 py-1.5">
      <div className="rounded-surface border border-hairline bg-subtle px-2 py-1.5">
        <div className="text-eyebrow uppercase tracking-[0.06em] text-faint">thinking</div>
        <div className="mt-1 text-label italic text-muted">{frame.text}</div>
      </div>
    </div>
  );
}
if (frame.kind === 'error') {
  return (
    <div style={indent} className="px-2 py-1.5">
      <div role="alert" className="rounded-surface border border-danger bg-danger-subtle px-2 py-1.5 text-label text-danger">
        {frame.message}
      </div>
    </div>
  );
}
```
> Confirm `border-danger`/`bg-danger-subtle`/`text-danger` exist in `tokens/semantic.ts`; if the danger token names
> differ, use the ones `DenyNotice.tsx` uses (read it) — do not introduce new raw values.

- [ ] **Step 4: Run it, verify it passes.** → PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "feat: give thinking and error turns their own distinct rendering"
```

---

## Task 7: Collapse-by-default tool cards

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (`TranscriptRow` tool branches)
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:**
- Produces: tool-use/tool-result render as a one-line summary row that expands on click to show input/output. (The
  `getToolDetail` diff fetch is Phase 2; Phase 1 expands the payload already on the frame.)

- [ ] **Step 1: Write the failing tests.**
```tsx
it('renders a tool-use collapsed, revealing input on expand', async () => {
  render(<TranscriptRow frame={{ id: '1', role: 'agent', kind: 'tool-use', tool: 'Read', input: '{"path":"a.ts"}' }} />);
  expect(screen.queryByText(/"path":"a.ts"/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Read/ }));
  expect(screen.getByText(/"path":"a.ts"/)).toBeInTheDocument();
});
it('shows an error glyph state on a failed tool-result', () => {
  render(<TranscriptRow frame={{ id: '2', role: 'agent', kind: 'tool-result', tool: 'Bash', output: 'boom', ok: false }} />);
  expect(screen.getByText(/error/i)).toBeInTheDocument();
});
```
Add `import userEvent from '@testing-library/user-event';` to the test file if absent.

- [ ] **Step 2: Run it, verify it fails.** → FAIL (currently always shows the Code block).

- [ ] **Step 3: Implement a `ToolCard`.** Add, above `TranscriptRow` in `Transcript.tsx`:
```tsx
function ToolCard({ tool, payload, ok }: { tool: string; payload: string; ok?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const status = ok === undefined ? undefined : ok ? 'ok' : 'error';
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-control px-1 py-0.5 text-caption text-muted hover:ring-1 hover:ring-inset hover:ring-border-default motion-reduce:transition-none"
        aria-expanded={open}
      >
        {/* Caret rotates on toggle (interruptible transition — reduced-motion disables it);
            the hover outline marks the row as expandable (mockup-review refinement). */}
        <ChevronRight aria-hidden size={12} className={cx('transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
        <span className="text-fg">{tool || 'tool'}</span>
        {status !== undefined && <span className={status === 'ok' ? 'text-muted' : 'text-danger'}>· {status}</span>}
      </button>
      {open && <Code block>{payload}</Code>}
    </div>
  );
}
```
Import `useState` from `react` and `ChevronRight` from `lucide-react` at the top. Replace the `tool-use` and
`tool-result` render branches (inside the trailing block) with:
```tsx
{frame.kind === 'tool-use' && <ToolCard tool={frame.tool} payload={frame.input} />}
{frame.kind === 'tool-result' && <ToolCard tool={frame.tool} payload={frame.output} ok={frame.ok} />}
```

- [ ] **Step 4: Run it, verify it passes.** → PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "feat: collapse tool calls by default and expand their payload on demand"
```

---

## Task 8: Render the `plan` checklist block

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (`TranscriptRow`)
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

- [ ] **Step 1: Write the failing test.**
```tsx
it('renders a plan frame as a checklist with per-item status', () => {
  render(<TranscriptRow frame={{ id: '1', role: 'agent', kind: 'plan', items: [
    { text: 'done thing', status: 'done' },
    { text: 'active thing', status: 'in-progress' },
  ] }} />);
  expect(screen.getByText('done thing')).toBeInTheDocument();
  expect(screen.getByText('active thing')).toBeInTheDocument();
  expect(screen.getByText(/in progress/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it, verify it fails.** → FAIL.

- [ ] **Step 3: Implement.** Add to `TranscriptRow`:
```tsx
if (frame.kind === 'plan') {
  const glyph = { pending: Circle, 'in-progress': CircleDot, done: CircleCheck } as const;
  const label = { pending: 'pending', 'in-progress': 'in progress', done: 'done' } as const;
  return (
    <div style={indent} className="px-2 py-1.5">
      <div className="rounded-surface border border-hairline bg-subtle p-2">
        <div className="text-eyebrow uppercase tracking-[0.06em] text-faint">plan</div>
        <ul className="mt-1 flex flex-col gap-1">
          {frame.items.map((it, i) => {
            const Glyph = glyph[it.status];
            return (
              <li key={i} className="flex items-center gap-2 text-label text-fg">
                <Glyph aria-label={label[it.status]} size={14} className="shrink-0 text-muted" />
                <span className={cx(it.status === 'done' && 'text-muted line-through')}>{it.text}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
```
Import `Circle, CircleDot, CircleCheck` from `lucide-react`.

- [ ] **Step 4: Run it, verify it passes.** → PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "feat: render the agent plan as a legible checklist block"
```

---

## Task 9: Subagent nesting spine + parent roll-up chip

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (`TranscriptRow` + row wrapper), `Transcript.intent.ts`
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:**
- Produces: a `subagent` frame renders a nesting boundary; when `event === 'rollup'` it shows a chip
  (tools/tokens/$/status). Child frames (`depth: 1`) render indented with a left spine.

- [ ] **Step 1: Write the failing tests.**
```tsx
it('renders a subagent rollup chip with its stats', () => {
  render(<TranscriptRow frame={{ id: '1', kind: 'subagent', childWorktree: 'wt', event: 'rollup',
    rollup: { tools: 3, cost: 0.25, status: 'done' } }} />);
  expect(screen.getByText(/subagent/i)).toBeInTheDocument();
  expect(screen.getByText(/3/)).toBeInTheDocument();
});
it('indents a depth-1 child frame with a nesting spine', () => {
  const { container } = render(<TranscriptRow frame={{ id: '2', role: 'subagent', kind: 'text', text: 'child work', depth: 1 }} />);
  expect(container.querySelector('[data-nested="true"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run it, verify it fails.** → FAIL.

- [ ] **Step 3: Implement.** Add a subagent branch to `TranscriptRow`:
```tsx
if (frame.kind === 'subagent') {
  const r = frame.rollup;
  return (
    <div style={indent} className="px-2 py-1.5">
      <div className="flex items-center gap-2 rounded-surface border border-hairline bg-raised px-2 py-1 text-caption">
        <span className="text-eyebrow uppercase tracking-[0.06em] text-faint">subagent</span>
        <span className="text-muted">{frame.event}</span>
        {r !== undefined && (
          <span className="flex items-center gap-2 text-muted">
            {r.tools !== undefined && <span>{r.tools} tools</span>}
            {r.tokens !== undefined && <span>{r.tokens} tok</span>}
            {r.cost !== undefined && <span>${r.cost.toFixed(2)}</span>}
            {r.status !== undefined && <span>{r.status}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
```
Extend the role-aware wrapper from Task 5 so nested (subagent) frames indent a level DEEPER than agent turns and
carry their own spine. In the wrapper, compute `const nested = (depth ?? 0) > 0;`, add `data-nested={nested}`, and
when `nested`, add a deeper indent + a distinct (solid) spine on top of the agent dotted spine:
```tsx
      data-nested={nested}
      className={cx(
        'px-2 py-1.5',
        isUser
          ? 'my-1 rounded-surface border border-hairline bg-raised'
          : 'ml-2 border-l border-dotted border-border-default pl-3',
        nested && 'ml-5 border-solid', // subagent: deeper indent + solid spine so nesting stays legible
      )}
```
(The `indent`/`depth` margin still composes for depth > 1 if it ever arrives; v1 is depth-1.)
Update `Transcript.intent.ts` `variantsStates` to include `thinking`, `plan`, `error`, `subagent`, `nested`,
`user-turn`, and `anatomy`/`related` to mention `Markdown`.

- [ ] **Step 4: Bigger approval buttons (mockup-review refinement).** In the `approval` branch of `TranscriptRow`,
  bump the Deny/Approve buttons from `size="sm"` to `size="md"` so they're an easier hit target, keeping them inside
  the card (no layout change beyond size). Add/adjust a test:
```tsx
it('renders approval actions at a larger hit target', () => {
  render(<TranscriptRow frame={{ id: '1', kind: 'approval', requestId: 'r', tool: 'write_file', summary: 's' }} onRespond={() => {}} />);
  // size="md" control height; assert the buttons render and are actionable
  expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
});
```

- [ ] **Step 5: Run it, verify it passes.** Run the whole file: `pnpm -C packages/console-ui test Transcript` → PASS.

- [ ] **Step 6: Regenerate catalogue + commit.** `npx tsx packages/console-ui/scripts/gen-catalog.ts`, then:
```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.intent.ts packages/console-ui/src/dense/Transcript.test.tsx packages/console-ui/COMPONENTS.md
git commit -m "feat: nest subagent turns with a per-subagent roll-up and enlarge approval actions"
```

---

## Task 10: Grouped sticky-prompt transcript + autoscroll + jump-to-latest

**Files:**
- Create: `packages/console-ui/src/dense/group.ts`, `packages/console-ui/src/dense/group.test.ts`
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (the `Transcript` container)
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:**
- Produces: a pure `groupByUserTurn(frames)` → `{ counts: number[]; headers: (TranscriptFrame | undefined)[]; items:
  TranscriptFrame[] }` where each group begins at a `you` text frame (its header sticks to the top) and holds the
  following non-user frames; frames before the first user turn form a leading group with an `undefined` header.
  `Transcript` renders via `GroupedVirtuoso` (sticky user header), follows output while pinned to the bottom, and
  shows a "jump to latest" button when detached. **Mockup-review refinement:** the nearest user message is always
  visible as the sticky group header.

- [ ] **Step 1: Write the failing grouping tests.** `group.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { groupByUserTurn } from './group.js';
import type { TranscriptFrame } from './Transcript.js';

const f = (id: string, role: 'you' | 'agent', text: string): TranscriptFrame => ({ id, role, kind: 'text', text });

describe('groupByUserTurn', () => {
  it('starts a new group at each user turn and holds the following frames', () => {
    const g = groupByUserTurn([f('1', 'you', 'a'), f('2', 'agent', 'b'), f('3', 'agent', 'c'), f('4', 'you', 'd')]);
    expect(g.counts).toEqual([2, 0]);
    expect(g.headers.map((h) => h?.id)).toEqual(['1', '4']);
    expect(g.items.map((i) => i.id)).toEqual(['2', '3']);
  });
  it('puts pre-first-user frames in a leading headerless group', () => {
    const g = groupByUserTurn([f('1', 'agent', 'sys'), f('2', 'you', 'hi')]);
    expect(g.counts).toEqual([1, 0]);
    expect(g.headers[0]).toBeUndefined();
    expect(g.headers[1]?.id).toBe('2');
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm -C packages/console-ui test group` → FAIL.

- [ ] **Step 3: Implement `group.ts`.**
```ts
import type { TranscriptFrame } from './Transcript.js';

const isUserTurn = (fr: TranscriptFrame): boolean => 'role' in fr && fr.role === 'you' && fr.kind === 'text';

export interface GroupedFrames {
  counts: number[];
  headers: (TranscriptFrame | undefined)[];
  items: TranscriptFrame[];
}

/** Group the stream by user turn: each `you` text frame is a sticky group header; the
 *  following non-user frames are its body. Frames before the first user turn form a
 *  leading group with an undefined header. */
export function groupByUserTurn(frames: TranscriptFrame[]): GroupedFrames {
  const counts: number[] = [];
  const headers: (TranscriptFrame | undefined)[] = [];
  const items: TranscriptFrame[] = [];
  let started = false;
  for (const fr of frames) {
    if (isUserTurn(fr)) {
      headers.push(fr);
      counts.push(0);
      started = true;
    } else {
      if (!started) {
        headers.push(undefined);
        counts.push(0);
        started = true;
      }
      counts[counts.length - 1] += 1;
      items.push(fr);
    }
  }
  return { counts, headers, items };
}
```

- [ ] **Step 4: Run it, verify it passes.** `pnpm -C packages/console-ui test group` → PASS.

- [ ] **Step 5: Write the failing Transcript test (jump-to-latest control).**
```tsx
it('shows a jump-to-latest control when scrolled away from the bottom', () => {
  const frames = Array.from({ length: 30 }, (_, i) => ({ id: String(i), role: 'agent' as const, kind: 'text' as const, text: `m${i}` }));
  render(<Transcript frames={frames} showJumpToLatest />);
  expect(screen.getByRole('button', { name: /latest/i })).toBeInTheDocument();
});
```

- [ ] **Step 6: Run it, verify it fails.** → FAIL.

- [ ] **Step 7: Implement grouped autoscroll in `Transcript`.** Swap `Virtuoso` for `GroupedVirtuoso`. Track bottom
  state + a handle; render a sticky user-message header per group:
```tsx
const [atBottom, setAtBottom] = useState(true);
const ref = useRef<GroupedVirtuosoHandle>(null);
const { counts, headers, items } = groupByUserTurn(frames);
```
Render:
```tsx
<GroupedVirtuoso
  ref={ref}
  groupCounts={counts}
  followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
  atBottomStateChange={setAtBottom}
  groupContent={(i) => {
    const h = headers[i];
    return h !== undefined && h.kind === 'text' ? (
      <div className="border-b border-hairline bg-surface/95 px-2 py-1.5 backdrop-blur">
        <div className="truncate text-label text-fg">{h.text}</div>
      </div>
    ) : (
      <div className="h-0" />
    );
  }}
  itemContent={(index) => <TranscriptRow frame={items[index]} onRespond={onRespond} />}
  computeItemKey={(index) => items[index].id}
/>
```
Add a `showJumpToLatest?: boolean` prop (test seam; default `!atBottom`); after `GroupedVirtuoso`, render the
jump-to-latest button inside a `relative` wrapper:
```tsx
{(showJumpToLatest ?? !atBottom) && (
  <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
    <Button variant="secondary" size="sm" className="pointer-events-auto"
      onClick={() => ref.current?.scrollToIndex({ index: items.length - 1, behavior: 'smooth', align: 'end' })}>
      Jump to latest
    </Button>
  </div>
)}
```
Import `GroupedVirtuoso, type GroupedVirtuosoHandle` from `react-virtuoso`, `useRef, useState` from `react`,
`Button` (already imported), and `groupByUserTurn` from `./group.js`. Note the user turn is now the sticky header —
user text frames should NOT also render as an item row (they live in `headers`, not `items`, by construction).

- [ ] **Step 8: Run it, verify it passes.** `pnpm -C packages/console-ui test Transcript` → PASS.

- [ ] **Step 9: Commit.**
```bash
git add packages/console-ui/src/dense/group.ts packages/console-ui/src/dense/group.test.ts packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "feat: group the transcript by prompt with a sticky user message and jump-to-latest"
```

---

## Task 11: The redesigned composer (multiline + send/stop + keymap seam)

**Files:**
- Create: `packages/console-ui/src/dense/Composer.tsx`, `.intent.ts`, `.test.tsx`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Produces: `Composer` — a multiline auto-growing textarea. `Enter` sends (unless composing/Shift), `Shift+Enter`
  newlines, `Esc` calls `onInterrupt`. Send disabled when empty; Stop shown while `running`.
```ts
export interface ComposerProps {
  onSend: (text: string) => void;
  onInterrupt?: () => void;
  running?: boolean;
  disabled?: boolean;
  slotStart?: React.ReactNode; // model/effort selects (Task 12)
  slotEnd?: React.ReactNode;   // expand button (Task 13)
}
```

- [ ] **Step 1: Write the failing tests.** `Composer.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

describe('Composer', () => {
  it('sends on Enter and clears', async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'hello{Enter}');
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(box).toHaveValue('');
  });
  it('inserts a newline on Shift+Enter without sending', async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    await userEvent.type(screen.getByRole('textbox'), 'a{Shift>}{Enter}{/Shift}b');
    expect(onSend).not.toHaveBeenCalled();
  });
  it('shows Stop while running and calls onInterrupt on Escape', async () => {
    const onInterrupt = vi.fn();
    render(<Composer onSend={vi.fn()} running onInterrupt={onInterrupt} />);
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), '{Escape}');
    expect(onInterrupt).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm -C packages/console-ui test Composer` → FAIL.

- [ ] **Step 3: Implement `Composer.tsx`.**
```tsx
import { useState } from 'react';
import { Button } from '../actions/Button.js';
import { cx } from '../lib/cx.js';

export interface ComposerProps {
  onSend: (text: string) => void;
  onInterrupt?: () => void;
  running?: boolean;
  disabled?: boolean;
  slotStart?: React.ReactNode;
  slotEnd?: React.ReactNode;
}

export function Composer({ onSend, onInterrupt, running, disabled, slotStart, slotEnd }: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('');
  const send = (): void => {
    const body = text.trim();
    if (body === '' || disabled) return;
    onSend(body);
    setText('');
  };
  return (
    <div className="flex flex-col gap-2 border-t border-border-default p-2.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          } else if (e.key === 'Escape' && running) {
            e.preventDefault();
            onInterrupt?.();
          }
        }}
        rows={1}
        placeholder="Message the agent…"
        aria-label="Message the agent"
        className={cx(
          'max-h-40 min-h-control-md w-full resize-y rounded-control border border-border-default bg-element px-2.5 py-2 text-body text-fg placeholder:text-faint',
        )}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">{slotStart}</div>
        <div className="flex shrink-0 items-center gap-2">
          {slotEnd}
          {running ? (
            <Button variant="secondary" size="sm" onClick={() => onInterrupt?.()} disabled={onInterrupt === undefined}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={send} disabled={disabled === true || text.trim() === ''}>
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```
> **Keymap seam:** the `onKeyDown` handler is the single interception point; a future global keymap registers by
> wrapping these actions. Keep Enter/Shift+Enter/Esc inline (intrinsic) and do not add a rebindable table now.

- [ ] **Step 4: Intent + register + export + regenerate.** `Composer.intent.ts` (family `Dense/Viz`; variantsStates
  `idle`, `running`, `disabled`, `multiline`; related `Transcript`, `Button`, `Select`). Add to `registry.ts`;
  export from `index.ts`; run `npx tsx packages/console-ui/scripts/gen-catalog.ts`.

- [ ] **Step 5: Run tests, verify pass.** `pnpm -C packages/console-ui test` → PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/console-ui/src/dense/Composer.tsx packages/console-ui/src/dense/Composer.intent.ts packages/console-ui/src/dense/Composer.test.tsx packages/console-ui/src/registry.ts packages/console-ui/src/index.ts packages/console-ui/COMPONENTS.md
git commit -m "feat: add a multiline chat composer with send, stop and a keymap seam"
```

---

## Task 12: Effort/reasoning select projection

**Files:**
- Create: `packages/console-viewmodel/src/reasoning.ts`, `packages/console-viewmodel/src/reasoning.test.ts`
- Modify: `packages/console-viewmodel/src/index.ts` (export)

**Interfaces:**
- Consumes: `ModelDescriptor`, `ClaudeReasoning` (`@coa/shared`).
- Produces: `effortOptions(model?: ModelDescriptor): { value: string; label: string }[]` — `['off', …
  supportedEffortLevels]` when `supportsEffort`, else `[]`; and `toReasoning(value: string): ClaudeReasoning` —
  `'off' → {mode:'off'}`, else `{mode:'effort', effort}`.

- [ ] **Step 1: Write the failing tests.** `reasoning.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { effortOptions, toReasoning } from './reasoning.js';

describe('reasoning projection', () => {
  it('lists off + the model effort levels when supported', () => {
    const opts = effortOptions({ id: 'm', supportsEffort: true, supportedEffortLevels: ['low', 'high'] });
    expect(opts.map((o) => o.value)).toEqual(['off', 'low', 'high']);
  });
  it('returns no options when the model has no effort control', () => {
    expect(effortOptions({ id: 'm', supportsEffort: false })).toEqual([]);
    expect(effortOptions(undefined)).toEqual([]);
  });
  it('maps a value to a ClaudeReasoning', () => {
    expect(toReasoning('off')).toEqual({ mode: 'off' });
    expect(toReasoning('high')).toEqual({ mode: 'effort', effort: 'high' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm -C packages/console-viewmodel test reasoning` → FAIL.

- [ ] **Step 3: Implement `reasoning.ts`.**
```ts
import type { ClaudeReasoning, ModelDescriptor, ClaudeEffort } from '@coa/shared';

const EFFORTS: readonly ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function effortOptions(model?: ModelDescriptor): { value: string; label: string }[] {
  if (model?.supportsEffort !== true) return [];
  const levels = model.supportedEffortLevels ?? [];
  return [{ value: 'off', label: 'No thinking' }, ...levels.map((e) => ({ value: e, label: e }))];
}

export function toReasoning(value: string): ClaudeReasoning {
  if (value === 'off') return { mode: 'off' };
  const effort = EFFORTS.find((e) => e === value);
  return effort ? { mode: 'effort', effort } : { mode: 'off' };
}

export function reasoningValue(reasoning?: ClaudeReasoning): string {
  return reasoning?.mode === 'effort' ? reasoning.effort : 'off';
}
```
Export `ClaudeEffort` type from `@coa/shared` if not already; export the three functions from
`console-viewmodel/src/index.ts`.

- [ ] **Step 4: Run it, verify it passes.** → PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/console-viewmodel/src/reasoning.ts packages/console-viewmodel/src/reasoning.test.ts packages/console-viewmodel/src/index.ts
git commit -m "feat: project a model's reasoning options for the composer effort control"
```

---

## Task 13: Wire the new Transcript + Composer into `ChatPanel`

**Files:**
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx` (`toGovernedFrame`, `frameToRawLine`, `ChatVm`,
  `selectChatVm`, `ChatView`, remove `ModelBar`/old `Composer`)
- Test: `apps/desktop/src/renderer/panels/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `Composer`, widened `Transcript` (`@coa/console-ui`), `effortOptions`/`toReasoning`/`reasoningValue`
  (`@coa/console-viewmodel`).
- Produces: `toGovernedFrame` maps the widened view `TurnFrame` → `TranscriptFrame` for all new kinds;
  `frameToRawLine` handles them for the raw floor; `ChatView` renders `Composer` with model+effort in `slotStart`.

- [ ] **Step 1: Write the failing tests.** In `ChatPanel.test.tsx`:
```tsx
it('maps a plan view frame to a plan transcript frame', () => {
  expect(toGovernedFrame({ id: '1', role: 'agent', kind: 'plan', items: [{ text: 'x', status: 'pending' }] }))
    .toMatchObject({ kind: 'plan', items: [{ text: 'x', status: 'pending' }] });
});
it('maps a thinking view frame to a thinking transcript frame', () => {
  expect(toGovernedFrame({ id: '2', role: 'agent', kind: 'thinking', text: 'hmm' }))
    .toMatchObject({ kind: 'thinking', text: 'hmm' });
});
it('renders every new kind to a raw line without throwing', () => {
  for (const f of [
    { id: '1', role: 'agent', kind: 'thinking', text: 't' },
    { id: '2', role: 'agent', kind: 'error', message: 'e' },
    { id: '3', role: 'agent', kind: 'plan', items: [{ text: 'p', status: 'done' }] },
    { id: '4', kind: 'subagent', childWorktree: 'w', event: 'spawn' },
  ] as const) {
    expect(typeof frameToRawLine(f)).toBe('string');
  }
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm -C apps/desktop test ChatPanel` → FAIL (non-exhaustive switches).

- [ ] **Step 3: Extend `toGovernedFrame` + `frameToRawLine`.** Add cases for `thinking`, `error`, `plan`,
  `subagent` to both switches in `ChatPanel.tsx`, passing the fields straight through (mirror the shapes from Task 1)
  and carrying `depth`/`handle`. Example additions to `toGovernedFrame`:
```ts
    case 'thinking':
      return { id: f.id, role: f.role, kind: 'thinking', text: f.text, depth: f.depth };
    case 'error':
      return { id: f.id, role: f.role, kind: 'error', message: f.message, origin: f.origin, depth: f.depth };
    case 'plan':
      return { id: f.id, role: f.role, kind: 'plan', items: f.items, depth: f.depth };
    case 'subagent':
      return { id: f.id, kind: 'subagent', childWorktree: f.childWorktree, event: f.event, depth: f.depth, rollup: f.rollup };
```
and add `handle: f.handle` to the `tool-use`/`tool-result` cases. Mirror in `frameToRawLine`:
```ts
    case 'thinking': return `> ${f.role}: thinking ${f.text}`;
    case 'error': return `> ${f.role}: error ${f.message}`;
    case 'plan': return `> ${f.role}: plan ${f.items.map((i) => `[${i.status}] ${i.text}`).join('; ')}`;
    case 'subagent': return `> control: subagent ${f.event} ${f.childWorktree}`;
```

- [ ] **Step 4: Swap `ChatView`'s composer + model bar for `Composer`.** Remove the `ModelBar` element and the old
  `Composer` function. Replace the `<ModelBar …/>` + `<Composer …/>` block at the bottom of the pane body with:
```tsx
<Composer
  onSend={vm.onSend}
  slotStart={
    <>
      <Combobox
        label="Model"
        className="max-w-[10rem]"
        options={vm.models.length > 0 ? vm.models.map((m) => ({ value: m.id, label: modelPickerLabel(m) })) : vm.currentModelId ? [{ value: vm.currentModelId, label: vm.currentModelId }] : []}
        {...(vm.currentModelId !== undefined ? { value: vm.currentModelId } : {})}
        onValueChange={vm.onPickModel}
        placeholder="Default model"
      />
      {vm.effortOptions.length > 0 && (
        <Select label="Effort" className="max-w-[8rem]" options={vm.effortOptions} value={vm.effortValue} onValueChange={vm.onPickEffort} />
      )}
    </>
  }
/>
```
Import `Composer`, `Select` from `@coa/console-ui`. Delete the now-unused `ModelBar` and old `Composer` functions.

- [ ] **Step 5: Extend `ChatVm` + `selectChatVm`.** Add to the `ready` variant: `effortOptions: { value: string;
  label: string }[]`, `effortValue: string`, `onPickEffort: (v: string) => void`. In `selectChatVm`, compute:
```ts
const currentModel = models.find((m) => m.id === currentModelId);
const effortOpts = effortOptions(currentModel);
const effortVal = reasoningValue(override?.reasoning ?? activeSession?.reasoning ?? activeAgent?.reasoning);
```
and return them, with `onPickEffort: (v) => { if (activeSessionId !== undefined) state.actions.setSessionModel(activeSessionId, { reasoning: toReasoning(v) }); }`. Import `effortOptions, toReasoning, reasoningValue`.

- [ ] **Step 6: Run tests, verify pass.** `pnpm -C apps/desktop test ChatPanel` and `pnpm -C packages/console-ui
  test` → PASS. Then `pnpm -w build` (or `pnpm -C apps/desktop build`) → typechecks clean.

- [ ] **Step 7: Commit.**
```bash
git add apps/desktop/src/renderer/panels/ChatPanel.tsx apps/desktop/src/renderer/panels/ChatPanel.test.tsx
git commit -m "feat: adopt the new transcript and composer in the chat panel with an effort control"
```

---

## Task 14: Status indicator (Phase-1 floor) + docs

**Files:**
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx` (status pill in the pane title slot),
  `apps/desktop/src/renderer/panels/state.ts` (`ConsoleUi.sending` flag if not present)
- Modify: `docs/UI.md` (last-reviewed), `packages/console-ui/COMPONENTS.md` (already regenerated)
- Test: `apps/desktop/src/renderer/panels/ChatPanel.test.tsx`

**Interfaces:**
- Produces: `selectChatVm` exposes `sessionStatus: 'idle' | 'running'` (floor: `running` while a send is in flight)
  and `runningSince?: number` (epoch ms of the in-flight send); the pane shows a `Badge` with a live **"running for
  Ns"** elapsed counter (mockup-review refinement — client-side, no wire change). Full 6-state `status` Push +
  per-block durations are Phase 2 — the pill is the placeholder they will drive.

- [ ] **Step 1: Write the failing tests.**
```tsx
it('reports running status while a send is in flight', () => {
  const base = makeReadyState(); // existing test helper; if absent, build minimal ConsoleState
  const vm = selectChatVm({ ...base, ui: { ...base.ui, sending: true, sentAt: 1000 } });
  expect(vm.status === 'ready' && vm.sessionStatus).toBe('running');
  expect(vm.status === 'ready' && vm.runningSince).toBe(1000);
});
it('formats elapsed seconds for the running pill', () => {
  expect(formatElapsed(1000, 4200)).toBe('3s'); // (4200-1000)/1000 floored
});
```

- [ ] **Step 2: Run it, verify it fails.** → FAIL.

- [ ] **Step 3: Implement.** Add `sending?: boolean` and `sentAt?: number` to `ConsoleUi` in `state.ts` (defaults in
  `initialState`). In `selectChatVm`, add `sessionStatus: state.ui.sending ? 'running' : 'idle'` and `runningSince:
  state.ui.sentAt` to the ready return, plus those fields on `ChatVm`. Export a pure
  `formatElapsed(sinceMs: number, nowMs: number): string` → `` `${Math.floor((nowMs - sinceMs) / 1000)}s` ``. Add a
  small `RunningPill` component to `ChatPanel.tsx`:
```tsx
function RunningPill({ since }: { since?: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === undefined ? (
    <Badge tone="neutral">idle</Badge>
  ) : (
    <Badge tone="info">running for {formatElapsed(since, now)}</Badge>
  );
}
```
Render `<RunningPill since={vm.sessionStatus === 'running' ? vm.runningSince : undefined} />` in the `titleSlot`
(import `Badge`; `useState`/`useEffect` from react). Set `sending: true` + `sentAt: Date.now()` where `sendMessage`
is dispatched in the app's action wiring; clear both on the next `status`/turn-boundary once Phase 2 lands, or on the
first appended turn for the floor. Comment that this is the placeholder the `status` Push will drive.

- [ ] **Step 4: Run it, verify it passes.** `pnpm -C apps/desktop test ChatPanel` → PASS.

- [ ] **Step 5: Update docs.** Bump `docs/UI.md` `_Last reviewed_` to today; confirm `COMPONENTS.md` includes
  `CopyButton`, `Markdown`, `CodeBlock`, `Composer` (re-run `gen-catalog` if not).

- [ ] **Step 6: Full verification.** `pnpm -w test` → all green; `pnpm -w build` → clean. Launch
  `pnpm -C apps/desktop dev`, send a message, confirm: markdown renders, code blocks copy, tool cards collapse,
  a plan renders as a checklist, autoscroll pins to bottom, the composer sends on Enter, effort select shows for an
  effort-capable model. Note in the handoff which Phase-2 placeholders are inert (Stop disabled, tool expand shows
  payload not diff, refs not yet navigable, status is floor).

- [ ] **Step 7: Commit.**
```bash
git add apps/desktop/src/renderer/panels/ChatPanel.tsx apps/desktop/src/renderer/panels/state.ts apps/desktop/src/renderer/panels/ChatPanel.test.tsx docs/UI.md
git commit -m "feat: surface a live chat status indicator and refresh the UI docs"
```

---

## Self-Review (completed by plan author)

- **Spec coverage (Phase 1 scope):** A1 block taxonomy → Tasks 1,2,5,6,7,8,9. A2 markdown+highlight+copy →
  Tasks 3,4. A4 plan block → Tasks 2,8. B5 subagent nesting+rollup → Tasks 1,2,9. B7 tool collapse/expand (render
  half) → Task 7. C11 status (floor) → Task 14. D13 autoscroll → Task 10. D14/D15 composer+model+effort → Tasks
  11,12,13. Intrinsic keybindings+seam → Task 11. Design gate → Task 0. **Deferred to Phase 2 (correctly absent
  here):** A3 `resolveRef`+IDE routing, B6 enriched approvals+scope, B7 `getToolDetail` diff, C9 `interruptSession`,
  E17 `permissionMode`, live `status` Push.
- **Placeholder scan:** none — every code step carries concrete code; the one variable (highlighter engine) is
  resolved in Task 0 and isolated to `CodeBlock`.
- **Type consistency:** the `{ text; status: 'pending'|'in-progress'|'done' }` plan-item shape, the `subagent`
  `rollup` shape, and `handle?` on tool frames are defined identically in Task 1 (view) and mirrored in Task 5 (ui)
  and Task 13 (bridge). `effortOptions`/`toReasoning`/`reasoningValue` signatures match across Tasks 12 and 13.

---

_Last reviewed: 2026-07-02_
