# Pure-API Base Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the pure-API (DeepSeek) backend real, governed base tools — `Read`, `Glob`, `Grep`, `Write`, `Edit`, `Bash` — so its loop can read, search, edit, and run inside the session worktree.

**Architecture:** A new neutral handler module `packages/core/src/workbench/base-tools.ts` holds six pure handlers over an injected `BaseToolDeps` port (same discipline as `retrieve.ts`/`mutate.ts`). Read/Glob/Grep/Write/Edit route every path through the existing S-1 `confinePath`; Write/Edit funnel through the M1 `emit` spine exactly like `mutate.ts`; Bash runs `cwd = worktreeRoot` with no path confinement (authorized). `buildGovernedTools` gains an `{ includeBaseTools }` gate so the composition root builds two catalogues — governance-only for Claude, governance+base for pure-API — and `session.ts` selects by provider.

**Tech Stack:** TypeScript (strict, no `any`) · Zod · Vitest · `@vscode/ripgrep` (Grep) · `tinyglobby` (Glob) · node `child_process` (Bash) · `ulid`.

## Global Constraints

- **TypeScript `strict`, no `any`** — every value typed.
- **SC-1:** every `invoke`/handler **never throws, never denies** — malformed args, confinement rejections, and spawn failures return as *unapplied* `ToolResponse` results.
- **Determinism-first (P1):** no model call on any path here. `spawnSync`/`globSync` are deterministic.
- **P7 mutation chokepoint:** Write/Edit emit exactly one `ChangeEventDraft` via `deps.emit`; never write disk + graph independently.
- **S-1 confinement:** every fs path (Read/Glob/Grep/Write/Edit) routes through `confinePath` before touching disk.
- **Handlers stay synchronous** — `RegisteredTool.invoke` accepts `ToolResponse | Promise<ToolResponse>`; use node **sync** APIs (`spawnSync`, `tinyglobby.globSync`, `fs.*Sync`) so handlers return `ToolResponse` directly, matching the existing retrieve/mutate handlers.
- **Commits:** subject-only Conventional Commits, no body, no trailer, no internal identifiers (no "M6"/"DC-5"/phase numbers). Stage files by name.
- **Tests are the default proof.** No live DeepSeek call without the maintainer's say-so.
- **Worktree:** all work happens in `c:/Users/Zander/Documents/Side Projects/coa-core-context` on branch `core-context-roles`.

---

## File Structure

- **Create** `packages/core/src/workbench/base-tools.ts` — the six handlers, `BaseToolDeps`, `BASE_TOOL_CATALOGUE`, `baseToolSpecs()`, and shared helpers (`confine`, `numberLines`, `applyReplace`).
- **Create** `packages/core/src/workbench/base-tools.test.ts` — per-handler unit tests.
- **Modify** `packages/core/src/workbench/catalogue.ts` — add the optional `group` field to `ToolManifestEntry`.
- **Modify** `packages/core/src/workbench/governed-tools.ts` — `GovernedToolDeps.base?`, `buildGovernedTools(deps, opts?)` with `includeBaseTools`.
- **Modify** `packages/core/src/workbench/governed-tools.test.ts` — the catalogue-gate test.
- **Modify** `packages/core/src/session/daemon.ts` — `baseToolDeps(root)` real ports (fs/ripgrep/tinyglobby/child_process) + `core.baseCatalogue`.
- **Modify** `packages/core/src/session/composition.ts` — `DaemonCore.baseCatalogue` + `SessionDeps.baseCatalogue` mapping.
- **Modify** `packages/core/src/session/session.ts` — `SessionDeps.baseCatalogue` + provider-selected `registerTools`.
- **Modify** `packages/core/src/session/session.test.ts` — provider-selection test.
- **Modify** `packages/core/package.json` — add `@vscode/ripgrep`, `tinyglobby`.
- **Modify** `packages/core/src/index.ts` — export the new public types if the package surface needs them (check existing exports first).

---

## Task 1: Read / Glob / Grep handlers (reads, no spine)

**Files:**
- Create: `packages/core/src/workbench/base-tools.ts`
- Test: `packages/core/src/workbench/base-tools.test.ts`

**Interfaces:**
- Consumes: `confinePath` + `ConfineResult` from `./confine.js`; `ToolResponse`, `CoaError` from `@coa/shared`.
- Produces:
  - `interface BaseToolDeps` (this task defines the read subset; Tasks 2–3 extend it).
  - `readFileTool(req, deps) -> ToolResponse<ReadResult>`
  - `glob(req, deps) -> ToolResponse<GlobResult>`
  - `grep(req, deps) -> ToolResponse<GrepResult>`
  - `ReadResult = { found: boolean; content?: string; reason?: string }`
  - `GlobResult = { matches: readonly string[] }`
  - `GrepHit = { file: string; line?: number; text?: string }`; `GrepResult = { hits: readonly GrepHit[] }`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/workbench/base-tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileTool, glob, grep, type BaseToolDeps } from './base-tools.js';

/** A read-only fake: an in-memory worktree at /repo. */
function readDeps(files: Record<string, string>): BaseToolDeps {
  const abs = (rel: string): string => `/repo/${rel}`;
  return {
    worktreeRoot: '/repo',
    worktree: 'main',
    readFile: (a) => {
      const rel = a.replace('/repo/', '');
      const body = files[rel];
      if (body === undefined) throw new Error(`no such file: ${a}`);
      return body;
    },
    writeFile: () => {},
    fileExists: (a) => files[a.replace('/repo/', '')] !== undefined,
    listFiles: (pattern) =>
      Object.keys(files)
        .filter((rel) => (pattern === '**/*' ? true : rel.endsWith(pattern.replace('*', ''))))
        .map(abs),
    searchFiles: ({ pattern }) =>
      Object.entries(files)
        .filter(([, body]) => body.includes(pattern))
        .map(([rel]) => ({ file: abs(rel), line: 1, text: pattern })),
    exec: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    emit: () => 0,
  };
}

describe('readFileTool', () => {
  it('returns numbered file content for a confined path', () => {
    const res = readFileTool({ path: 'src/a.ts' }, readDeps({ 'src/a.ts': 'a\nb\n' }));
    expect(res.result).toEqual({ found: true, content: '1\ta\n2\tb' });
  });

  it('rejects a path that escapes the worktree without throwing', () => {
    const res = readFileTool({ path: '../secrets' }, readDeps({}));
    expect(res.result.found).toBe(false);
    expect(res.result.reason).toBe('path-escape');
  });

  it('returns a miss (not a throw) for a missing file', () => {
    const res = readFileTool({ path: 'nope.ts' }, readDeps({}));
    expect(res.result).toEqual({ found: false, reason: 'not-found' });
  });

  it('applies offset and limit', () => {
    const res = readFileTool(
      { path: 'a', offset: 2, limit: 1 },
      readDeps({ a: 'one\ntwo\nthree\n' }),
    );
    expect(res.result.content).toBe('2\ttwo');
  });
});

describe('glob', () => {
  it('returns worktree-relative matches', () => {
    const res = glob({ pattern: '**/*' }, readDeps({ 'src/a.ts': '', 'b.ts': '' }));
    expect([...res.result.matches].sort()).toEqual(['b.ts', 'src/a.ts']);
  });

  it('rejects an escaping base path with empty matches', () => {
    const res = glob({ pattern: '*', path: '../..' }, readDeps({}));
    expect(res.result.matches).toEqual([]);
  });
});

describe('grep', () => {
  it('returns hits with worktree-relative files', () => {
    const res = grep({ pattern: 'needle' }, readDeps({ 'a.ts': 'has needle', 'b.ts': 'no' }));
    expect(res.result.hits).toEqual([{ file: 'a.ts', line: 1, text: 'needle' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/workbench/base-tools.test.ts`
Expected: FAIL — `Cannot find module './base-tools.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/workbench/base-tools.ts`:

```ts
import path from 'node:path';
import type { CoaError, ToolResponse } from '@coa/shared';
import type { ChangeEventDraft } from '../event.js';
import { confinePath, type ConfineResult } from './confine.js';

/**
 * The pure-API base tools (Read/Glob/Grep/Write/Edit/Bash). These are the
 * executors coa supplies only on the pure-API path — Claude gets equivalents
 * free from the SDK built-ins. Read/Glob/Grep/Write/Edit are in-process MCP
 * tools, so each confines its path through the S-1 `confinePath` precondition
 * before touching disk; Write/Edit funnel through the M1 `emit` spine (P7). Every
 * handler obeys SC-1: it never throws and never denies — a bad path or a spawn
 * failure comes back as an unapplied result the agent can retry.
 */
export interface BaseToolDeps {
  /** The session worktree root — a POSIX absolute path (S-1 confinement base). */
  worktreeRoot: string;
  /** The worktree name stamped on emitted change-events. */
  worktree: string;
  /** Forbidden-within-worktree globs (S-1); defaults applied by `confinePath`. */
  denyRead?: readonly string[];
  /** Symlink resolver for confinement, injected for testability. */
  realpath?: (absolutePath: string) => string;
  /** Read a file's bytes by absolute path (throws when absent — handlers catch). */
  readFile: (absolutePath: string) => string;
  /** Write a file's new bytes by absolute path. */
  writeFile: (absolutePath: string, bytes: string) => void;
  /** Whether a file exists at an absolute path (Write: create vs modify). */
  fileExists: (absolutePath: string) => boolean;
  /** Glob under a confined base; returns absolute paths. */
  listFiles: (pattern: string, baseAbsolute: string) => readonly string[];
  /** Search file contents under a confined base (ripgrep). */
  searchFiles: (req: SearchRequest) => readonly GrepHit[];
  /** Run a shell command; never throws (spawn errors come back as a non-zero exit). */
  exec: (command: string, opts: ExecOptions) => ExecResult;
  /** The single M1 append path (P7); returns the authoritative seq. */
  emit: (draft: ChangeEventDraft) => number;
  /** Refresh M1's derived projections from new bytes (local, not WAL'd). */
  reindex?: (relPath: string, bytes: string) => void;
  /** Register the precise write with producer ② so its disk observation dedups to a confirm. */
  expectPrecise?: (relPath: string) => void;
}

export interface SearchRequest {
  pattern: string;
  baseAbsolute: string;
  glob?: string;
  mode: 'content' | 'files';
}
export interface ExecOptions {
  cwd: string;
  timeoutMs?: number;
}
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ReadResult = { found: boolean; content?: string; reason?: string };
export type GlobResult = { matches: readonly string[] };
export type GrepHit = { file: string; line?: number; text?: string };
export type GrepResult = { hits: readonly GrepHit[] };

/** `Read` — confined file read, returned as `cat -n`-style numbered lines. */
export function readFileTool(
  req: { path: string; offset?: number; limit?: number },
  deps: BaseToolDeps,
): ToolResponse<ReadResult> {
  const confined = confine(req.path, deps);
  if (!confined.ok) return wrap({ found: false, reason: confined.error.code }, 'read:rejected', req.path);
  let text: string;
  try {
    text = deps.readFile(confined.path);
  } catch {
    return wrap({ found: false, reason: 'not-found' }, 'read:miss', req.path);
  }
  return wrap({ found: true, content: numberLines(text, req.offset, req.limit) }, `read:${req.path}`, req.path);
}

/** `Glob` — confined glob; returns worktree-relative matches. */
export function glob(req: { pattern: string; path?: string }, deps: BaseToolDeps): ToolResponse<GlobResult> {
  const base = req.path ?? '.';
  const confined = confine(base, deps);
  if (!confined.ok) return wrap({ matches: [] }, 'glob:rejected', base);
  const matches = deps.listFiles(req.pattern, confined.path).map((abs) => toRel(deps.worktreeRoot, abs));
  return wrap({ matches }, `glob:${req.pattern}`, req.pattern);
}

/** `Grep` — confined ripgrep search; returns worktree-relative hits. */
export function grep(
  req: { pattern: string; path?: string; glob?: string; output_mode?: 'content' | 'files_with_matches' },
  deps: BaseToolDeps,
): ToolResponse<GrepResult> {
  const base = req.path ?? '.';
  const confined = confine(base, deps);
  if (!confined.ok) return wrap({ hits: [] }, 'grep:rejected', base);
  const hits = deps
    .searchFiles({
      pattern: req.pattern,
      baseAbsolute: confined.path,
      ...(req.glob ? { glob: req.glob } : {}),
      mode: req.output_mode === 'files_with_matches' ? 'files' : 'content',
    })
    .map((hit) => ({ ...hit, file: toRel(deps.worktreeRoot, hit.file) }));
  return wrap({ hits }, `grep:${req.pattern}`, req.pattern);
}

// --- shared helpers (Tasks 2–3 add write/edit/bash + their specs below) ---

/** Confine a worktree-relative path through the S-1 precondition. */
export function confine(rel: string, deps: BaseToolDeps): ConfineResult {
  return confinePath(rel, {
    worktreeRoot: deps.worktreeRoot,
    ...(deps.denyRead ? { denyRead: deps.denyRead } : {}),
    ...(deps.realpath ? { realpath: deps.realpath } : {}),
  });
}

/** An absolute path made worktree-relative (POSIX). */
export function toRel(root: string, absolute: string): string {
  return path.posix.relative(root, absolute);
}

/** `cat -n`-style numbering with an optional 1-based `offset` start line and `limit`. */
export function numberLines(text: string, offset?: number, limit?: number): string {
  const lines = text.split('\n');
  // A trailing newline yields a final empty element; drop it so counts match `wc -l + 1`.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const start = offset && offset > 0 ? offset - 1 : 0;
  const end = limit && limit > 0 ? start + limit : lines.length;
  return lines
    .slice(start, end)
    .map((line, i) => `${start + i + 1}\t${line}`)
    .join('\n');
}

/** Build a distilled-handle tool return (grounding/flags are added by the enrich decorator). */
export function wrap<R>(result: R, handle: string, pointer: string): ToolResponse<R> {
  return { result, handle, pointer };
}

/** A rejected write/edit return (unapplied + typed reason). */
export function fail(error: CoaError): ToolResponse<WriteResult> {
  return { result: { applied: false, error }, handle: 'base:rejected', pointer: error.code };
}

/** Placeholder — Task 2 defines the real WriteResult. */
export type WriteResult = { applied: false; error: CoaError };
```

> Note: `WriteResult` and `fail` are declared here so the read handlers compile; Task 2 replaces the `WriteResult` placeholder with the full union and adds the write/edit handlers.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/workbench/base-tools.test.ts`
Expected: PASS (all read/glob/grep cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/base-tools.ts packages/core/src/workbench/base-tools.test.ts
git commit -m "feat: add confined read, glob, and grep executors"
```

---

## Task 2: Write / Edit handlers (through the emit spine)

**Files:**
- Modify: `packages/core/src/workbench/base-tools.ts`
- Test: `packages/core/src/workbench/base-tools.test.ts`

**Interfaces:**
- Consumes: `BaseToolDeps`, `confine`, `fail`, `wrap` from Task 1; `ChangeEventDraft` from `../event.js`; `createHash` (node), `ulid`.
- Produces:
  - `WriteResult = { applied: true; path: string; seq: number; created: boolean } | { applied: false; error: CoaError }`
  - `write(req, deps) -> ToolResponse<WriteResult>` where `req = { path: string; content: string }`
  - `edit(req, deps) -> ToolResponse<WriteResult>` where `req = { path: string; old_string: string; new_string: string; replace_all?: boolean }`
  - `applyReplace(source, oldStr, newStr, replaceAll) -> { ok: true; bytes: string } | { ok: false; error: CoaError }`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/workbench/base-tools.test.ts`:

```ts
import { createHash } from 'node:crypto';
import type { ChangeEventDraft } from '../event.js';
import { write, edit } from './base-tools.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** A read/write fake that records emitted change-events. */
function rwDeps(files: Record<string, string>): {
  deps: BaseToolDeps;
  written: Record<string, string>;
  emitted: ChangeEventDraft[];
} {
  const written: Record<string, string> = {};
  const emitted: ChangeEventDraft[] = [];
  let seq = 0;
  const base = readDeps(files);
  const deps: BaseToolDeps = {
    ...base,
    writeFile: (a, b) => {
      written[a.replace('/repo/', '')] = b;
    },
    emit: (draft) => {
      emitted.push(draft);
      return seq++;
    },
  };
  return { deps, written, emitted };
}

describe('write', () => {
  it('creates a new file and emits a create change-event', () => {
    const { deps, written, emitted } = rwDeps({});
    const res = write({ path: 'new.ts', content: 'hello\n' }, deps);
    expect(res.result).toEqual({ applied: true, path: 'new.ts', seq: 0, created: true });
    expect(written['new.ts']).toBe('hello\n');
    expect(emitted[0]).toMatchObject({ kind: 'create', path: 'new.ts', pre_hash: null, post_hash: sha256('hello\n') });
  });

  it('overwrites an existing file and emits a modify change-event', () => {
    const { deps, emitted } = rwDeps({ 'a.ts': 'old\n' });
    const res = write({ path: 'a.ts', content: 'new\n' }, deps);
    expect(res.result).toMatchObject({ applied: true, created: false });
    expect(emitted[0]).toMatchObject({ kind: 'modify', pre_hash: sha256('old\n'), post_hash: sha256('new\n') });
  });

  it('rejects an escaping path without throwing', () => {
    const { deps } = rwDeps({});
    const res = write({ path: '../x', content: 'y' }, deps);
    expect(res.result).toEqual({ applied: false, error: { code: 'path-escape', message: expect.any(String) } });
  });
});

describe('edit', () => {
  it('applies a unique replacement and emits a modify event', () => {
    const { deps, written, emitted } = rwDeps({ 'a.ts': 'const x = 1;\n' });
    const res = edit({ path: 'a.ts', old_string: '1', new_string: '2' }, deps);
    expect(res.result).toMatchObject({ applied: true, path: 'a.ts' });
    expect(written['a.ts']).toBe('const x = 2;\n');
    expect(emitted).toHaveLength(1);
  });

  it('returns an unapplied result when old_string is not found', () => {
    const { deps } = rwDeps({ 'a.ts': 'abc' });
    const res = edit({ path: 'a.ts', old_string: 'zzz', new_string: 'y' }, deps);
    expect(res.result).toEqual({ applied: false, error: { code: 'edit-no-match', message: expect.any(String) } });
  });

  it('returns an unapplied result when old_string is ambiguous and replace_all is false', () => {
    const { deps } = rwDeps({ 'a.ts': 'x x' });
    const res = edit({ path: 'a.ts', old_string: 'x', new_string: 'y' }, deps);
    expect(res.result).toMatchObject({ applied: false, error: { code: 'edit-ambiguous' } });
  });

  it('replaces every occurrence when replace_all is true', () => {
    const { deps, written } = rwDeps({ 'a.ts': 'x x' });
    const res = edit({ path: 'a.ts', old_string: 'x', new_string: 'y', replace_all: true }, deps);
    expect(res.result).toMatchObject({ applied: true });
    expect(written['a.ts']).toBe('y y');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/workbench/base-tools.test.ts`
Expected: FAIL — `write`/`edit` not exported, and the placeholder `WriteResult` type mismatch.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/workbench/base-tools.ts`, add the imports at the top:

```ts
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
```

Replace the placeholder `WriteResult` type and the `fail` helper's usage by replacing:

```ts
/** Placeholder — Task 2 defines the real WriteResult. */
export type WriteResult = { applied: false; error: CoaError };
```

with:

```ts
export type WriteResult =
  | { applied: true; path: string; seq: number; created: boolean }
  | { applied: false; error: CoaError };

const sha256 = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');

/** `Write` — confined whole-file create/overwrite, emitted through the M1 spine (P7). */
export function write(req: { path: string; content: string }, deps: BaseToolDeps): ToolResponse<WriteResult> {
  const confined = confine(req.path, deps);
  if (!confined.ok) return fail(confined.error);
  const existed = deps.fileExists(confined.path);
  const source = existed ? deps.readFile(confined.path) : '';
  deps.writeFile(confined.path, req.content);
  const seq = emitFileChange(req.path, existed ? 'modify' : 'create', existed ? source : null, req.content, deps);
  return {
    result: { applied: true, path: req.path, seq, created: !existed },
    handle: `write:${req.path}@${seq}`,
    pointer: req.path,
  };
}

/** `Edit` — confined string-replacement edit, emitted through the M1 spine (P7). */
export function edit(
  req: { path: string; old_string: string; new_string: string; replace_all?: boolean },
  deps: BaseToolDeps,
): ToolResponse<WriteResult> {
  const confined = confine(req.path, deps);
  if (!confined.ok) return fail(confined.error);
  let source: string;
  try {
    source = deps.readFile(confined.path);
  } catch {
    return fail({ code: 'not-found', message: `no such file: ${req.path}` });
  }
  const applied = applyReplace(source, req.old_string, req.new_string, req.replace_all ?? false);
  if (!applied.ok) return fail(applied.error);
  deps.writeFile(confined.path, applied.bytes);
  const seq = emitFileChange(req.path, 'modify', source, applied.bytes, deps);
  return { result: { applied: true, path: req.path, seq, created: false }, handle: `edit:${req.path}@${seq}`, pointer: req.path };
}

/** Build + emit one file change-event and refresh projections (the shared Write/Edit spine step). */
function emitFileChange(
  rel: string,
  kind: 'create' | 'modify',
  pre: string | null,
  post: string,
  deps: BaseToolDeps,
): number {
  const draft: ChangeEventDraft = {
    worktree: deps.worktree,
    actor: 'session',
    op_id: ulid(),
    provenance: 'declared',
    cause: null,
    kind,
    path: rel,
    pre_hash: pre === null ? null : sha256(pre),
    post_hash: sha256(post),
    generated: false,
  };
  const seq = deps.emit(draft);
  deps.reindex?.(rel, post);
  deps.expectPrecise?.(rel);
  return seq;
}

/** Deterministic string replacement with Claude-Code Edit semantics (unique unless replace_all). */
export function applyReplace(
  source: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): { ok: true; bytes: string } | { ok: false; error: CoaError } {
  const first = source.indexOf(oldStr);
  if (first === -1) return { ok: false, error: { code: 'edit-no-match', message: `old_string not found: ${oldStr}` } };
  if (replaceAll) return { ok: true, bytes: source.split(oldStr).join(newStr) };
  if (source.indexOf(oldStr, first + oldStr.length) !== -1) {
    return { ok: false, error: { code: 'edit-ambiguous', message: `old_string is not unique; pass replace_all: ${oldStr}` } };
  }
  return { ok: true, bytes: source.slice(0, first) + newStr + source.slice(first + oldStr.length) };
}
```

Update `fail` to return the full union type — it already returns `{ applied: false; error }`, which now matches the widened `WriteResult`. No change needed beyond the type widening above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/workbench/base-tools.test.ts`
Expected: PASS (read + write + edit).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/base-tools.ts packages/core/src/workbench/base-tools.test.ts
git commit -m "feat: add confined write and edit executors through the change spine"
```

---

## Task 3: Bash handler

**Files:**
- Modify: `packages/core/src/workbench/base-tools.ts`
- Test: `packages/core/src/workbench/base-tools.test.ts`

**Interfaces:**
- Consumes: `BaseToolDeps.exec`, `ExecResult` from Task 1; `wrap`.
- Produces: `bash(req, deps) -> ToolResponse<ExecResult>` where `req = { command: string; timeout?: number; description?: string }`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/workbench/base-tools.test.ts`:

```ts
import { bash } from './base-tools.js';

describe('bash', () => {
  it('runs a command with cwd = worktreeRoot and returns its result', () => {
    let seenCwd = '';
    const deps: BaseToolDeps = {
      ...readDeps({}),
      exec: (command, opts) => {
        seenCwd = opts.cwd;
        return { stdout: `ran ${command}`, stderr: '', exitCode: 0 };
      },
    };
    const res = bash({ command: 'ls' }, deps);
    expect(seenCwd).toBe('/repo');
    expect(res.result).toEqual({ stdout: 'ran ls', stderr: '', exitCode: 0 });
  });

  it('surfaces a non-zero exit as a normal result (never throws)', () => {
    const deps: BaseToolDeps = {
      ...readDeps({}),
      exec: () => ({ stdout: '', stderr: 'boom', exitCode: 1 }),
    };
    const res = bash({ command: 'false' }, deps);
    expect(res.result).toEqual({ stdout: '', stderr: 'boom', exitCode: 1 });
  });

  it('passes the timeout through to exec', () => {
    let seenTimeout: number | undefined;
    const deps: BaseToolDeps = {
      ...readDeps({}),
      exec: (_c, opts) => {
        seenTimeout = opts.timeoutMs;
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    bash({ command: 'sleep 1', timeout: 5000 }, deps);
    expect(seenTimeout).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/workbench/base-tools.test.ts`
Expected: FAIL — `bash` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/core/src/workbench/base-tools.ts`:

```ts
/**
 * `Bash` — run a shell command in the worktree. On the pure-API path there is no
 * SDK OS sandbox, so this is confined only to `cwd = worktreeRoot` (a named,
 * maintainer-authorized S-2 deviation, at parity with Claude Code's shell). The
 * exec port never throws — a spawn failure comes back as a non-zero exitCode.
 */
export function bash(
  req: { command: string; timeout?: number; description?: string },
  deps: BaseToolDeps,
): ToolResponse<ExecResult> {
  const result = deps.exec(req.command, {
    cwd: deps.worktreeRoot,
    ...(req.timeout !== undefined ? { timeoutMs: req.timeout } : {}),
  });
  return wrap(result, `bash:${result.exitCode}`, 'bash');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/workbench/base-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/base-tools.ts packages/core/src/workbench/base-tools.test.ts
git commit -m "feat: add a worktree-scoped bash executor"
```

---

## Task 4: Catalogue entries + the `includeBaseTools` gate

**Files:**
- Modify: `packages/core/src/workbench/catalogue.ts`
- Modify: `packages/core/src/workbench/base-tools.ts`
- Modify: `packages/core/src/workbench/governed-tools.ts`
- Test: `packages/core/src/workbench/governed-tools.test.ts`

**Interfaces:**
- Consumes: `ToolManifestEntry` from `./catalogue.js`; the six handlers from `./base-tools.js`; `spec`, `ToolSpec`, `GovernedToolDeps`, `invokeSpec`, `SPECS`, `TOOL_CATALOGUE` from `./governed-tools.js`.
- Produces:
  - `ToolManifestEntry.group?: 'read' | 'write' | 'exec'`
  - `BASE_TOOL_CATALOGUE: readonly ToolManifestEntry[]` (in `base-tools.ts`)
  - `baseToolSpecs(): Record<string, ToolSpec>` (in `base-tools.ts`)
  - `GovernedToolDeps.base?: BaseToolDeps`
  - `buildGovernedTools(deps, opts?: { includeBaseTools?: boolean })`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/workbench/governed-tools.test.ts` (reuse the file's existing `makeDeps`-style helper; if none exists, construct a minimal `GovernedToolDeps` inline as the existing tests do):

```ts
import { describe, expect, it } from 'vitest';
import { buildGovernedTools, type GovernedToolDeps } from './governed-tools.js';
import type { BaseToolDeps } from './base-tools.js';

const BASE_NAMES = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'];

function baseDeps(): BaseToolDeps {
  return {
    worktreeRoot: '/repo',
    worktree: 'main',
    readFile: () => '',
    writeFile: () => {},
    fileExists: () => false,
    listFiles: () => [],
    searchFiles: () => [],
    exec: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    emit: () => 0,
  };
}

// Minimal governance deps — mirror the existing governed-tools tests' construction.
function govDeps(): GovernedToolDeps {
  return {
    sessionId: 's1',
    retrieve: {
      worktreeRoot: '/repo',
      lookupSymbol: () => undefined,
      outline: () => [],
      references: () => [],
      resolvePiece: () => undefined,
    },
    mutate: {
      worktreeRoot: '/repo',
      worktree: 'main',
      readFile: () => '',
      writeFile: () => {},
      emit: () => 0,
    },
    inspect: {
      runChecks: () => ({ groups: [] }),
      capState: () => ({ capHit: false, remaining: null }),
      decisionsByTarget: () => [],
      readDecision: () => undefined,
    },
    enrich: {
      oracle: { lookup: () => undefined, fuzzyMatch: () => [], walPosition: () => 0 },
      flagsForAgent: () => ({ groups: [] }),
    },
  };
}

describe('buildGovernedTools — base-tool gate', () => {
  it('omits base tools by default', () => {
    const names = buildGovernedTools(govDeps()).map((t) => t.name);
    for (const n of BASE_NAMES) expect(names).not.toContain(n);
  });

  it('includes the six base tools when includeBaseTools is set', () => {
    const names = buildGovernedTools({ ...govDeps(), base: baseDeps() }, { includeBaseTools: true }).map(
      (t) => t.name,
    );
    for (const n of BASE_NAMES) expect(names).toContain(n);
  });

  it('a base tool invoke returns an unapplied result on a bad path (SC-1, never throws)', () => {
    const tools = buildGovernedTools({ ...govDeps(), base: baseDeps() }, { includeBaseTools: true });
    const read = tools.find((t) => t.name === 'Read');
    const res = read?.invoke({ path: '../escape' });
    expect(res).toBeDefined();
  });
});
```

> If `govDeps()` shape drifts from the real `GovernedToolDeps`/`InspectDeps`/`RetrieveDeps`, copy the exact fake the neighboring `governed-tools.test.ts` cases already use rather than inventing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/workbench/governed-tools.test.ts`
Expected: FAIL — `base` not on `GovernedToolDeps`; base tools absent from the built catalogue.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/workbench/catalogue.ts`, extend the manifest entry:

```ts
export interface ToolManifestEntry {
  name: string;
  partition: ToolPartition;
  description: string;
  /** Capability group for frame-level allow-listing (base tools only, for now). */
  group?: 'read' | 'write' | 'exec';
}
```

In `packages/core/src/workbench/base-tools.ts`, add near the top the import and, at the bottom, the catalogue + specs. First add the imports:

```ts
import { z } from 'zod';
import type { ToolManifestEntry } from './catalogue.js';
import type { ToolSpec } from './governed-tools.js';
```

Then append:

```ts
/** The pure-API base-tool catalogue — always-loaded (kernel), tagged by capability group. */
export const BASE_TOOL_CATALOGUE: readonly ToolManifestEntry[] = [
  { name: 'Read', partition: 'kernel', group: 'read', description: 'read a file from the worktree' },
  { name: 'Glob', partition: 'kernel', group: 'read', description: 'find files by glob pattern' },
  { name: 'Grep', partition: 'kernel', group: 'read', description: 'search file contents (ripgrep)' },
  { name: 'Write', partition: 'kernel', group: 'write', description: 'create or overwrite a file' },
  { name: 'Edit', partition: 'kernel', group: 'write', description: 'string-replacement edit of a file' },
  { name: 'Bash', partition: 'kernel', group: 'exec', description: 'run a shell command in the worktree' },
];

/**
 * The base-tool dispatch table for {@link buildGovernedTools}, keyed by tool name.
 * Each spec dispatches into the injected {@link BaseToolDeps} (asserted present by
 * `buildGovernedTools` when `includeBaseTools` is set).
 */
export function baseToolSpecs(): Record<string, ToolSpec> {
  const b = (deps: { base?: BaseToolDeps }): BaseToolDeps => {
    if (deps.base === undefined) throw new Error('base tools require GovernedToolDeps.base');
    return deps.base;
  };
  return {
    Read: spec({ path: z.string(), offset: z.number().optional(), limit: z.number().optional() }, (a, d) =>
      readFileTool(a, b(d)),
    ),
    Glob: spec({ pattern: z.string(), path: z.string().optional() }, (a, d) => glob(a, b(d))),
    Grep: spec(
      {
        pattern: z.string(),
        path: z.string().optional(),
        glob: z.string().optional(),
        output_mode: z.enum(['content', 'files_with_matches']).optional(),
      },
      (a, d) => grep(a, b(d)),
    ),
    Write: spec({ path: z.string(), content: z.string() }, (a, d) => write(a, b(d))),
    Edit: spec(
      { path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() },
      (a, d) => edit(a, b(d)),
    ),
    Bash: spec({ command: z.string(), timeout: z.number().optional(), description: z.string().optional() }, (a, d) =>
      bash(a, b(d)),
    ),
  };
}
```

> `spec` and `ToolSpec` are exported from `governed-tools.ts`. If `spec` is not currently exported, add `export` to its declaration in that file as part of this task.

In `packages/core/src/workbench/governed-tools.ts`:

1. Import the base surface:

```ts
import { BASE_TOOL_CATALOGUE, baseToolSpecs, type BaseToolDeps } from './base-tools.js';
```

2. Add `base` to the deps interface:

```ts
export interface GovernedToolDeps {
  // ...existing fields...
  /** The pure-API base-tool ports; present only when built with includeBaseTools. */
  base?: BaseToolDeps;
}
```

3. Export `spec` and `ToolSpec` (add `export` to both if not already), then replace `buildGovernedTools`:

```ts
export function buildGovernedTools(
  deps: GovernedToolDeps,
  opts?: { includeBaseTools?: boolean },
): RegisteredTool[] {
  if (opts?.includeBaseTools && deps.base === undefined) {
    throw new Error('buildGovernedTools: includeBaseTools requires deps.base');
  }
  const entries = opts?.includeBaseTools ? [...TOOL_CATALOGUE, ...BASE_TOOL_CATALOGUE] : TOOL_CATALOGUE;
  const specs = opts?.includeBaseTools ? { ...SPECS, ...baseToolSpecs() } : SPECS;
  return entries.map((entry) => {
    const toolSpec = specs[entry.name];
    if (toolSpec === undefined) {
      throw new Error(`buildGovernedTools: no dispatch spec for catalogue tool '${entry.name}'`);
    }
    return {
      name: entry.name,
      description: entry.description,
      partition: entry.partition,
      inputSchema: toolSpec.shape,
      invoke: (raw: unknown) => invokeSpec(entry.name, toolSpec, raw, deps),
    };
  });
}
```

Guard against an import cycle: `base-tools.ts` imports only the `ToolSpec` **type** and the `spec` helper from `governed-tools.ts`; `governed-tools.ts` imports the base **values**. If tsc/tsdown flags a cycle, move the `spec`/`ToolSpec` definitions into a tiny `tool-spec.ts` and import from there in both files.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/workbench/governed-tools.test.ts packages/core/src/workbench/base-tools.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/catalogue.ts packages/core/src/workbench/base-tools.ts packages/core/src/workbench/base-tools.test.ts packages/core/src/workbench/governed-tools.ts packages/core/src/workbench/governed-tools.test.ts
git commit -m "feat: gate base tools into the governed catalogue by flag"
```

---

## Task 5: Composition wiring — real ports + provider selection

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/src/session/daemon.ts`
- Modify: `packages/core/src/session/composition.ts`
- Modify: `packages/core/src/session/session.ts`
- Modify: `packages/core/src/index.ts` (only if base types belong on the public surface — check existing exports)
- Test: `packages/core/src/session/session.test.ts`

**Interfaces:**
- Consumes: `buildGovernedTools(deps, { includeBaseTools })`, `BaseToolDeps` from the workbench; `@vscode/ripgrep` (`rgPath`), `tinyglobby` (`globSync`), node `fs`/`child_process`.
- Produces: `DaemonCore.baseCatalogue: ToolCatalogue`; `SessionDeps.baseCatalogue: ToolCatalogue`; provider-selected `registerTools`.

- [ ] **Step 1: Add dependencies**

Run:

```bash
cd "c:/Users/Zander/Documents/Side Projects/coa-core-context"
pnpm --filter @coa/core add @vscode/ripgrep tinyglobby
```

Expected: both added to `packages/core/package.json` `dependencies`.

- [ ] **Step 2: Write the failing test**

Append to `packages/core/src/session/session.test.ts` a case asserting the pure-API provider gets the base catalogue. Reuse the file's existing `SessionDeps` fake; add two distinct catalogues and a fake adapter that records what it was registered with:

```ts
it('registers the base catalogue for a non-claude provider and the plain one for claude', async () => {
  const registered: Record<string, string[]> = {};
  const makeAdapter = (label: string): RuntimeAdapter =>
    ({
      renderNative: () => ({ systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {}, files: [] }),
      denyBuiltins: () => {},
      registerTools: (cat) => {
        registered[label] = cat.map((t) => t.name);
      },
      interceptTool: () => {},
      interceptStop: () => {},
      runLoop: async () => {},
      usageTelemetry: () => ({ tokensIn: 0, tokensOut: 0, costUsd: 0 }),
      deliverReminder: () => {},
      render_context: () => {},
      inject_runtime: () => {},
      cache_control: () => {},
      capabilityProfile: () => barebonesProfile,
      refs: () => null,
      runEval: async () => ({ passed: 0, failed: 0 }),
    }) as unknown as RuntimeAdapter;

  const deps = baseSessionDeps({
    catalogue: [{ name: 'edit_symbol' } as RegisteredTool],
    baseCatalogue: [{ name: 'edit_symbol' } as RegisteredTool, { name: 'Read' } as RegisteredTool],
  });

  await createSession({ role: 'coder', scope: '.', input: 'x', model: { provider: 'deepseek', model: 'x' } }, { ...deps, createAdapter: () => makeAdapter('deepseek') });
  await createSession({ role: 'coder', scope: '.', input: 'x', model: { provider: 'claude', model: 'y' } }, { ...deps, createAdapter: () => makeAdapter('claude') });

  expect(registered['deepseek']).toContain('Read');
  expect(registered['claude']).not.toContain('Read');
});
```

> Adapt `baseSessionDeps(...)` / `createSession(...)` names to the file's existing test scaffolding. The essential assertion: `provider !== 'claude'` ⇒ `baseCatalogue`; `provider === 'claude'` ⇒ `catalogue`.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/session/session.test.ts`
Expected: FAIL — `baseCatalogue` not on `SessionDeps`; `registerTools` still uses `deps.catalogue` unconditionally.

- [ ] **Step 4: Wire the composition**

In `packages/core/src/session/session.ts`, add the field to `SessionDeps` (beside `catalogue`, ~line 112):

```ts
  /** The pure-API tool catalogue (governance + base tools); used for non-claude providers. */
  baseCatalogue: ToolCatalogue;
```

Replace line ~225:

```ts
  adapter.registerTools(deps.catalogue);
```

with:

```ts
  adapter.registerTools(provider === 'claude' ? deps.catalogue : deps.baseCatalogue);
```

(`provider` is already computed at ~line 190.)

In `packages/core/src/session/composition.ts`: add `baseCatalogue: ToolCatalogue;` to `DaemonCore` (beside `catalogue`, ~line 45) and add `baseCatalogue: core.baseCatalogue,` to the `composeSessionDeps` return (beside `catalogue: core.catalogue`, ~line 82).

In `packages/core/src/session/daemon.ts`:

1. Add imports:

```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import { globSync } from 'tinyglobby';
import type { BaseToolDeps } from '../workbench/base-tools.js';
```

2. Add a `baseToolDeps(kernel, root)` builder (mirror `governedToolDeps`, add the fs/exec ports):

```ts
function baseToolDeps(kernel: ChangeKernel, root: string): BaseToolDeps {
  const worktreeRoot = root.replace(/\\/g, '/');
  return {
    worktreeRoot,
    worktree: 'main',
    readFile: (abs) => readFileSync(abs, 'utf8'),
    writeFile: (abs, bytes) => writeFileSync(abs, bytes),
    fileExists: (abs) => existsSync(abs),
    listFiles: (pattern, baseAbs) =>
      globSync(pattern, { cwd: baseAbs, absolute: true, dot: false }),
    searchFiles: ({ pattern, baseAbsolute, glob, mode }) => {
      const args = [
        mode === 'files' ? '--files-with-matches' : '--line-number',
        ...(glob ? ['--glob', glob] : []),
        '--', pattern, baseAbsolute,
      ];
      const out = spawnSync(rgPath, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      const lines = (out.stdout ?? '').split('\n').filter((l) => l.length > 0);
      if (mode === 'files') return lines.map((file) => ({ file: file.replace(/\\/g, '/') }));
      return lines.map((line) => {
        const m = /^(.*?):(\d+):(.*)$/.exec(line);
        return m ? { file: m[1].replace(/\\/g, '/'), line: Number(m[2]), text: m[3] } : { file: line };
      });
    },
    exec: (command, opts) => {
      const out = spawnSync(command, {
        cwd: opts.cwd,
        shell: true,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
      });
      return {
        stdout: out.stdout ?? '',
        stderr: out.stderr ?? (out.error ? String(out.error.message) : ''),
        exitCode: out.status ?? (out.error ? -1 : 0),
      };
    },
    emit: (draft) => kernel.emit(draft),
    reindex: undefined,
    expectPrecise: undefined,
  };
}
```

3. In the `core` object, add `baseCatalogue` after `catalogue`:

```ts
    catalogue: buildGovernedTools(governedToolDeps(kernel, governance, flags, options.root ?? '.')),
    baseCatalogue: buildGovernedTools(
      { ...governedToolDeps(kernel, governance, flags, options.root ?? '.'), base: baseToolDeps(kernel, options.root ?? '.') },
      { includeBaseTools: true },
    ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/core && pnpm typecheck`
Expected: PASS; typecheck clean. Fix any `SessionDeps` fakes in other core tests that now need a `baseCatalogue` field (add `baseCatalogue: []` to those fakes).

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/src/session/daemon.ts packages/core/src/session/composition.ts packages/core/src/session/session.ts packages/core/src/session/session.test.ts pnpm-lock.yaml
git commit -m "feat: give the pure-api backend real base tools by provider"
```

---

## Task 6: Adapter-level verification + docs sync

**Files:**
- Test: `packages/adapter-deepseek/src/adapter.test.ts`
- Modify: `docs/REPO_LAYOUT.md` (if the new deps/module warrant a pointer — same-commit doc rule)

**Interfaces:**
- Consumes: `DeepSeekAdapter.registerTools`, the built base catalogue.

- [ ] **Step 1: Write the test**

Append to `packages/adapter-deepseek/src/adapter.test.ts` a case that the DeepSeek adapter forwards a base-tool catalogue to the wire (mirror the file's existing `registerTools`/`complete` fake). The essential assertion: after `registerTools([...with a 'Read' entry])`, a driven loop passes a `tools` list containing `Read` to the injected `complete`/`fetch` fake. If the existing tests already prove `registerTools` → wire forwarding for governance tools, this only needs to add `Read` to that catalogue and assert it appears — do not duplicate the whole harness.

- [ ] **Step 2: Run it to verify it fails, then passes**

Run: `pnpm vitest run packages/adapter-deepseek`
Expected: FAIL first (Read absent), then PASS after confirming the catalogue is forwarded (this is likely already true — the value is the regression guard).

- [ ] **Step 3: Sync docs**

If `packages/core` gained runtime deps (`@vscode/ripgrep`, `tinyglobby`) or a notable new module, add a one-line pointer in `docs/REPO_LAYOUT.md` per the same-commit doc rule. Update the progress ledger `.superpowers/sdd/progress.md` (base-tools increment done).

- [ ] **Step 4: Full suite + typecheck**

Run: `pnpm vitest run packages/core && pnpm vitest run packages/adapter-deepseek && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-deepseek/src/adapter.test.ts docs/REPO_LAYOUT.md .superpowers/sdd/progress.md
git commit -m "test: verify the pure-api loop receives base tools"
```

---

## Final verification (after all tasks)

- [ ] `pnpm vitest run packages/core` — green.
- [ ] `pnpm vitest run packages/adapter-deepseek` — green.
- [ ] `pnpm typecheck` — clean.
- [ ] `pnpm test` — full suite (note the one pre-existing, unrelated lint error in `packages/console-ui/src/dense/Transcript.tsx`).
- [ ] Whole-branch review, then ask the maintainer how to finish the branch (it has been kept as-is, not merged).
- [ ] Live DeepSeek smoke test (`DEEPSEEK_API_KEY`, costs money) only on the maintainer's explicit go-ahead.

---

_Last reviewed: 2026-07-03_
