# Tool-Block Design Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure per-tool descriptor registry (covering both Claude's native tools and coa's own governed tools) plus a token-estimate helper, then render three distinct tool-block design specimens in the desktop showcase, so the maintainer can compare them in the running app and pick one (or a hybrid) before any live wiring.

**Architecture:** Three pure, unit-tested modules land in `packages/console-ui/src/dense` — a line diff (`toolDiff.ts`), a token estimator (`tokenEstimate.ts`), and a table-driven per-tool registry (`toolRegistry.ts`, which uses the diff for `Edit`'s `+N −M` summary). All are exported from the barrel. Three showcase-local specimen components in `apps/desktop/.../showcase/toolblocks/` render the same shared sample calls three ways (compact line, grouped activity log, rich card with inline diff), each consuming the registry and showing an estimated-token readout for the call's output. Nothing is wired into the live `Transcript`/`ToolCard` — that is Phase 3, after the pick.

**Tech Stack:** TypeScript (strict) · React 19 · Tailwind (token utilities only) · lucide-react icons · Vitest (root runner) · the `@coa/console-ui` kit.

## Global Constraints

- **Registry home is now unblocked.** `packages/console-ui/src/index.ts` was off-limits because it carried uncommitted window-controls WIP. That WIP is now committed, so the barrel is clean; adding this plan's barrel export lines is sanctioned. Every other off-limits file stays untouched: `globals.css`, `App.tsx`, `console-ui/package.json`/lockfile, `Combobox.tsx`, `Composer.tsx` (has an unrelated live edit), and the window-controls files (`titlebar*`, `NavPanel`, `AppShell*`, `palette.ts`, `semantic.ts`, `zoom*`, `WindowControls*`, `preload/*`, `main/*`).
- **Stage by name, never `git add -A`.** The tree holds intentionally-untracked local files (`LOCAL.md`, `harness-system-prompt.md`) and an unrelated live edit in `Composer.tsx` — never stage any of them.
- **Commits: subject-only Conventional Commits.** No body, no `Co-Authored-By`/"Generated with" trailer, no internal IDs (module/phase numbers). One logical unit per commit. Never `--no-verify`.
- **TypeScript strict, no `any`.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax` are all on. Consequences that bite here: optional props/params MUST be typed `T | undefined` (mirror `Transcript.tsx`, e.g. `pending?: boolean | undefined`); indexed access (`arr[i]`, `rec['key']`) yields `T | undefined` and must be guarded; `import type` is required for type-only imports.
- **Kit discipline:** token utilities only (no raw hex/px; "blue" = the `info` token). No `dangerouslySetInnerHTML`. Build from kit primitives (`Code`, `cx`, lucide icons). The three specimens are gate artifacts, not kit members, so they need no intent block; the three pure modules are not components, so they need none either.
- **Invariants:** **SC-1** (the console adds no block — specimens surface, never gate). **D85** (`coa raw` stays byte-verbatim — these specimens never touch the raw path). **D128** — diffs/inputs/outputs render **byte-faithfully**: every rendered payload line is a verbatim source line; the renderer may colorize or prefix a gutter marker but MUST NOT trim, re-indent, or mutate bytes. The registry's `summary` and the token count are *derived hints* and may be clipped/approximate.
- **Commands (Windows, from repo root):**
  - Focused test: `corepack pnpm vitest run <path>` (the per-package `pnpm -C <pkg> test` script does NOT resolve here — use the root vitest).
  - Full suite: `corepack pnpm test` — **2 pre-existing failures are unrelated** (a `Combobox.tsx` portal regression from the window-controls work). Don't chase them; "green modulo those two" is green.
  - Build gate: `corepack pnpm -C apps/desktop build`. Typecheck: `corepack pnpm -C apps/desktop exec tsc -b`.

---

## Two design notes from the maintainer (bound into this plan)

1. **Tool blocks must render both families equally well** — Claude's native tools *and* coa's own governed tools. The registry therefore describes the whole surface: Claude/base tools (`Read`, `Write`, `Edit`, `NotebookEdit`, `Glob`, `Grep`, `Bash`, `TodoWrite`, `Task`, `WebSearch`, `WebFetch`) and coa's tools (`get_symbol`, `outline`, `find_references`, `get_piece`, `edit_symbol`, `apply_patch`, `run_checks`, `context_status`, `why`, `get_spec`, `get_decision`, `find_tools`, `load_tool`). `verb` is the exact tool name for both families (faithful to what the agent actually called); the maintainer can request humanized labels later. Note coa's base tools use `path` where Claude uses `file_path` — the registry accepts both.
2. **Show an estimated-token readout for each call's output** — every specimen displays `≈ N tok` for the tool's *output* (the bytes that fill the context window), driven by the pure `tokenEstimate` helper. Running/no-output calls show no count.

---

## File Structure

**Create:**
- `packages/console-ui/src/dense/toolDiff.ts` (+ `toolDiff.test.ts`) — pure LCS line diff.
- `packages/console-ui/src/dense/tokenEstimate.ts` (+ `tokenEstimate.test.ts`) — pure token estimate + formatter.
- `packages/console-ui/src/dense/toolRegistry.ts` (+ `toolRegistry.test.ts`) — pure per-tool descriptor (both families).
- `apps/desktop/src/renderer/panels/showcase/toolblocks/samples.ts` — shared `ToolCall` sample set (both families + running + failed + fallback).
- `apps/desktop/src/renderer/panels/showcase/toolblocks/CompactToolLine.tsx` — Direction 1.
- `apps/desktop/src/renderer/panels/showcase/toolblocks/GroupedActivityLog.tsx` — Direction 2.
- `apps/desktop/src/renderer/panels/showcase/toolblocks/RichToolCard.tsx` — Direction 3.

**Modify:**
- `packages/console-ui/src/index.ts` — barrel exports (registry + diff + token estimate).
- `apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx` — a "Tool blocks (design gate)" `Family` with one `Row` per direction.

---

## Task 1: Pure line diff (`toolDiff.ts`)

Byte-faithful LCS line diff. `Edit`'s registry summary needs `+N −M` counts, and Direction 3 needs per-line classification for the mini-diff — one pure helper serves both.

**Files:**
- Create: `packages/console-ui/src/dense/toolDiff.ts`
- Test: `packages/console-ui/src/dense/toolDiff.test.ts`

**Interfaces:**
- Produces:
  - `interface DiffLine { kind: 'context' | 'added' | 'removed'; text: string }`
  - `interface LineDiff { added: number; removed: number; lines: DiffLine[] }`
  - `function diffLines(before: string, after: string): LineDiff`

- [ ] **Step 1: Write the failing test**

```ts
// packages/console-ui/src/dense/toolDiff.test.ts
import { describe, expect, it } from 'vitest';
import { diffLines } from './toolDiff.js';

describe('diffLines', () => {
  it('counts a one-line replacement as +1 −1 and classifies each line', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc');
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.lines).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'context', text: 'c' },
    ]);
  });

  it('counts pure additions and pure removals', () => {
    expect(diffLines('a', 'a\nb\nc')).toMatchObject({ added: 2, removed: 0 });
    expect(diffLines('a\nb\nc', 'a')).toMatchObject({ added: 0, removed: 2 });
  });

  it('reports no change for identical input', () => {
    const d = diffLines('x\ny', 'x\ny');
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.lines.every((l) => l.kind === 'context')).toBe(true);
  });

  it('preserves bytes verbatim — leading whitespace is not normalized', () => {
    const d = diffLines('  indented', '\tindented');
    expect(d.lines.find((l) => l.kind === 'removed')?.text).toBe('  indented');
    expect(d.lines.find((l) => l.kind === 'added')?.text).toBe('\tindented');
  });

  it('handles empty strings without throwing', () => {
    expect(() => diffLines('', '')).not.toThrow();
    expect(diffLines('', 'new')).toMatchObject({ added: 1, removed: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/toolDiff.test.ts`
Expected: FAIL — `Failed to resolve import "./toolDiff.js"` / `diffLines is not a function`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/console-ui/src/dense/toolDiff.ts

/** One classified line of a diff. `text` is always a verbatim source line (D128:
 *  no trimming or normalization) — the renderer colorizes, never mutates bytes. */
export interface DiffLine {
  kind: 'context' | 'added' | 'removed';
  text: string;
}

/** A whole line-level diff: counts for a `+N −M` summary plus the classified lines. */
export interface LineDiff {
  added: number;
  removed: number;
  lines: DiffLine[];
}

/** Pure LCS line diff of two texts. Byte-faithful and total — never throws, and every
 *  emitted `text` is an exact source line. Used for the `Edit` summary counts and the
 *  rich specimen's inline diff. */
export function diffLines(before: string, after: string): LineDiff {
  const a = before.split('\n');
  const b = after.split('\n');
  const m = a.length;
  const n = b.length;

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const row = lcs[i];
      const nextRow = lcs[i + 1];
      if (row === undefined || nextRow === undefined) continue; // unreachable; satisfies strict indexing
      row[j] = a[i] === b[j] ? (nextRow[j + 1] ?? 0) + 1 : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < m && j < n) {
    const ai = a[i];
    const bj = b[j];
    if (ai === undefined || bj === undefined) break;
    if (ai === bj) {
      lines.push({ kind: 'context', text: ai });
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      lines.push({ kind: 'removed', text: ai });
      i++;
      removed++;
    } else {
      lines.push({ kind: 'added', text: bj });
      j++;
      added++;
    }
  }
  for (; i < m; i++) {
    const ai = a[i];
    if (ai === undefined) break;
    lines.push({ kind: 'removed', text: ai });
    removed++;
  }
  for (; j < n; j++) {
    const bj = b[j];
    if (bj === undefined) break;
    lines.push({ kind: 'added', text: bj });
    added++;
  }
  return { added, removed, lines };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/toolDiff.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/toolDiff.ts packages/console-ui/src/dense/toolDiff.test.ts
git commit -m "feat: add a pure line diff for tool blocks"
```

---

## Task 2: Token estimate (`tokenEstimate.ts`)

A pure, dependency-free estimate of how many tokens a chunk of text occupies, plus a compact formatter. Drives the `≈ N tok` readout on every specimen (maintainer note 2). Deliberately a heuristic (≈ 4 chars/token) — labelled `≈` at the call site so it never reads as exact.

**Files:**
- Create: `packages/console-ui/src/dense/tokenEstimate.ts`
- Test: `packages/console-ui/src/dense/tokenEstimate.test.ts`

**Interfaces:**
- Produces:
  - `function estimateTokens(text: string): number` — `Math.ceil(length / 4)`.
  - `function formatTokens(n: number): string` — `'820'`, `'1.2k'`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/console-ui/src/dense/tokenEstimate.test.ts
import { describe, expect, it } from 'vitest';
import { estimateTokens, formatTokens } from './tokenEstimate.js';

describe('estimateTokens', () => {
  it('estimates ~4 chars per token, rounding up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('scales to larger text', () => {
    expect(estimateTokens('x'.repeat(4000))).toBe(1000);
    expect(estimateTokens('x'.repeat(4001))).toBe(1001);
  });
});

describe('formatTokens', () => {
  it('prints small counts verbatim', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(820)).toBe('820');
    expect(formatTokens(999)).toBe('999');
  });

  it('prints thousands with one decimal and a k suffix', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1200)).toBe('1.2k');
    expect(formatTokens(15300)).toBe('15.3k');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/tokenEstimate.test.ts`
Expected: FAIL — cannot resolve `./tokenEstimate.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/console-ui/src/dense/tokenEstimate.ts

/** A rough token count for a chunk of text (≈ 4 chars/token, the common GPT-family
 *  heuristic). An estimate, not a tokenizer — always surfaced with a `≈` prefix so it
 *  never reads as exact. Pure; never throws. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Compact human formatting for a token count: `820`, `1.2k`, `15.3k`. */
export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/tokenEstimate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/tokenEstimate.ts packages/console-ui/src/dense/tokenEstimate.test.ts
git commit -m "feat: add a token estimate for tool output"
```

---

## Task 3: Per-tool descriptor registry (`toolRegistry.ts`)

The shared pure layer all three specimens sit on: `(tool, input, output?, ok?) → { icon, verb, summary }`, table-driven over both tool families, with a universal fallback and defensive parsing that never throws. Supersedes `toolQuickInfo` (which stays for the live `ToolCard` until Phase 3).

**Files:**
- Create: `packages/console-ui/src/dense/toolRegistry.ts`
- Test: `packages/console-ui/src/dense/toolRegistry.test.ts`
- Modify: `packages/console-ui/src/index.ts` (barrel exports)

**Interfaces:**
- Consumes: `diffLines` from Task 1.
- Produces:
  - `interface ToolDescriptor { icon: LucideIcon; verb: string; summary: string }`
  - `function describeTool(tool: string, input: string, output?: string | undefined, ok?: boolean | undefined): ToolDescriptor`
  - Barrel: `describeTool`, `type ToolDescriptor`; plus (from Tasks 1–2) `diffLines`, `type DiffLine`, `type LineDiff`, `estimateTokens`, `formatTokens`.

Design bound into the tests:
- `summary` is always a string (`''` when nothing parsed) so callers render unconditionally; clipped to 72 chars with an ellipsis (a derived hint, not byte-faithful payload).
- `verb` = the exact tool name for known tools; unknown → `{ icon: Wrench, verb: tool || 'tool', summary: '' }`.
- `output` (present and `ok !== false`) appends a compact result hint for read/search tools (`· N lines` / `· N matches` / `· N results`). A failed call shows no hint — outcome is the specimen's status glyph, not the header.

- [ ] **Step 1: Write the failing test**

```ts
// packages/console-ui/src/dense/toolRegistry.test.ts
import { Braces, FileText, Gavel, Pencil, ShieldCheck, Terminal, Wrench } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { describeTool } from './toolRegistry.js';

describe('describeTool — Claude / base tools', () => {
  it('describes Read with a path and a line range (file_path or path)', () => {
    const d = describeTool('Read', '{"file_path":"src/auth.ts","offset":1,"limit":40}');
    expect(d.icon).toBe(FileText);
    expect(d.verb).toBe('Read');
    expect(d.summary).toBe('src/auth.ts:1-41');
    // coa's base Read uses `path`, not `file_path` — still resolves.
    expect(describeTool('Read', '{"path":"a.ts"}').summary).toBe('a.ts');
  });

  it('describes Edit with a +N −M diff stat computed from old/new strings', () => {
    const d = describeTool('Edit', '{"file_path":"a.ts","old_string":"x\\ny","new_string":"x\\nY\\nz"}');
    expect(d.icon).toBe(Pencil);
    expect(d.verb).toBe('Edit');
    expect(d.summary).toBe('a.ts +2 −1');
  });

  it('describes Bash with its command', () => {
    const d = describeTool('Bash', '{"command":"npm test"}');
    expect(d.icon).toBe(Terminal);
    expect(d.summary).toBe('npm test');
  });

  it('appends a match count from output for Grep, and omits it on failure', () => {
    expect(describeTool('Grep', '{"pattern":"TODO"}', 'a.ts:1\nb.ts:9\nc.ts:3', true).summary).toBe(
      'TODO · 3 matches',
    );
    expect(describeTool('Grep', '{"pattern":"TODO"}', 'error', false).summary).toBe('TODO');
  });
});

describe('describeTool — coa governed tools', () => {
  it('describes get_symbol from a SymbolRef name', () => {
    const d = describeTool('get_symbol', '{"ref":{"name":"refreshToken"}}');
    expect(d.icon).toBe(Braces);
    expect(d.verb).toBe('get_symbol');
    expect(d.summary).toBe('refreshToken');
  });

  it('describes get_symbol from a path+symbol ref', () => {
    expect(describeTool('get_symbol', '{"ref":{"path":"src/auth.ts","symbol":"mint"}}').summary).toBe('mint');
  });

  it('describes run_checks with its scope (or "all")', () => {
    expect(describeTool('run_checks', '{"scope":"src/auth.ts"}').icon).toBe(ShieldCheck);
    expect(describeTool('run_checks', '{"scope":"src/auth.ts"}').summary).toBe('src/auth.ts');
    expect(describeTool('run_checks', '{}').summary).toBe('all');
  });

  it('describes get_decision with its number', () => {
    const d = describeTool('get_decision', '{"id":85}');
    expect(d.icon).toBe(Gavel);
    expect(d.summary).toBe('#85');
  });

  it('describes why with its target', () => {
    expect(describeTool('why', '{"target":"D85"}').summary).toBe('D85');
  });
});

describe('describeTool — fallback and robustness', () => {
  it('falls back for an unknown tool with a wrench and the tool name as the verb', () => {
    const d = describeTool('DeployRocket', '{"target":"prod"}');
    expect(d.icon).toBe(Wrench);
    expect(d.verb).toBe('DeployRocket');
    expect(d.summary).toBe('');
  });

  it('never throws on malformed input and yields an empty summary', () => {
    expect(() => describeTool('Read', 'not json')).not.toThrow();
    expect(describeTool('Read', 'not json').summary).toBe('');
    expect(describeTool('Edit', '{').summary).toBe('');
  });

  it('yields an empty summary when a known tool input lacks its expected field', () => {
    expect(describeTool('Bash', '{"foo":"bar"}').summary).toBe('');
  });

  it('clips an overly long summary to 72 chars with an ellipsis', () => {
    const d = describeTool('Bash', JSON.stringify({ command: 'x'.repeat(200) }));
    expect(d.summary.length).toBe(73); // 72 chars + the ellipsis glyph
    expect(d.summary.endsWith('…')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/toolRegistry.test.ts`
Expected: FAIL — cannot resolve `./toolRegistry.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/console-ui/src/dense/toolRegistry.ts
import {
  Bot,
  Braces,
  FileCode,
  FileDiff,
  FilePlus,
  FileText,
  FolderSearch,
  Gauge,
  Gavel,
  Globe,
  Info,
  Link,
  ListChecks,
  ListTree,
  Network,
  Notebook,
  Pencil,
  Puzzle,
  ScrollText,
  Search,
  ShieldCheck,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { diffLines } from './toolDiff.js';

/** What a tool call reduces to for a block header: an icon for the tool family, a verb
 *  (the exact tool name), and a short human target/detail. `summary` is always a string
 *  ('' when nothing parsed) so callers render it unconditionally. */
export interface ToolDescriptor {
  icon: LucideIcon;
  verb: string;
  summary: string;
}

const SUMMARY_MAX = 72;

function clip(s: string): string {
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX)}…` : s;
}

/** Defensive JSON parse to a plain record, or undefined. Never throws. */
function parseInput(input: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(input);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function str(rec: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = rec?.[key];
  return typeof v === 'string' ? v : undefined;
}
function int(rec: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = rec?.[key];
  return typeof v === 'number' ? v : undefined;
}

/** A readable name out of a SymbolRef (`{name}` | `{path, symbol?}`) or a bare string. */
function refName(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null) {
    const r = v as Record<string, unknown>;
    const name = r['name'] ?? r['symbol'] ?? r['path'];
    if (typeof name === 'string') return name;
  }
  return '';
}

/** `Read`'s target: path (Claude `file_path` or base `path`) plus an optional line range. */
function readTarget(rec: Record<string, unknown> | undefined): string {
  const path = str(rec, 'file_path') ?? str(rec, 'path');
  if (path === undefined) return '';
  const offset = int(rec, 'offset');
  const limit = int(rec, 'limit');
  const range = offset !== undefined ? `:${offset}-${limit !== undefined ? offset + limit : ''}` : '';
  return `${path}${range}`;
}

/** `Edit`'s target: path plus a `+N −M` stat from old/new strings (if both present). */
function editTarget(rec: Record<string, unknown> | undefined): string {
  const path = str(rec, 'file_path') ?? str(rec, 'path');
  if (path === undefined) return '';
  const before = str(rec, 'old_string');
  const after = str(rec, 'new_string');
  if (before === undefined || after === undefined) return path;
  const d = diffLines(before, after);
  return `${path} +${d.added} −${d.removed}`;
}

interface ToolEntry {
  icon: LucideIcon;
  /** Extract the human target/detail from parsed input; '' when absent. */
  target: (rec: Record<string, unknown> | undefined) => string;
}

/** The known-tool table: Claude/base tools + coa's governed/proxy/web tools. Verb is the
 *  map key (the exact tool name). Unknown tools fall through to the wrench fallback. */
const TOOLS: Record<string, ToolEntry> = {
  // Claude native / coa base tools (base tools reuse these names).
  Read: { icon: FileText, target: readTarget },
  Write: { icon: FilePlus, target: (r) => str(r, 'file_path') ?? str(r, 'path') ?? '' },
  Edit: { icon: Pencil, target: editTarget },
  NotebookEdit: { icon: Notebook, target: (r) => str(r, 'notebook_path') ?? str(r, 'file_path') ?? '' },
  Glob: {
    icon: FolderSearch,
    target: (r) => {
      const p = str(r, 'pattern');
      if (p === undefined) return '';
      const path = str(r, 'path');
      return path !== undefined ? `${p} in ${path}` : p;
    },
  },
  Grep: { icon: Search, target: (r) => str(r, 'pattern') ?? '' },
  Bash: { icon: Terminal, target: (r) => str(r, 'command') ?? '' },
  TodoWrite: {
    icon: ListChecks,
    target: (r) => {
      const todos = r?.['todos'];
      return Array.isArray(todos) ? `${todos.length} items` : '';
    },
  },
  Task: { icon: Bot, target: (r) => str(r, 'description') ?? str(r, 'subagent_type') ?? '' },
  WebSearch: { icon: Globe, target: (r) => str(r, 'query') ?? '' },
  WebFetch: { icon: Link, target: (r) => str(r, 'url') ?? '' },
  // coa governed tools.
  get_symbol: { icon: Braces, target: (r) => refName(r?.['ref']) },
  outline: { icon: ListTree, target: (r) => str(r, 'path') ?? '' },
  find_references: { icon: Network, target: (r) => str(r, 'symbol') ?? '' },
  get_piece: { icon: Puzzle, target: (r) => refName(r?.['ref']) },
  edit_symbol: { icon: FileCode, target: (r) => refName(r?.['ref']) },
  apply_patch: { icon: FileDiff, target: (r) => str(r, 'target') ?? '' },
  run_checks: { icon: ShieldCheck, target: (r) => str(r, 'scope') ?? 'all' },
  context_status: { icon: Gauge, target: () => '' },
  why: { icon: Info, target: (r) => str(r, 'target') ?? '' },
  get_spec: { icon: ScrollText, target: (r) => refName(r?.['ref']) },
  get_decision: {
    icon: Gavel,
    target: (r) => {
      const id = int(r, 'id');
      return id !== undefined ? `#${id}` : '';
    },
  },
  // coa on-demand proxy tools.
  find_tools: { icon: Wrench, target: (r) => str(r, 'query') ?? '' },
  load_tool: { icon: Wrench, target: (r) => str(r, 'name') ?? '' },
};

/** Non-empty line count of an output, for a result hint. */
function lineCount(output: string): number {
  return output.split('\n').filter((l) => l.trim().length > 0).length;
}

/** A compact "what came back" hint for a successful read/search. */
function resultHint(tool: string, output: string): string {
  if (output.trim().length === 0) return '';
  switch (tool) {
    case 'Read':
      return `${output.split('\n').length} lines`;
    case 'Grep':
      return `${lineCount(output)} matches`;
    case 'Glob':
      return `${lineCount(output)} results`;
    default:
      return '';
  }
}

/** Reduce a tool call to a block header descriptor. Pure and defensive: malformed input
 *  yields an empty summary rather than throwing. `output` (present, non-failed) adds a
 *  compact result hint for reads/searches; `ok` gates that hint. */
export function describeTool(
  tool: string,
  input: string,
  output?: string | undefined,
  ok?: boolean | undefined,
): ToolDescriptor {
  const rec = parseInput(input);
  const entry = TOOLS[tool];
  if (entry === undefined) return { icon: Wrench, verb: tool || 'tool', summary: '' };
  let summary = entry.target(rec);
  if (output !== undefined && ok !== false) {
    const hint = resultHint(tool, output);
    if (hint.length > 0) summary = summary.length > 0 ? `${summary} · ${hint}` : hint;
  }
  return { icon: entry.icon, verb: tool, summary: clip(summary) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/console-ui/src/dense/toolRegistry.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Add the barrel exports**

In `packages/console-ui/src/index.ts`, immediately after the `Composer` export (currently the last line), append:

```ts
export { describeTool, type ToolDescriptor } from './dense/toolRegistry.js';
export { diffLines, type DiffLine, type LineDiff } from './dense/toolDiff.js';
export { estimateTokens, formatTokens } from './dense/tokenEstimate.js';
```

- [ ] **Step 6: Verify the barrel typechecks**

Run: `corepack pnpm -C packages/console-ui exec tsc -b`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/console-ui/src/dense/toolRegistry.ts packages/console-ui/src/dense/toolRegistry.test.ts packages/console-ui/src/index.ts
git commit -m "feat: add a per-tool descriptor registry for both tool families"
```

---

## Task 4: Direction 1 — compact tool line (+ shared samples)

One line per call: caret + icon + verb + target + `≈ N tok` + status glyph; click to expand the byte-faithful input/output. Densest, most scannable. Also creates the shared sample set the other two reuse — exercising both tool families.

**Files:**
- Create: `apps/desktop/src/renderer/panels/showcase/toolblocks/samples.ts`
- Create: `apps/desktop/src/renderer/panels/showcase/toolblocks/CompactToolLine.tsx`
- Modify: `apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx`

**Interfaces:**
- Consumes: `describeTool`, `estimateTokens`, `formatTokens`, `Code`, `cx` from `@coa/console-ui`.
- Produces:
  - `interface ToolCall { id: string; tool: string; input: string; output?: string | undefined; ok?: boolean | undefined }`
  - `const TOOL_CALLS: ToolCall[]`
  - `function CompactToolLine({ call }: { call: ToolCall }): React.JSX.Element`

- [ ] **Step 1: Create the shared sample set**

`ToolCall` mirrors the live merged `tool` frame's fields, so specimens are Phase-3-portable. No `output`+`ok` ⇒ running; `ok:false` ⇒ failed. Covers both families (Claude/base + coa) plus running, failed, and an unknown fallback.

```ts
// apps/desktop/src/renderer/panels/showcase/toolblocks/samples.ts

/** A single tool call, shaped like the live merged `tool` transcript frame so the
 *  specimens are portable to Phase 3. No `output`/`ok` ⇒ still running; `ok:false` ⇒
 *  failed. Bytes in `input`/`output` are verbatim (D128). */
export interface ToolCall {
  id: string;
  tool: string;
  input: string;
  output?: string | undefined;
  ok?: boolean | undefined;
}

export const TOOL_CALLS: ToolCall[] = [
  {
    id: 'read',
    tool: 'Read',
    input: '{\n  "file_path": "src/auth.ts",\n  "offset": 1,\n  "limit": 40\n}',
    output:
      'export function refreshToken(session: Session): Promise<Token> {\n  const next = mint(session.userId);\n  return next.token;\n}',
    ok: true,
  },
  {
    id: 'edit',
    tool: 'Edit',
    input: JSON.stringify(
      {
        file_path: 'src/auth.ts',
        old_string: 'const next = mint(session.userId);\n  return next.token;',
        new_string:
          'const next = await mint(session.userId, { scope: session.scope });\n  if (!next.ok) throw new AuthError("mint failed");\n  return next.token;',
      },
      null,
      2,
    ),
    output: 'Applied 1 edit to src/auth.ts',
    ok: true,
  },
  {
    id: 'write',
    tool: 'Write',
    input: JSON.stringify(
      { file_path: 'src/auth-error.ts', content: 'export class AuthError extends Error {}\n' },
      null,
      2,
    ),
    output: 'Wrote 1 file (39 bytes)',
    ok: true,
  },
  {
    id: 'grep',
    tool: 'Grep',
    input: '{\n  "pattern": "refreshToken",\n  "glob": "*.ts"\n}',
    output: 'src/auth.ts:12\nsrc/auth.ts:31\nsrc/session.ts:88',
    ok: true,
  },
  {
    id: 'glob',
    tool: 'Glob',
    input: '{\n  "pattern": "src/**/*.test.ts"\n}',
    output: 'src/auth.test.ts\nsrc/session.test.ts',
    ok: true,
  },
  {
    id: 'get_symbol',
    tool: 'get_symbol',
    input: '{\n  "ref": { "name": "refreshToken" }\n}',
    output:
      'src/auth.ts · refreshToken(session: Session): Promise<Token>\n  mints a fresh token; the old one is single-use',
    ok: true,
  },
  {
    id: 'edit_symbol',
    tool: 'edit_symbol',
    input: JSON.stringify(
      { ref: { path: 'src/auth.ts', symbol: 'refreshToken' }, diff: { hunks: 1 } },
      null,
      2,
    ),
    output: 'applied · seq 412',
    ok: true,
  },
  {
    id: 'run_checks',
    tool: 'run_checks',
    input: '{\n  "scope": "src/auth.ts"\n}',
    output: 'typecheck ✓  lint ✓  tests ✓  — 0 flags',
    ok: true,
  },
  {
    id: 'why',
    tool: 'why',
    input: '{\n  "target": "D85"\n}',
    output:
      'D85 (strict-superset): every feature adds value or degrades to a literal pass-through; coa is never worse than the raw loop.',
    ok: true,
  },
  {
    id: 'bash-run',
    tool: 'Bash',
    input: '{\n  "command": "npm test"\n}',
    // No output/ok yet — a running call.
  },
  {
    id: 'bash-fail',
    tool: 'Bash',
    input: '{\n  "command": "npm run typecheck"\n}',
    output: 'src/auth.ts(31,5): error TS2554: Expected 1 arguments, but got 2.\n\nExit code: 2',
    ok: false,
  },
  {
    id: 'unknown',
    tool: 'DeployRocket',
    input: '{\n  "target": "prod",\n  "confirm": true\n}',
    output: 'launched 🚀',
    ok: true,
  },
];
```

- [ ] **Step 2: Build the compact line component**

```tsx
// apps/desktop/src/renderer/panels/showcase/toolblocks/CompactToolLine.tsx
import { Check, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { Code, cx, describeTool, estimateTokens, formatTokens } from '@coa/console-ui';
import type { ToolCall } from './samples.js';

/** Direction 1 — one dense line per call: caret + tool icon + verb + target + an
 *  estimated-token readout for the output + a trailing status glyph; click anywhere
 *  to expand the byte-faithful input/output. */
export function CompactToolLine({ call }: { call: ToolCall }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { icon: Icon, verb, summary } = describeTool(call.tool, call.input, call.output, call.ok);
  const running = call.output === undefined && call.ok === undefined;
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 rounded-surface px-1.5 py-1 text-left hover:bg-element motion-reduce:transition-none"
      >
        <ChevronRight
          aria-hidden
          size={12}
          className={cx(
            'shrink-0 text-faint transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <Icon aria-hidden size={14} className="shrink-0 text-muted" />
        <span className="shrink-0 text-label font-medium text-fg">{verb}</span>
        {summary.length > 0 && (
          <span className="min-w-0 truncate text-label text-muted">{summary}</span>
        )}
        {call.output !== undefined && (
          <span className="ml-auto shrink-0 pl-2 text-caption tabular-nums text-faint">
            ≈ {formatTokens(estimateTokens(call.output))} tok
          </span>
        )}
        <span className={cx('shrink-0 pl-2', call.output === undefined && 'ml-auto')}>
          <StatusGlyph running={running} ok={call.ok} />
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 py-1 pl-7">
          {call.input.length > 0 && <Code block>{call.input}</Code>}
          {call.output !== undefined && <Code block>{call.output}</Code>}
        </div>
      )}
    </div>
  );
}

function StatusGlyph({
  running,
  ok,
}: {
  running: boolean;
  ok?: boolean | undefined;
}): React.JSX.Element {
  if (running) return <span className="text-caption text-faint">running…</span>;
  if (ok === false) return <X aria-label="failed" size={13} className="text-danger" />;
  if (ok === true) return <Check aria-label="ok" size={13} className="text-success" />;
  return <></>;
}
```

- [ ] **Step 3: Wire it into the showcase**

In `ChatMockups.tsx`, add imports after `import { Family, Row } from './Specimen.js';`:

```tsx
import { CompactToolLine } from './toolblocks/CompactToolLine.js';
import { TOOL_CALLS } from './toolblocks/samples.js';
```

Add this scaffolding just above `export function ChatMockupsSection`:

```tsx
/* -------------------------------------------------------------------------- */
/* Tool blocks (design gate) — three directions over one shared sample set     */
/* spanning both Claude and coa tools.                                         */
/* -------------------------------------------------------------------------- */

/** A bordered transcript-like frame that stacks tool-block specimens. */
function ToolBlockFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-1 rounded-surface border border-hairline bg-surface p-2">
      {children}
    </div>
  );
}

function CompactDirection(): React.JSX.Element {
  return (
    <ToolBlockFrame>
      {TOOL_CALLS.map((call) => (
        <CompactToolLine key={call.id} call={call} />
      ))}
    </ToolBlockFrame>
  );
}
```

Replace the current single-`Family` return of `ChatMockupsSection` with a fragment holding both families:

```tsx
export function ChatMockupsSection(): React.JSX.Element {
  return (
    <>
      <Family name="Chat mockups (design gate)">
        <Row label="Transcript rows" align="start">
          <TranscriptSpecimens />
        </Row>
        <Row label="Composer" align="start">
          <ComposerSpecimens />
        </Row>
        <Row label="Live markdown" align="start">
          <LiveMarkdown />
        </Row>
      </Family>
      <Family name="Tool blocks (design gate)">
        <Row label="1 · Compact line" align="start">
          <CompactDirection />
        </Row>
      </Family>
    </>
  );
}
```

- [ ] **Step 4: Verify it builds and typechecks**

Run: `corepack pnpm -C apps/desktop exec tsc -b`
Expected: exits 0.
Run: `corepack pnpm -C apps/desktop build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/showcase/toolblocks/samples.ts apps/desktop/src/renderer/panels/showcase/toolblocks/CompactToolLine.tsx apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx
git commit -m "feat: show a compact tool-line design specimen"
```

---

## Task 5: Direction 2 — grouped activity log

Consecutive tool calls collapse into one "working" group; a header (`▾ Worked · N steps · ≈ N tok`) expands to the individual compact steps. Denser at rest, closer to Cursor's agent log. Reuses `CompactToolLine` for each expanded step, so the two directions stay consistent where they overlap.

**Files:**
- Create: `apps/desktop/src/renderer/panels/showcase/toolblocks/GroupedActivityLog.tsx`
- Modify: `apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx`

**Interfaces:**
- Consumes: `TOOL_CALLS`/`ToolCall` + `CompactToolLine` from Task 4; `describeTool`, `estimateTokens`, `formatTokens`, `cx` from `@coa/console-ui`.
- Produces: `function GroupedActivityLog({ calls }: { calls: ToolCall[] }): React.JSX.Element`

- [ ] **Step 1: Build the grouped log component**

```tsx
// apps/desktop/src/renderer/panels/showcase/toolblocks/GroupedActivityLog.tsx
import { ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { cx, describeTool, estimateTokens, formatTokens } from '@coa/console-ui';
import { CompactToolLine } from './CompactToolLine.js';
import type { ToolCall } from './samples.js';

/** Direction 2 — a run of tool calls collapsed into one "working" group. Collapsed, it
 *  reads as a single line with the verbs touched and the group's total output tokens;
 *  expanded, it lists each step as a CompactToolLine. A still-running call keeps it live. */
export function GroupedActivityLog({ calls }: { calls: ToolCall[] }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const running = calls.some((c) => c.output === undefined && c.ok === undefined);
  const failed = calls.some((c) => c.ok === false);
  const totalTokens = calls.reduce((sum, c) => sum + (c.output !== undefined ? estimateTokens(c.output) : 0), 0);
  const peek = dedupe(calls.map((c) => describeTool(c.tool, c.input).verb)).slice(0, 4).join(' · ');
  return (
    <div className="min-w-0 rounded-surface border border-hairline bg-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left hover:bg-element motion-reduce:transition-none"
      >
        <ChevronRight
          aria-hidden
          size={12}
          className={cx(
            'shrink-0 text-faint transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        {running ? (
          <Loader2 aria-hidden size={13} className="shrink-0 animate-spin text-info motion-reduce:animate-none" />
        ) : (
          <span aria-hidden className={cx('size-2 shrink-0 rounded-full', failed ? 'bg-danger' : 'bg-success')} />
        )}
        <span className="shrink-0 text-label font-medium text-fg">{running ? 'Working' : 'Worked'}</span>
        <span className="shrink-0 text-caption text-faint">
          {calls.length} {calls.length === 1 ? 'step' : 'steps'}
        </span>
        {!open && peek.length > 0 && (
          <span className="min-w-0 truncate text-caption text-muted">{peek}</span>
        )}
        {totalTokens > 0 && (
          <span className="ml-auto shrink-0 pl-2 text-caption tabular-nums text-faint">
            ≈ {formatTokens(totalTokens)} tok
          </span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 border-t border-hairline px-1 py-1">
          {calls.map((call) => (
            <CompactToolLine key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
```

- [ ] **Step 2: Wire it into the showcase**

In `ChatMockups.tsx`, add the import beside the Task 4 imports:

```tsx
import { GroupedActivityLog } from './toolblocks/GroupedActivityLog.js';
```

Add a direction component beside `CompactDirection`:

```tsx
function GroupedDirection(): React.JSX.Element {
  return (
    <ToolBlockFrame>
      <GroupedActivityLog calls={TOOL_CALLS} />
    </ToolBlockFrame>
  );
}
```

Add a second `Row` inside the "Tool blocks (design gate)" `Family`, after the compact row:

```tsx
        <Row label="2 · Grouped log" align="start">
          <GroupedDirection />
        </Row>
```

- [ ] **Step 3: Verify it builds and typechecks**

Run: `corepack pnpm -C apps/desktop exec tsc -b`
Expected: exits 0.
Run: `corepack pnpm -C apps/desktop build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/panels/showcase/toolblocks/GroupedActivityLog.tsx apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx
git commit -m "feat: show a grouped tool activity-log specimen"
```

---

## Task 6: Direction 3 — rich card with inline diff

The heaviest, most informative direction. Each call is a titled card: edits/writes lead with a byte-faithful mini-diff, reads/searches show a result preview, commands show an output tail; the header carries the `≈ N tok` output readout. Running shows a spinner; failed tints its result danger.

**Files:**
- Create: `apps/desktop/src/renderer/panels/showcase/toolblocks/RichToolCard.tsx`
- Modify: `apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx`

**Interfaces:**
- Consumes: `TOOL_CALLS`/`ToolCall` from Task 4; `describeTool`, `diffLines`, `estimateTokens`, `formatTokens`, `type DiffLine`, `cx` from `@coa/console-ui`.
- Produces: `function RichToolCard({ call }: { call: ToolCall }): React.JSX.Element`

Body-selection rules:
- `Edit`/`edit_symbol`/`Write` with parseable `old_string`+`new_string` → inline byte-faithful diff. `Write` with only `content` → an all-added block.
- `Bash` → output tail (last ~6 lines). Everything else with output → result preview (first ~6 lines).
- Running (no output) → a spinner row. Failed → the preview tinted danger.

- [ ] **Step 1: Build the rich card component**

```tsx
// apps/desktop/src/renderer/panels/showcase/toolblocks/RichToolCard.tsx
import { Check, Loader2, X } from 'lucide-react';
import {
  cx,
  describeTool,
  diffLines,
  estimateTokens,
  formatTokens,
  type DiffLine,
} from '@coa/console-ui';
import type { ToolCall } from './samples.js';

const PREVIEW_LINES = 6;

/** Direction 3 — a titled card that leads with the most informative body for the tool:
 *  a byte-faithful diff for edits/writes, a result preview for reads/searches, an output
 *  tail for commands. The header shows the estimated output tokens. */
export function RichToolCard({ call }: { call: ToolCall }): React.JSX.Element {
  const { icon: Icon, verb, summary } = describeTool(call.tool, call.input, call.output, call.ok);
  const running = call.output === undefined && call.ok === undefined;
  return (
    <div className="overflow-hidden rounded-surface border border-hairline bg-subtle">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Icon aria-hidden size={14} className="shrink-0 text-muted" />
        <span className="shrink-0 text-label font-medium text-fg">{verb}</span>
        {summary.length > 0 && (
          <span className="min-w-0 truncate text-label text-muted">{summary}</span>
        )}
        {call.output !== undefined && (
          <span className="ml-auto shrink-0 pl-2 text-caption tabular-nums text-faint">
            ≈ {formatTokens(estimateTokens(call.output))} tok
          </span>
        )}
        <span className={cx('shrink-0 pl-2', call.output === undefined && 'ml-auto')}>
          {running ? (
            <Loader2 aria-hidden size={13} className="animate-spin text-info motion-reduce:animate-none" />
          ) : call.ok === false ? (
            <X aria-label="failed" size={13} className="text-danger" />
          ) : (
            <Check aria-label="ok" size={13} className="text-success" />
          )}
        </span>
      </div>
      <RichBody call={call} running={running} />
    </div>
  );
}

function RichBody({ call, running }: { call: ToolCall; running: boolean }): React.JSX.Element {
  if (running) {
    return <div className="border-t border-hairline px-2.5 py-2 text-caption text-faint">running…</div>;
  }
  const diff = editDiff(call);
  if (diff !== undefined) return <DiffView lines={diff} />;
  if (call.output === undefined || call.output.length === 0) return <></>;
  const isTail = call.tool === 'Bash';
  const lines = call.output.split('\n');
  const shown = isTail ? lines.slice(-PREVIEW_LINES) : lines.slice(0, PREVIEW_LINES);
  const clipped = lines.length > PREVIEW_LINES;
  return (
    <div className="border-t border-hairline">
      <pre
        className={cx(
          'overflow-x-auto whitespace-pre px-2.5 py-2 font-mono text-label leading-[1.55]',
          call.ok === false ? 'text-danger-text' : 'text-muted',
        )}
      >
        {shown.join('\n')}
      </pre>
      {clipped && (
        <div className="px-2.5 pb-1.5 text-caption text-faint">
          {isTail
            ? `… ${lines.length - PREVIEW_LINES} earlier lines`
            : `… ${lines.length - PREVIEW_LINES} more lines`}
        </div>
      )}
    </div>
  );
}

/** The inline diff for an edit, or undefined when the call is not a diff-able edit.
 *  Byte-faithful: lines come straight from `diffLines`. */
function editDiff(call: ToolCall): DiffLine[] | undefined {
  let rec: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(call.input);
    if (typeof v !== 'object' || v === null) return undefined;
    rec = v as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const before = rec['old_string'];
  const after = rec['new_string'];
  if (typeof before === 'string' && typeof after === 'string') {
    return diffLines(before, after).lines;
  }
  if (call.tool === 'Write' && typeof rec['content'] === 'string') {
    return diffLines('', rec['content']).lines;
  }
  return undefined;
}

function DiffView({ lines }: { lines: DiffLine[] }): React.JSX.Element {
  return (
    <div className="overflow-x-auto border-t border-hairline">
      <pre className="w-full font-mono text-label leading-[1.55]">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cx(
              'whitespace-pre px-2.5',
              line.kind === 'added' && 'bg-success-tint text-success-text',
              line.kind === 'removed' && 'bg-danger-tint text-danger-text',
              line.kind === 'context' && 'text-muted',
            )}
          >
            {`${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '} ${line.text}`}
          </div>
        ))}
      </pre>
    </div>
  );
}
```

Byte-faithfulness (D128): the `+`/`-`/` ` gutter marker is a rendering prefix, not a mutation — `line.text` is emitted verbatim after it.

- [ ] **Step 2: Wire it into the showcase**

In `ChatMockups.tsx`, add the import beside the earlier tool-block imports:

```tsx
import { RichToolCard } from './toolblocks/RichToolCard.js';
```

Add the direction component beside the others:

```tsx
function RichDirection(): React.JSX.Element {
  return (
    <ToolBlockFrame>
      {TOOL_CALLS.map((call) => (
        <RichToolCard key={call.id} call={call} />
      ))}
    </ToolBlockFrame>
  );
}
```

Add a third `Row` inside the "Tool blocks (design gate)" `Family`, after the grouped row:

```tsx
        <Row label="3 · Rich card" align="start">
          <RichDirection />
        </Row>
```

- [ ] **Step 3: Verify it builds and typechecks**

Run: `corepack pnpm -C apps/desktop exec tsc -b`
Expected: exits 0.
Run: `corepack pnpm -C apps/desktop build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/panels/showcase/toolblocks/RichToolCard.tsx apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx
git commit -m "feat: show a rich tool card with inline diff specimen"
```

---

## Task 7: Full-suite gate + maintainer decision summary

The DoD gate: prove the whole suite and build are green (modulo the two known Combobox failures), then present the three directions and ask the maintainer to pick. No live wiring.

**Files:** none created/modified (verification + handoff only).

- [ ] **Step 1: Run the full suite**

Run: `corepack pnpm test`
Expected: green **except** the 2 pre-existing `Combobox.tsx` failures (Global Constraints). If any OTHER test fails, it is yours — fix it. Confirm the two are the Combobox portal ones (e.g. `corepack pnpm vitest run Combobox`) so you are not masking a new regression.

- [ ] **Step 2: Run the build + typecheck gate**

Run: `corepack pnpm -C apps/desktop exec tsc -b`  → exits 0.
Run: `corepack pnpm -C apps/desktop build`  → build succeeds.

- [ ] **Step 3: (Optional) live review**

Run: `corepack pnpm -C apps/desktop dev`, open the showcase panel, and eyeball the "Tool blocks (design gate)" family. Electron `dev` may not boot in a sandbox — if so, note it and rely on build + unit tests; the maintainer runs it for the visual pick.

- [ ] **Step 4: Write the maintainer summary**

Post a short summary (no commit) that:
- Presents the three directions with trade-offs (compact = densest/most scannable; grouped = quietest at rest, Cursor-like; rich = most informative, diff-forward), noting each renders both Claude and coa tools and shows the `≈ tok` output readout.
- Gives your **designer recommendation** with a one-line rationale.
- Explicitly asks the maintainer to **pick one or a hybrid**.
- States that Phase 3 (replacing the live `ToolCard`, wiring through `foldToolFrames`/`TranscriptRow`, and the deferred `getToolDetail` for byte-faithful expand) is a **separate plan**, not started here.

---

## Self-Review

**Spec + maintainer-note coverage:**
- Pure per-tool registry in `console-ui`, unit-tested, both families (Claude/base + coa governed/proxy/web) with a universal fallback and never-throw parse → Task 3 (+ Task 1 diff it depends on). ✅ (Maintainer note 1.)
- Estimated-token readout for each call's output on every specimen → Task 2 helper + display in Tasks 4/5/6. ✅ (Maintainer note 2.)
- Three directions as real specimens exercising both families + running + failed + fallback → Tasks 4/5/6 over the shared `TOOL_CALLS`. ✅
- TodoWrite stays a `plan` frame, not a tool card → registry *describes* it, but no `TOOL_CALLS` entry renders one. ✅
- Suite green + build + `tsc` clean → Task 7. ✅
- Raw floor / SC-1 / D128 → specimens never touch the raw path or add blocks; diffs/inputs/outputs render byte-faithfully (gutter markers presentational; summary/tokens are labelled derived hints). ✅
- Gate discipline: no live `ToolCard` change; Phase 3 explicitly deferred. ✅

**Placeholder scan:** every code step is complete and runnable; every command has an expected result. No TBD/"handle edge cases". ✅

**Type consistency:** `ToolCall` (Task 4) is reused verbatim in Tasks 5/6. `ToolDescriptor`/`describeTool`, `DiffLine`/`diffLines`, and `estimateTokens`/`formatTokens` signatures match between definition and every consumer. Optional props/params typed `T | undefined` per strict flags. ✅

---

_Plan written 2026-07-04. Executes Phase 2 of the chat professionalization design (§5.3) plus two maintainer notes (both tool families; per-call token estimate), on `main` after the window-controls WIP was committed._
