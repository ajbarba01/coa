# Rich Tool Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the chosen rich tool card into a real kit member with syntax-highlighted code (including diffs), clickable file paths, and a bounded body that expands into a chat-pane-contained overlay.

**Architecture:** Small pure/isolated units land in `packages/console-ui` — a shared syntax theme + `SyntaxText` (which also finally *registers* the hljs languages so highlighting works), a `languageForPath` map, a `clampLines` truncator, a `toolPath` extractor, a byte-faithful highlighted `ToolDiffView`, and a pane-scoped `PaneOverlay`. The new `ToolCard` composes them. The `apps/desktop` showcase renders `ToolCard` (path click → toast, expand → pane overlay); live wiring into the transcript is a later phase.

**Tech Stack:** TypeScript (strict) · React 19 · Tailwind (token utilities only) · react-syntax-highlighter (hljs `Light` build) · radix-ui · lucide-react · Vitest (root runner) · the `@coa/console-ui` kit.

## Global Constraints

- **TypeScript strict, no `any`.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax` all on. Optional props/params typed `T | undefined`; bracket access for index-signature records; `import type` for type-only imports.
- **Kit discipline:** token utilities only (no raw hex/px; "blue" = `info`). No `dangerouslySetInnerHTML`. New kit members carry an intent block (mirror `Transcript.intent.ts`). Highlight colors come from CSS token variables (`HLJS_TOKEN_STYLE`), never literals.
- **D128 byte-faithfulness:** every rendered payload byte (diff lines, previews, overlay content) is a verbatim source line. Syntax spans wrap text without altering it; the diff gutter marker is a **separate** presentational span, never concatenated into highlighted text. `≈ tok` and the registry `summary` are labelled derived hints.
- **SC-1 / D85:** the card only surfaces (adds no block); it never touches the `coa raw` path.
- **Highlighting emits inline styles, not classes** (verified 2026-07-05): with the kit's custom `HLJS_TOKEN_STYLE`, react-syntax-highlighter applies token colors as inline styles and strips `hljs-*` classes. So **tests assert on token-span breakdown + verbatim `textContent`, never `.hljs-*` selectors.**
- **Commits:** subject-only Conventional Commits — no body, no `Co-Authored-By`/"Generated with" trailer, no internal IDs (module/phase numbers). One logical unit per commit. Never `--no-verify`. **Stage files by name; never `git add -A`.**
- **Do not touch** the maintainer's unrelated in-flight edits: `packages/console-ui/src/dense/Transcript.tsx`, `packages/console-ui/src/dense/Composer.tsx`, `apps/desktop/src/renderer/panels/ChatPanel.tsx`; and never stage `LOCAL.md` / `harness-system-prompt.md`.
- **Commands (Windows, repo root):** focused test `corepack pnpm vitest run <path>` (per-package `pnpm -C <pkg> test` does NOT resolve — use root vitest). Full suite `corepack pnpm test` (**pre-existing unrelated failures exist** — 2 in `console.test.tsx` from the maintainer's live edits; treat "green modulo those" as green). Build `corepack pnpm -C apps/desktop build`. Typecheck `corepack pnpm -C apps/desktop exec tsc -b 2>&1` (pre-existing errors ONLY in `Transcript.tsx`/`ChatPanel.tsx` are the maintainer's live edits — your files must add ZERO new errors).

---

## File Structure

**Create (console-ui):**
- `src/dense/syntaxTheme.ts` — `HLJS_TOKEN_STYLE` (moved from CodeBlock), language registration, `SyntaxText`.
- `src/dense/react-syntax-highlighter-langs.d.ts` — ambient types for the deep hljs language imports.
- `src/dense/syntaxTheme.test.tsx`
- `src/dense/pathLanguage.ts` + `.test.ts` — `languageForPath`.
- `src/dense/clampLines.ts` + `.test.ts` — `clampLines`.
- `src/dense/ToolDiffView.tsx` + `.test.tsx` — highlighted byte-faithful diff.
- `src/layout/PaneOverlay.tsx` + `.test.tsx` + `PaneOverlay.intent.ts` — pane-scoped overlay.
- `src/dense/ToolCard.tsx` + `.test.tsx` + `ToolCard.intent.ts` — the promoted rich card.

**Modify (console-ui):**
- `src/dense/CodeBlock.tsx` — import `HLJS_TOKEN_STYLE` from `syntaxTheme.js` (drop its local copy).
- `src/dense/toolRegistry.ts` — add `toolPath`.
- `src/index.ts` — barrel exports.

**Modify/Delete (apps/desktop):**
- `src/renderer/panels/showcase/ChatMockups.tsx` — render kit `ToolCard` in a `PaneOverlayProvider` + `ToastProvider`; path click → toast.
- `src/renderer/panels/showcase/toolblocks/samples.ts` — add a long-output sample.
- Delete `src/renderer/panels/showcase/toolblocks/RichToolCard.tsx` (promoted into the kit).

**Docs (same commit as their code):** `COMPONENTS.md` / `docs/UI.md` (new kit members), `docs/REPO_LAYOUT.md` (new/deleted files).

---

## Task 1: Syntax theme + language registration + `SyntaxText`

Extract the highlight theme, **register the hljs languages** (the missing piece that makes highlighting actually render), and add a one-line/fragment highlighter. Refactor `CodeBlock` to share the theme.

**Files:**
- Create: `packages/console-ui/src/dense/syntaxTheme.ts`, `packages/console-ui/src/dense/react-syntax-highlighter-langs.d.ts`
- Test: `packages/console-ui/src/dense/syntaxTheme.test.tsx`
- Modify: `packages/console-ui/src/dense/CodeBlock.tsx`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Produces: `HLJS_TOKEN_STYLE: Record<string, React.CSSProperties>`; `interface SyntaxTextProps { code: string; language?: string | undefined; className?: string | undefined }`; `function SyntaxText(props: SyntaxTextProps): React.JSX.Element`.

- [ ] **Step 1: Ambient types for the language modules**

Create `packages/console-ui/src/dense/react-syntax-highlighter-langs.d.ts`:

```ts
// The hljs language modules ship without bundled types. Each default export is an
// hljs language definition function; typing it loosely (not `any`) keeps strict mode.
declare module 'react-syntax-highlighter/dist/esm/languages/hljs/*' {
  const language: (hljs: unknown) => unknown;
  export default language;
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// packages/console-ui/src/dense/syntaxTheme.test.tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SyntaxText } from './syntaxTheme.js';

describe('SyntaxText', () => {
  it('tokenizes a registered language into multiple spans, byte-faithfully', () => {
    const { container } = render(<SyntaxText code="const x = 1;" language="typescript" />);
    expect(container.textContent).toBe('const x = 1;'); // D128: verbatim
    expect(container.querySelectorAll('span').length).toBeGreaterThan(1); // real highlighting
  });

  it('renders plain (no tokenization) without a language, still byte-faithful', () => {
    const { container } = render(<SyntaxText code="const x = 1;" />);
    expect(container.textContent).toBe('const x = 1;');
  });

  it('preserves leading whitespace verbatim', () => {
    const { container } = render(<SyntaxText code={'    indented();'} language="typescript" />);
    expect(container.textContent).toBe('    indented();');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/syntaxTheme.test.tsx`
Expected: FAIL — cannot resolve `./syntaxTheme.js`.

- [ ] **Step 4: Write `syntaxTheme.ts`**

```tsx
// packages/console-ui/src/dense/syntaxTheme.ts
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash';
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css';
import go from 'react-syntax-highlighter/dist/esm/languages/hljs/go';
import javascript from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import markdown from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown';
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/hljs/rust';
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql';
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript';
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml';
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml';
import { cx } from '../lib/cx.js';

// The `Light` build ships with NO languages registered, so without this every code
// block renders unhighlighted. Register once at module load (side effect on import).
const LANGUAGES: Record<string, (hljs: unknown) => unknown> = {
  bash, css, go, javascript, json, markdown, python, rust, sql, typescript, xml, yaml,
};
for (const [name, mod] of Object.entries(LANGUAGES)) {
  SyntaxHighlighter.registerLanguage(name, mod);
}

/** Token-derived highlight style: colors come from CSS token variables so code stays
 *  on-theme in both themes. The highlighter applies these as inline styles (byte-faithful
 *  spans, no innerHTML); token class names are stripped. */
export const HLJS_TOKEN_STYLE: Record<string, React.CSSProperties> = {
  hljs: { color: 'var(--color-fg)', background: 'transparent' },
  'hljs-keyword': { color: 'var(--color-accent)' },
  'hljs-built_in': { color: 'var(--color-info-text)' },
  'hljs-type': { color: 'var(--color-info-text)' },
  'hljs-string': { color: 'var(--color-success-text)' },
  'hljs-number': { color: 'var(--color-warning-text)' },
  'hljs-comment': { color: 'var(--color-faint)', fontStyle: 'italic' },
  'hljs-function': { color: 'var(--color-fg)' },
  'hljs-title': { color: 'var(--color-accent-hover)' },
  'hljs-params': { color: 'var(--color-fg)' },
  'hljs-attr': { color: 'var(--color-fg)' },
  'hljs-literal': { color: 'var(--color-warning-text)' },
};

export interface SyntaxTextProps {
  code: string;
  /** hljs language id (see languageForPath). Undefined renders plain, still byte-faithful. */
  language?: string | undefined;
  className?: string | undefined;
}

/** One line/fragment of code as inline syntax-highlighted spans on a transparent
 *  background, so a surrounding row tint shows through. Byte-faithful — the text is
 *  never mutated, only wrapped in colored spans. */
export function SyntaxText({ code, language, className }: SyntaxTextProps): React.JSX.Element {
  if (language === undefined) {
    return <span className={cx('font-mono text-label text-fg', className)}>{code}</span>;
  }
  return (
    <SyntaxHighlighter
      language={language}
      style={HLJS_TOKEN_STYLE}
      customStyle={{ margin: 0, padding: 0, background: 'transparent', display: 'inline' }}
      codeTagProps={{ className: cx('font-mono text-label', className) }}
      PreTag="span"
      CodeTag="span"
    >
      {code}
    </SyntaxHighlighter>
  );
}
```

If `SyntaxHighlighter.registerLanguage(name, mod)` raises a strict type error (the `@types` param type rejecting the loose function type), narrow via a locally-typed alias rather than `any` — e.g. type `LANGUAGES` values to match the imported `typescript`'s inferred type. Do not reach for `any`/`@ts-expect-error`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/syntaxTheme.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Refactor `CodeBlock` to share the theme + add a guard test**

In `packages/console-ui/src/dense/CodeBlock.tsx`, delete its local `HLJS_TOKEN_STYLE` object and import it instead:

```tsx
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { CopyButton } from '../actions/CopyButton.js';
import { cx } from '../lib/cx.js';
import { HLJS_TOKEN_STYLE } from './syntaxTheme.js';
```

(Leave the rest of `CodeBlock` unchanged — it keeps passing `style={HLJS_TOKEN_STYLE}`.) Append a guard test to `syntaxTheme.test.tsx` proving registration now flows through `CodeBlock`:

```tsx
import { CodeBlock } from './CodeBlock.js';

describe('CodeBlock (registration guard)', () => {
  it('now tokenizes a registered language into multiple spans', () => {
    const { container } = render(<CodeBlock code="const x = 1;" language="typescript" />);
    expect(container.querySelectorAll('span').length).toBeGreaterThan(1);
    expect(container.textContent).toContain('const x = 1;');
  });
});
```

Run: `corepack pnpm vitest run packages/console-ui/src/dense/syntaxTheme.test.tsx` → PASS (4 tests).

- [ ] **Step 7: Barrel export + typecheck**

In `packages/console-ui/src/index.ts`, after the `estimateTokens`/`formatTokens` line, add:

```ts
export { SyntaxText, type SyntaxTextProps } from './dense/syntaxTheme.js';
```

Run: `corepack pnpm -C packages/console-ui exec tsc -b` → exits 0 (if a pre-existing `Transcript.tsx` error appears, confirm it is ONLY in `Transcript.tsx`).

- [ ] **Step 8: Commit**

```bash
git add packages/console-ui/src/dense/syntaxTheme.ts packages/console-ui/src/dense/react-syntax-highlighter-langs.d.ts packages/console-ui/src/dense/syntaxTheme.test.tsx packages/console-ui/src/dense/CodeBlock.tsx packages/console-ui/src/index.ts
git commit -m "feat: register syntax languages and add an inline code highlighter"
```

---

## Task 2: `languageForPath`

**Files:**
- Create: `packages/console-ui/src/dense/pathLanguage.ts`
- Test: `packages/console-ui/src/dense/pathLanguage.test.ts`
- Modify: `packages/console-ui/src/index.ts`

**Interfaces:**
- Produces: `function languageForPath(path: string): string | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/console-ui/src/dense/pathLanguage.test.ts
import { describe, expect, it } from 'vitest';
import { languageForPath } from './pathLanguage.js';

describe('languageForPath', () => {
  it('maps known extensions to hljs languages', () => {
    expect(languageForPath('src/auth.ts')).toBe('typescript');
    expect(languageForPath('a.tsx')).toBe('typescript');
    expect(languageForPath('main.py')).toBe('python');
    expect(languageForPath('README.md')).toBe('markdown');
    expect(languageForPath('data.json')).toBe('json');
    expect(languageForPath('run.sh')).toBe('bash');
    expect(languageForPath('lib.rs')).toBe('rust');
  });

  it('ignores directories and is case-insensitive', () => {
    expect(languageForPath('deep/nested/dir/File.TS')).toBe('typescript');
    expect(languageForPath('C:\\win\\path\\x.PY')).toBe('python');
  });

  it('returns undefined for unknown/absent extensions and dotfiles', () => {
    expect(languageForPath('Makefile')).toBeUndefined();
    expect(languageForPath('binary.xyz')).toBeUndefined();
    expect(languageForPath('.gitignore')).toBeUndefined();
    expect(languageForPath('noext')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/pathLanguage.test.ts`
Expected: FAIL — cannot resolve `./pathLanguage.js`.

- [ ] **Step 3: Write `pathLanguage.ts`**

```ts
// packages/console-ui/src/dense/pathLanguage.ts

/** Extension → hljs language id. Only languages registered in syntaxTheme.ts appear here. */
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', json: 'json', md: 'markdown', markdown: 'markdown',
  css: 'css', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  sh: 'bash', bash: 'bash', zsh: 'bash', rs: 'rust', go: 'go',
  yml: 'yaml', yaml: 'yaml', sql: 'sql',
};

/** The hljs language for a file path, by extension; undefined when unknown or absent.
 *  Pure; never throws. */
export function languageForPath(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined; // no extension, or a dotfile like `.gitignore`
  return EXT_LANG[base.slice(dot + 1).toLowerCase()];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/pathLanguage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Barrel export + commit**

In `packages/console-ui/src/index.ts` add: `export { languageForPath } from './dense/pathLanguage.js';`

```bash
git add packages/console-ui/src/dense/pathLanguage.ts packages/console-ui/src/dense/pathLanguage.test.ts packages/console-ui/src/index.ts
git commit -m "feat: map file paths to a highlight language"
```

---

## Task 3: `clampLines`

**Files:**
- Create: `packages/console-ui/src/dense/clampLines.ts`
- Test: `packages/console-ui/src/dense/clampLines.test.ts`
- Modify: `packages/console-ui/src/index.ts`

**Interfaces:**
- Produces: `interface ClampedLines { shown: string; truncated: boolean; hiddenCount: number }`; `function clampLines(text: string, maxLines: number, opts?: { fromEnd?: boolean } | undefined): ClampedLines`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/console-ui/src/dense/clampLines.test.ts
import { describe, expect, it } from 'vitest';
import { clampLines } from './clampLines.js';

describe('clampLines', () => {
  it('returns the text untouched when within the limit', () => {
    expect(clampLines('a\nb\nc', 5)).toEqual({ shown: 'a\nb\nc', truncated: false, hiddenCount: 0 });
    expect(clampLines('a\nb\nc', 3)).toEqual({ shown: 'a\nb\nc', truncated: false, hiddenCount: 0 });
  });

  it('clamps to the first N lines when over the limit (byte-faithful shown)', () => {
    expect(clampLines('a\nb\nc\nd', 2)).toEqual({ shown: 'a\nb', truncated: true, hiddenCount: 2 });
  });

  it('clamps to the last N lines with fromEnd', () => {
    expect(clampLines('a\nb\nc\nd', 2, { fromEnd: true })).toEqual({
      shown: 'c\nd',
      truncated: true,
      hiddenCount: 2,
    });
  });

  it('preserves whitespace lines verbatim', () => {
    expect(clampLines('  x\n\ty\nz', 2).shown).toBe('  x\n\ty');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/clampLines.test.ts`
Expected: FAIL — cannot resolve `./clampLines.js`.

- [ ] **Step 3: Write `clampLines.ts`**

```ts
// packages/console-ui/src/dense/clampLines.ts

export interface ClampedLines {
  shown: string;
  truncated: boolean;
  hiddenCount: number;
}

/** Clamp text to `maxLines`, from the start (default) or the end (`fromEnd`). Deterministic
 *  and byte-faithful — `shown` is exact source lines. Pure; never throws. */
export function clampLines(
  text: string,
  maxLines: number,
  opts?: { fromEnd?: boolean } | undefined,
): ClampedLines {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { shown: text, truncated: false, hiddenCount: 0 };
  const hiddenCount = lines.length - maxLines;
  const shown = (opts?.fromEnd === true ? lines.slice(-maxLines) : lines.slice(0, maxLines)).join('\n');
  return { shown, truncated: true, hiddenCount };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/clampLines.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Barrel export + commit**

In `packages/console-ui/src/index.ts` add: `export { clampLines, type ClampedLines } from './dense/clampLines.js';`

```bash
git add packages/console-ui/src/dense/clampLines.ts packages/console-ui/src/dense/clampLines.test.ts packages/console-ui/src/index.ts
git commit -m "feat: add a deterministic line clamp for tool bodies"
```

---

## Task 4: `toolPath`

Extract the **raw** file path a tool touches (the click target), separate from the formatted `summary`.

**Files:**
- Modify: `packages/console-ui/src/dense/toolRegistry.ts`, `packages/console-ui/src/index.ts`
- Test: `packages/console-ui/src/dense/toolRegistry.test.ts` (append)

**Interfaces:**
- Consumes: the existing internal `parseInput` and `str` helpers in `toolRegistry.ts`.
- Produces: `function toolPath(tool: string, input: string): string | undefined`.

- [ ] **Step 1: Append the failing test**

Add to `packages/console-ui/src/dense/toolRegistry.test.ts`:

```ts
import { toolPath } from './toolRegistry.js'; // add toolPath to the existing import

describe('toolPath', () => {
  it('extracts the raw path for the file tools (file_path or base-tool path)', () => {
    expect(toolPath('Read', '{"file_path":"src/auth.ts","offset":1,"limit":40}')).toBe('src/auth.ts');
    expect(toolPath('Read', '{"path":"a.ts"}')).toBe('a.ts');
    expect(toolPath('Edit', '{"file_path":"b.ts","old_string":"x","new_string":"y"}')).toBe('b.ts');
    expect(toolPath('Write', '{"file_path":"c.ts","content":"z"}')).toBe('c.ts');
    expect(toolPath('NotebookEdit', '{"notebook_path":"n.ipynb"}')).toBe('n.ipynb');
  });

  it('returns undefined for non-file tools, unknown tools, and malformed input', () => {
    expect(toolPath('Bash', '{"command":"ls"}')).toBeUndefined();
    expect(toolPath('get_symbol', '{"ref":{"name":"x"}}')).toBeUndefined();
    expect(toolPath('DeployRocket', '{"file_path":"x"}')).toBeUndefined();
    expect(() => toolPath('Read', 'not json')).not.toThrow();
    expect(toolPath('Read', 'not json')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/toolRegistry.test.ts`
Expected: FAIL — `toolPath is not a function`.

- [ ] **Step 3: Add `toolPath` to `toolRegistry.ts`**

Append near `describeTool` (reusing the file's existing `parseInput` and `str` helpers):

```ts
/** The raw file path a file tool touches (the click target), or undefined for non-file
 *  tools / malformed input. Distinct from describeTool's formatted summary (which carries
 *  the range/diff stat). Pure; never throws. */
export function toolPath(tool: string, input: string): string | undefined {
  if (tool !== 'Read' && tool !== 'Edit' && tool !== 'Write' && tool !== 'NotebookEdit') {
    return undefined;
  }
  const rec = parseInput(input);
  return str(rec, 'file_path') ?? str(rec, 'path') ?? str(rec, 'notebook_path');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/toolRegistry.test.ts`
Expected: PASS (all prior + 2 new).

- [ ] **Step 5: Barrel export + commit**

In `packages/console-ui/src/index.ts`, change the existing toolRegistry export line to include `toolPath`:

```ts
export { describeTool, toolPath, type ToolDescriptor } from './dense/toolRegistry.js';
```

```bash
git add packages/console-ui/src/dense/toolRegistry.ts packages/console-ui/src/dense/toolRegistry.test.ts packages/console-ui/src/index.ts
git commit -m "feat: expose the raw file path a tool touches"
```

---

## Task 5: `ToolDiffView`

A byte-faithful inline diff whose lines are syntax-highlighted while keeping red/green tints.

**Files:**
- Create: `packages/console-ui/src/dense/ToolDiffView.tsx`
- Test: `packages/console-ui/src/dense/ToolDiffView.test.tsx`
- Modify: `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `SyntaxText` (Task 1); `type DiffLine` from `./toolDiff.js`.
- Produces: `interface ToolDiffViewProps { lines: DiffLine[]; language?: string | undefined }`; `function ToolDiffView(props: ToolDiffViewProps): React.JSX.Element`. (Takes pre-computed `DiffLine[]` so the card can clamp/full it.)

- [ ] **Step 1: Write the failing test**

```tsx
// packages/console-ui/src/dense/ToolDiffView.test.tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { diffLines } from './toolDiff.js';
import { ToolDiffView } from './ToolDiffView.js';

describe('ToolDiffView', () => {
  it('tints added/removed rows and renders each line verbatim (payload only)', () => {
    const { lines } = diffLines('a\nb', 'a\nB');
    const { container } = render(<ToolDiffView lines={lines} language="typescript" />);
    const added = container.querySelector('.bg-success-tint');
    const removed = container.querySelector('.bg-danger-tint');
    // The payload span is the row's last child (after the gutter-marker span).
    expect(added?.lastElementChild?.textContent).toBe('B');
    expect(removed?.lastElementChild?.textContent).toBe('b');
  });

  it('keeps the gutter marker as a separate aria-hidden span (D128: not fused into text)', () => {
    const { lines } = diffLines('x', 'y');
    const { container } = render(<ToolDiffView lines={lines} />);
    const marker = container.querySelector('[aria-hidden="true"]');
    expect(marker?.textContent).toMatch(/^[+\-\s]\s$/);
  });

  it('preserves leading whitespace in diff lines verbatim', () => {
    const { lines } = diffLines('  x', '\tx');
    const { container } = render(<ToolDiffView lines={lines} language="typescript" />);
    expect(container.querySelector('.bg-danger-tint')?.lastElementChild?.textContent).toBe('  x');
    expect(container.querySelector('.bg-success-tint')?.lastElementChild?.textContent).toBe('\tx');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/ToolDiffView.test.tsx`
Expected: FAIL — cannot resolve `./ToolDiffView.js`.

- [ ] **Step 3: Write `ToolDiffView.tsx`**

```tsx
// packages/console-ui/src/dense/ToolDiffView.tsx
import type { DiffLine } from './toolDiff.js';
import { SyntaxText } from './syntaxTheme.js';
import { cx } from '../lib/cx.js';

export interface ToolDiffViewProps {
  lines: DiffLine[];
  language?: string | undefined;
}

/** Byte-faithful inline diff: each row is a presentational gutter marker span plus the
 *  verbatim line, syntax-highlighted, over an add/remove/context tint. The marker is a
 *  separate span (never fused into the highlighted text) so payload bytes stay exact. */
export function ToolDiffView({ lines, language }: ToolDiffViewProps): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <div className="w-full font-mono text-label leading-[1.55]">
        {lines.map((line, i) => (
          <DiffRow key={i} line={line} language={language} />
        ))}
      </div>
    </div>
  );
}

function DiffRow({ line, language }: { line: DiffLine; language?: string | undefined }): React.JSX.Element {
  const marker = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
  return (
    <div
      className={cx(
        'whitespace-pre px-2.5',
        line.kind === 'added' && 'bg-success-tint',
        line.kind === 'removed' && 'bg-danger-tint',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'select-none',
          line.kind === 'added' && 'text-success-text',
          line.kind === 'removed' && 'text-danger-text',
          line.kind === 'context' && 'text-faint',
        )}
      >
        {`${marker} `}
      </span>
      <SyntaxText code={line.text} language={language} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/ToolDiffView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Barrel export + commit**

In `packages/console-ui/src/index.ts` add: `export { ToolDiffView, type ToolDiffViewProps } from './dense/ToolDiffView.js';`

```bash
git add packages/console-ui/src/dense/ToolDiffView.tsx packages/console-ui/src/dense/ToolDiffView.test.tsx packages/console-ui/src/index.ts
git commit -m "feat: add a syntax-highlighted byte-faithful diff view"
```

---

## Task 6: `PaneOverlay`

A pane-scoped overlay host: a provider that confines an overlay to its own container (never the whole window) and a hook cards call to open full content.

**Files:**
- Create: `packages/console-ui/src/layout/PaneOverlay.tsx`, `packages/console-ui/src/layout/PaneOverlay.intent.ts`
- Test: `packages/console-ui/src/layout/PaneOverlay.test.tsx`
- Modify: `packages/console-ui/src/index.ts`

**Interfaces:**
- Produces: `interface PaneOverlayApi { open: (content: React.ReactNode, title?: string) => void; close: () => void }`; `function usePaneOverlay(): PaneOverlayApi | null`; `interface PaneOverlayProviderProps { children: React.ReactNode; className?: string | undefined }`; `function PaneOverlayProvider(props): React.JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/console-ui/src/layout/PaneOverlay.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PaneOverlayProvider, usePaneOverlay } from './PaneOverlay.js';

function Opener(): React.JSX.Element {
  const overlay = usePaneOverlay();
  return <button onClick={() => overlay?.open(<p>FULL BODY</p>, 'Detail')}>open</button>;
}

function NullProbe(): React.JSX.Element {
  return <span>{usePaneOverlay() === null ? 'no-provider' : 'has-provider'}</span>;
}

describe('PaneOverlay', () => {
  it('opens content inside the provider container (contained, not portalled to body)', async () => {
    const { container } = render(
      <PaneOverlayProvider>
        <Opener />
      </PaneOverlayProvider>,
    );
    expect(screen.queryByText('FULL BODY')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('open'));
    const body = screen.getByText('FULL BODY');
    expect(body).toBeInTheDocument();
    expect(container.contains(body)).toBe(true); // confined to the pane, not document.body
  });

  it('closes on the close button and on Escape', async () => {
    render(
      <PaneOverlayProvider>
        <Opener />
      </PaneOverlayProvider>,
    );
    await userEvent.click(screen.getByText('open'));
    await userEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(screen.queryByText('FULL BODY')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('open'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('FULL BODY')).not.toBeInTheDocument();
  });

  it('usePaneOverlay returns null with no provider', () => {
    render(<NullProbe />);
    expect(screen.getByText('no-provider')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/console-ui/src/layout/PaneOverlay.test.tsx`
Expected: FAIL — cannot resolve `./PaneOverlay.js`.

- [ ] **Step 3: Write `PaneOverlay.tsx`**

```tsx
// packages/console-ui/src/layout/PaneOverlay.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';

export interface PaneOverlayApi {
  open: (content: ReactNode, title?: string) => void;
  close: () => void;
}

interface OverlayState {
  content: ReactNode;
  title?: string | undefined;
}

const PaneOverlayContext = createContext<PaneOverlayApi | null>(null);

/** Cards call this to open their full body in the pane overlay. Returns null when no
 *  PaneOverlayProvider is above (callers fall back to inline expansion). */
export function usePaneOverlay(): PaneOverlayApi | null {
  return useContext(PaneOverlayContext);
}

export interface PaneOverlayProviderProps {
  children: ReactNode;
  className?: string | undefined;
}

/** Wraps a pane and hosts an overlay confined to it: the overlay is `absolute inset-0`
 *  within this `relative` container, so it never covers the window. */
export function PaneOverlayProvider({ children, className }: PaneOverlayProviderProps): React.JSX.Element {
  const [state, setState] = useState<OverlayState | null>(null);
  const open = useCallback((content: ReactNode, title?: string) => setState({ content, title }), []);
  const close = useCallback(() => setState(null), []);
  const api = useMemo<PaneOverlayApi>(() => ({ open, close }), [open, close]);
  return (
    <PaneOverlayContext.Provider value={api}>
      <div className={cx('relative h-full min-h-0', className)}>
        {children}
        {state !== null && <PaneOverlayHost state={state} onClose={close} />}
      </div>
    </PaneOverlayContext.Provider>
  );
}

function PaneOverlayHost({ state, onClose }: { state: OverlayState; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const title = state.title ?? 'Details';
  return (
    <div className="absolute inset-0 z-30 flex flex-col" role="dialog" aria-label={title}>
      {/* Backdrop confined to the pane; click to dismiss. */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div className="relative m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-overlay border border-border-default bg-raised shadow-xl">
        <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
          <span className="text-label font-medium text-fg">{title}</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={cx('rounded-control p-0.5 text-muted hover:bg-element-hover', focusRing)}
          >
            <X aria-hidden size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">{state.content}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/console-ui/src/layout/PaneOverlay.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Intent block**

Create `packages/console-ui/src/layout/PaneOverlay.intent.ts` (mirror `Transcript.intent.ts`'s shape):

```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const paneOverlayIntent: ComponentIntent = assertIntent({
  name: 'PaneOverlay',
  family: 'Layout',
  intent: 'A modal-like overlay confined to its own pane, never the whole window.',
  useWhen: [
    'Expanding a truncated in-pane detail (e.g. a full tool diff/output) over just the chat pane.',
  ],
  dontUseWhen: [
    'A window-level modal is wanted — use Dialog.',
    'A transient message is enough — use Toast.',
  ],
  anatomy:
    'A provider wrapping a relative pane container; an absolute-inset overlay layer with a pane-confined scrim and a scrollable titled panel (close button); an open/close API exposed via usePaneOverlay.',
  variantsStates: ['closed', 'open'],
  accessibility:
    'role=dialog with an aria-label; Escape and backdrop/close-button dismiss; the panel is a focusable, scrollable region.',
  related: ['Dialog', 'Sheet', 'Toast'],
});
```

- [ ] **Step 6: Barrel export + typecheck + commit**

In `packages/console-ui/src/index.ts` add:

```ts
export { PaneOverlayProvider, usePaneOverlay, type PaneOverlayProviderProps, type PaneOverlayApi } from './layout/PaneOverlay.js';
```

Run: `corepack pnpm -C packages/console-ui exec tsc -b` → exits 0 (modulo pre-existing `Transcript.tsx`).

```bash
git add packages/console-ui/src/layout/PaneOverlay.tsx packages/console-ui/src/layout/PaneOverlay.test.tsx packages/console-ui/src/layout/PaneOverlay.intent.ts packages/console-ui/src/index.ts
git commit -m "feat: add a pane-scoped expand overlay"
```

---

## Task 7: `ToolCard`

The promoted rich card: highlighted diff/preview/tail body, clickable path, `≈ tok`/status header, clamped to `maxLines` with Expand → pane overlay (inline fallback when no provider).

**Files:**
- Create: `packages/console-ui/src/dense/ToolCard.tsx`, `packages/console-ui/src/dense/ToolCard.intent.ts`
- Test: `packages/console-ui/src/dense/ToolCard.test.tsx`
- Modify: `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `describeTool`, `toolPath` (Task 4); `estimateTokens`, `formatTokens`; `diffLines`, `type DiffLine`; `languageForPath` (Task 2); `clampLines` (Task 3); `ToolDiffView` (Task 5); `SyntaxText` (Task 1); `usePaneOverlay` (Task 6).
- Produces: `interface ToolCardProps { tool: string; input: string; output?: string | undefined; ok?: boolean | undefined; onOpenPath?: ((path: string) => void) | undefined; maxLines?: number | undefined }`; `function ToolCard(props: ToolCardProps): React.JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/console-ui/src/dense/ToolCard.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaneOverlayProvider } from '../layout/PaneOverlay.js';
import { ToolCard } from './ToolCard.js';

const editInput = JSON.stringify({
  file_path: 'src/auth.ts',
  old_string: 'const a = 1;',
  new_string: 'const a = 2;',
});

describe('ToolCard', () => {
  it('renders the verb, a clickable path button that fires onOpenPath, tokens and status', async () => {
    const onOpenPath = vi.fn();
    render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} onOpenPath={onOpenPath} />);
    expect(screen.getByText('Edit')).toBeInTheDocument();
    const pathBtn = screen.getByRole('button', { name: 'src/auth.ts' });
    await userEvent.click(pathBtn);
    expect(onOpenPath).toHaveBeenCalledWith('src/auth.ts');
    expect(screen.getByText(/≈ .* tok/)).toBeInTheDocument();
  });

  it('renders the path as plain text (no button) when onOpenPath is omitted', () => {
    render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} />);
    expect(screen.queryByRole('button', { name: 'src/auth.ts' })).not.toBeInTheDocument();
    expect(screen.getByText('src/auth.ts')).toBeInTheDocument();
  });

  it('truncates a long body and expands it into the pane overlay', async () => {
    const output = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    render(
      <PaneOverlayProvider>
        <ToolCard tool="Bash" input='{"command":"seq 30"}' output={output} ok={true} maxLines={5} />
      </PaneOverlayProvider>,
    );
    // Clamped: an early line is hidden by the tail clamp; the Expand affordance shows the hidden count.
    const expand = screen.getByRole('button', { name: /expand|more/i });
    expect(expand).toBeInTheDocument();
    await userEvent.click(expand);
    // The overlay (role=dialog) now holds the full body — line 0 is present there.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('line 0');
  });

  it('renders a byte-faithful highlighted diff for an edit', () => {
    const { container } = render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} />);
    expect(container.querySelector('.bg-danger-tint')?.textContent).toContain('const a = 1;');
    expect(container.querySelector('.bg-success-tint')?.textContent).toContain('const a = 2;');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/ToolCard.test.tsx`
Expected: FAIL — cannot resolve `./ToolCard.js`.

- [ ] **Step 3: Write `ToolCard.tsx`**

```tsx
// packages/console-ui/src/dense/ToolCard.tsx
import { Check, Loader2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cx } from '../lib/cx.js';
import { usePaneOverlay } from '../layout/PaneOverlay.js';
import { describeTool, toolPath } from './toolRegistry.js';
import { diffLines } from './toolDiff.js';
import { estimateTokens, formatTokens } from './tokenEstimate.js';
import { languageForPath } from './pathLanguage.js';
import { clampLines } from './clampLines.js';
import { ToolDiffView } from './ToolDiffView.js';
import { SyntaxText } from './syntaxTheme.js';

export interface ToolCardProps {
  tool: string;
  input: string;
  output?: string | undefined;
  ok?: boolean | undefined;
  /** Reveal the touched file (file tools) in the editor/OS. Path is plain text when omitted. */
  onOpenPath?: ((path: string) => void) | undefined;
  /** Max body lines before truncation + Expand. Default 14. */
  maxLines?: number | undefined;
}

/** The rich tool card: a titled header (icon · verb · clickable path · summary · ≈tok ·
 *  status) over a body that leads with a highlighted byte-faithful diff (edits/writes), a
 *  highlighted read preview, or a plain command-output tail — clamped to maxLines, with
 *  Expand opening the full body in the pane overlay (or inline when no provider). */
export function ToolCard({
  tool,
  input,
  output,
  ok,
  onOpenPath,
  maxLines = 14,
}: ToolCardProps): React.JSX.Element {
  const overlay = usePaneOverlay();
  const [inlineExpanded, setInlineExpanded] = useState(false);
  const { icon: Icon, verb, summary } = describeTool(tool, input, output, ok);
  const path = toolPath(tool, input);
  const language = path !== undefined ? languageForPath(path) : undefined;
  const running = output === undefined && ok === undefined;
  const extra = path !== undefined && summary.startsWith(path) ? summary.slice(path.length) : '';

  const title = `${verb}${path !== undefined ? ` ${path}` : ''}`;
  const onExpand = (): void => {
    if (overlay !== null) overlay.open(renderBody(true), title);
    else setInlineExpanded(true);
  };

  function renderBody(full: boolean): ReactNode {
    if (running) {
      return <div className="px-2.5 py-2 text-caption text-faint">running…</div>;
    }
    const edit = parseEdit(tool, input);
    if (edit !== undefined) {
      const all = diffLines(edit.before, edit.after).lines;
      const truncated = all.length > maxLines;
      const lines = full ? all : all.slice(0, maxLines);
      return (
        <>
          <ToolDiffView lines={lines} language={language} />
          {!full && truncated && <ExpandRow hidden={all.length - maxLines} onExpand={onExpand} />}
        </>
      );
    }
    if (output === undefined || output.length === 0) return null;
    const isTail = tool === 'Bash';
    const previewLang = tool === 'Read' ? language : undefined; // reads get language; commands/searches stay plain
    const clamped = clampLines(output, maxLines, isTail ? { fromEnd: true } : undefined);
    const shown = full ? output : clamped.shown;
    return (
      <>
        <div
          className={cx(
            'overflow-x-auto whitespace-pre px-2.5 py-2 font-mono text-label leading-[1.55]',
            ok === false ? 'text-danger-text' : 'text-muted',
          )}
        >
          {shown.split('\n').map((ln, i) => (
            <div key={i}>
              <SyntaxText code={ln} language={previewLang} />
            </div>
          ))}
        </div>
        {!full && clamped.truncated && <ExpandRow hidden={clamped.hiddenCount} onExpand={onExpand} />}
      </>
    );
  }

  const showInline = inlineExpanded && overlay === null;

  return (
    <div className="overflow-hidden rounded-surface border border-hairline bg-subtle">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Icon aria-hidden size={14} className="shrink-0 text-muted" />
        <span className="shrink-0 text-label font-medium text-fg">{verb}</span>
        {path !== undefined ? (
          <span className="flex min-w-0 items-center gap-1">
            {onOpenPath !== undefined ? (
              <button
                type="button"
                onClick={() => onOpenPath(path)}
                className="min-w-0 truncate text-label text-info underline decoration-dotted underline-offset-2 hover:text-info-text"
              >
                {path}
              </button>
            ) : (
              <span className="min-w-0 truncate text-label text-muted">{path}</span>
            )}
            {extra.length > 0 && <span className="shrink-0 text-label text-muted">{extra}</span>}
          </span>
        ) : (
          summary.length > 0 && <span className="min-w-0 truncate text-label text-muted">{summary}</span>
        )}
        {output !== undefined && (
          <span className="ml-auto shrink-0 pl-2 text-caption tabular-nums text-faint">
            ≈ {formatTokens(estimateTokens(output))} tok
          </span>
        )}
        <span className={cx('shrink-0 pl-2', output === undefined && 'ml-auto')}>
          {running ? (
            <Loader2 aria-hidden size={13} className="animate-spin text-info motion-reduce:animate-none" />
          ) : ok === false ? (
            <X aria-label="failed" size={13} className="text-danger" />
          ) : (
            <Check aria-label="ok" size={13} className="text-success" />
          )}
        </span>
      </div>
      <div className="border-t border-hairline">{renderBody(showInline)}</div>
    </div>
  );
}

function ExpandRow({ hidden, onExpand }: { hidden: number; onExpand: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex w-full items-center gap-1 px-2.5 py-1 text-left text-caption text-info hover:bg-element motion-reduce:transition-none"
    >
      View · {hidden} more {hidden === 1 ? 'line' : 'lines'}
    </button>
  );
}

/** Extract an edit's before/after for the diff body: old_string/new_string, or a Write's
 *  content as an all-added diff. Undefined (→ preview body) for anything else / malformed. */
function parseEdit(tool: string, input: string): { before: string; after: string } | undefined {
  let rec: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(input);
    if (typeof v !== 'object' || v === null) return undefined;
    rec = v as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const before = rec['old_string'];
  const after = rec['new_string'];
  if (typeof before === 'string' && typeof after === 'string') return { before, after };
  if (tool === 'Write' && typeof rec['content'] === 'string') return { before: '', after: rec['content'] };
  return undefined;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/ToolCard.test.tsx`
Expected: PASS (4 tests). If the tail-clamp test can't find the Expand control, confirm `maxLines={5}` against a 30-line output yields `truncated: true` (it does: 30 > 5).

- [ ] **Step 5: Intent block**

Create `packages/console-ui/src/dense/ToolCard.intent.ts`:

```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const toolCardIntent: ComponentIntent = assertIntent({
  name: 'ToolCard',
  family: 'Dense/Viz',
  intent: 'A rich, self-contained rendering of one agent tool call.',
  useWhen: [
    'Showing a tool call in the transcript — a highlighted diff for edits, a read/search preview, or a command-output tail, with a clickable path and an estimated-token readout.',
  ],
  dontUseWhen: [
    'Rendering prose or a plan checklist — those are their own transcript kinds.',
    'A one-line activity summary is enough — that is a different tool-block direction.',
  ],
  anatomy:
    'A header (tool icon, verb, clickable file path, summary, estimated tokens, status glyph) over a body that leads with a byte-faithful highlighted diff / preview / output tail, clamped to a max line count with an Expand affordance that opens the full body in the pane overlay.',
  variantsStates: ['running', 'ok', 'failed', 'diff', 'preview', 'command-tail', 'truncated', 'expanded'],
  accessibility:
    'The path is a focusable button when actionable; Expand is a button; the status glyph carries an aria-label; payload bytes render verbatim.',
  related: ['ToolDiffView', 'PaneOverlay', 'Code', 'Transcript'],
});
```

- [ ] **Step 6: Barrel export + typecheck + commit**

In `packages/console-ui/src/index.ts` add: `export { ToolCard, type ToolCardProps } from './dense/ToolCard.js';`

Run: `corepack pnpm -C packages/console-ui exec tsc -b` → exits 0 (modulo pre-existing `Transcript.tsx`).

```bash
git add packages/console-ui/src/dense/ToolCard.tsx packages/console-ui/src/dense/ToolCard.test.tsx packages/console-ui/src/dense/ToolCard.intent.ts packages/console-ui/src/index.ts
git commit -m "feat: add the rich tool card kit member"
```

---

## Task 8: Showcase wiring + docs + gate

Render the kit `ToolCard` in the showcase (path click → toast, expand → pane overlay), delete the promoted showcase specimen, add a long sample, update docs, and run the full gate.

**Files:**
- Modify: `apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx`, `apps/desktop/src/renderer/panels/showcase/toolblocks/samples.ts`
- Delete: `apps/desktop/src/renderer/panels/showcase/toolblocks/RichToolCard.tsx`
- Modify docs: `COMPONENTS.md`, `docs/UI.md`, `docs/REPO_LAYOUT.md` (add the new kit members / files; note the deletion)

**Interfaces:**
- Consumes: `ToolCard`, `PaneOverlayProvider`, `ToastProvider`, `Toast` from `@coa/console-ui`; `TOOL_CALLS` from `./toolblocks/samples.js`.

- [ ] **Step 1: Add a long sample**

In `apps/desktop/src/renderer/panels/showcase/toolblocks/samples.ts`, append a long-output call to `TOOL_CALLS` (demonstrates truncation → expand):

```ts
  {
    id: 'read-long',
    tool: 'Read',
    input: '{\n  "file_path": "src/session/session.ts",\n  "offset": 1,\n  "limit": 30\n}',
    output: Array.from({ length: 30 }, (_, i) => `  line ${i + 1} of session.ts;`).join('\n'),
    ok: true,
  },
```

- [ ] **Step 2: Rewire the showcase to the kit `ToolCard`**

In `apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx`:
- Remove the import of the local `./toolblocks/RichToolCard.js` and add `ToolCard`, `PaneOverlayProvider`, `ToastProvider`, `Toast` to the `@coa/console-ui` import.
- Replace the `RichDirection` component with one that hosts the cards in a pane overlay + toast, wiring `onOpenPath` to a toast:

```tsx
function RichDirection(): React.JSX.Element {
  const [toast, setToast] = useState<string | null>(null);
  return (
    <ToastProvider>
      <div className="h-[32rem]">
        <PaneOverlayProvider className="rounded-surface border border-hairline bg-surface">
          <div className="flex h-full flex-col gap-2 overflow-auto p-2">
            {TOOL_CALLS.map((call) => (
              <ToolCard
                key={call.id}
                tool={call.tool}
                input={call.input}
                output={call.output}
                ok={call.ok}
                onOpenPath={(p) => setToast(p)}
              />
            ))}
          </div>
        </PaneOverlayProvider>
      </div>
      <Toast
        open={toast !== null}
        onOpenChange={(o) => !o && setToast(null)}
        title="Would reveal in editor"
      >
        {toast}
      </Toast>
    </ToastProvider>
  );
}
```

Add `import { useState } from 'react';` if not already imported. Leave the compact/grouped rows unchanged (reference).

- [ ] **Step 3: Delete the promoted specimen**

```bash
git rm apps/desktop/src/renderer/panels/showcase/toolblocks/RichToolCard.tsx
```

Confirm nothing else imports it: `corepack pnpm vitest run` is not needed — grep the showcase dir; only `ChatMockups.tsx` referenced it, now updated.

- [ ] **Step 4: Typecheck + build**

Run: `corepack pnpm -C apps/desktop exec tsc -b 2>&1` → the ONLY `error TS` lines are the pre-existing `Transcript.tsx`/`ChatPanel.tsx` ones (the maintainer's live edits); your files add none.
Run: `corepack pnpm -C apps/desktop build` → succeeds.

- [ ] **Step 5: Update docs**

- `COMPONENTS.md` / `docs/UI.md`: add `ToolCard` (Dense/Viz), `PaneOverlay` (Layout), `SyntaxText` (Dense/Viz) with a one-line intent each (match the existing table/entry format in those files).
- `docs/REPO_LAYOUT.md`: note the new `console-ui` files (`syntaxTheme.ts`, `pathLanguage.ts`, `clampLines.ts`, `ToolDiffView.tsx`, `layout/PaneOverlay.tsx`, `ToolCard.tsx`) and the deleted showcase `RichToolCard.tsx`.

(Open each doc first to match its exact format; keep additions to one line per entry — no signatures/path-dumps per the repo's doc discipline.)

- [ ] **Step 6: Full gate + commit**

Run: `corepack pnpm test` → green except the 2 known unrelated `console.test.tsx` failures (the maintainer's live edits). If any OTHER test fails, it is yours — fix it.

```bash
git add apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx apps/desktop/src/renderer/panels/showcase/toolblocks/samples.ts COMPONENTS.md docs/UI.md docs/REPO_LAYOUT.md
git commit -m "feat: show the rich tool card with highlighting, path links, and expand"
```

(The `git rm` from Step 3 is staged already; if it is not in `git status`, re-run `git rm` before committing so the deletion lands in this commit.)

---

## Self-Review

**Spec coverage:**
- Syntax highlighting in code + diffs → Task 1 (`SyntaxText` + registration) + Task 5 (`ToolDiffView`) + Task 7 (previews). ✅ Registration finding (highlighting was a no-op) is handled in Task 1.
- Clickable paths → Task 4 (`toolPath`) + Task 7 (path button + `onOpenPath`) + Task 8 (toast wiring). ✅
- Max size + pane-contained expand → Task 3 (`clampLines`) + Task 6 (`PaneOverlay`) + Task 7 (clamp + Expand + overlay/inline fallback). ✅
- Promote card to kit member (intent + barrel) → Task 7; showcase consumes it, old specimen deleted → Task 8. ✅
- Invariants (D128 byte-faithful, token-only, SC-1/D85, no `dangerouslySetInnerHTML`) → tests in Tasks 1/5/7 assert verbatim text + separate gutter marker; all styling token-based. ✅
- Testing + docs + gate → Tasks 1–8; docs in Task 8 (same-commit rule). ✅
- Out of scope (live wiring, `getToolDetail`, `coa.openPath` IPC) → not built; seams (`onOpenPath`, full body via the same `output` prop) present. ✅

**Placeholder scan:** every code step has complete, runnable code; every command has an expected result. No TBD/"handle edge cases". ✅

**Type consistency:** `SyntaxTextProps`, `languageForPath`, `ClampedLines`/`clampLines(text, maxLines, opts?)`, `toolPath`, `ToolDiffViewProps { lines: DiffLine[]; language? }`, `PaneOverlayApi`/`usePaneOverlay(): PaneOverlayApi | null`, `ToolCardProps` are defined once and consumed with matching signatures in Tasks 5/7/8. `ToolDiffView` takes `lines: DiffLine[]` (not before/after) — Task 7 computes `diffLines(...).lines` and slices, consistent. Optional props/params all `T | undefined`. ✅

---

_Plan written 2026-07-05. Implements the rich tool card design (`2026-07-05-rich-tool-card-design.md`); live wiring into the transcript is a separate follow-up._
