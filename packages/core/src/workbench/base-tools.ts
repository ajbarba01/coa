import { createHash } from 'node:crypto';
import path from 'node:path';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { CoaError, ToolResponse } from '@coa/shared';
import type { ChangeEventDraft } from '../event.js';
import { confinePath, type ConfineResult } from './confine.js';
import type { ToolManifestEntry } from './catalogue.js';
import { spec, type ToolSpec } from './tool-spec.js';

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

/**
 * Read caps (Claude-Code parity). Without these the pure-API `Read` returns the whole
 * file, and since the loop resends full history every turn one fat read poisons every
 * later turn. Defaults: at most {@link DEFAULT_READ_LINE_LIMIT} lines when the model
 * gives no `limit`, each line truncated to {@link MAX_LINE_LENGTH} chars.
 */
export const DEFAULT_READ_LINE_LIMIT = 2000;
export const MAX_LINE_LENGTH = 2000;

/** A NUL byte in the head is the standard "this is binary, don't display it" heuristic (git/Claude Code). */
function isBinary(text: string): boolean {
  const head = Math.min(text.length, 8000);
  for (let i = 0; i < head; i += 1) if (text.charCodeAt(i) === 0) return true;
  return false;
}

/** `Read` — confined file read, returned as `cat -n`-style numbered lines. */
export function readFileTool(
  req: { path: string; offset?: number | undefined; limit?: number | undefined },
  deps: BaseToolDeps,
): ToolResponse<ReadResult> {
  const confined = confine(req.path, deps);
  if (!confined.ok)
    return wrap({ found: false, reason: confined.error.code }, 'read:rejected', req.path);
  let text: string;
  try {
    text = deps.readFile(confined.path);
  } catch {
    return wrap({ found: false, reason: 'not-found' }, 'read:miss', req.path);
  }
  if (isBinary(text)) {
    const bytes = Buffer.byteLength(text, 'utf8');
    return wrap(
      { found: true, content: `[coa: binary file (${bytes} bytes), not displayed]` },
      `read:${req.path}`,
      req.path,
    );
  }
  return wrap(
    { found: true, content: numberLines(text, req.offset, req.limit) },
    `read:${req.path}`,
    req.path,
  );
}

/** Hard ceiling on `Glob` matches returned to the model (a huge repo can still blow past ignores). */
export const GLOB_MATCH_CAP = 1000;

/** `Glob` — confined glob; returns worktree-relative matches, capped at {@link GLOB_MATCH_CAP}. */
export function glob(
  req: { pattern: string; path?: string | undefined },
  deps: BaseToolDeps,
): ToolResponse<GlobResult> {
  const base = req.path ?? '.';
  const confined = confine(base, deps);
  if (!confined.ok) return wrap({ matches: [] }, 'glob:rejected', base);
  const matches = deps
    .listFiles(req.pattern, confined.path)
    .map((abs) => toRel(deps.worktreeRoot, abs))
    .slice(0, GLOB_MATCH_CAP);
  return wrap({ matches }, `glob:${req.pattern}`, req.pattern);
}

/** Hard ceiling on `Grep` hits returned to the model — mirrors {@link GLOB_MATCH_CAP} (a broad pattern still explodes). */
export const GREP_HIT_CAP = 1000;

/** `Grep` — confined ripgrep search; returns worktree-relative hits, capped at {@link GREP_HIT_CAP}. */
export function grep(
  req: {
    pattern: string;
    path?: string | undefined;
    glob?: string | undefined;
    output_mode?: 'content' | 'files_with_matches' | undefined;
  },
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
    .slice(0, GREP_HIT_CAP)
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

/** Truncate a single line to {@link MAX_LINE_LENGTH}, marking the cut (parity with Claude Code's Read). */
function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) return line;
  return `${line.slice(0, MAX_LINE_LENGTH)}… [line truncated by coa]`;
}

/**
 * `cat -n`-style numbering with an optional 1-based `offset` start line and `limit`.
 * An absent/zero `limit` caps at {@link DEFAULT_READ_LINE_LIMIT} rather than the whole
 * file, and when that default cap hides trailing lines a footer tells the model to page.
 */
export function numberLines(text: string, offset?: number, limit?: number): string {
  const lines = text.split('\n');
  // A trailing newline yields a final empty element; drop it so counts match `wc -l + 1`.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const start = offset && offset > 0 ? offset - 1 : 0;
  const explicit = limit !== undefined && limit > 0;
  const end = start + (explicit ? limit : DEFAULT_READ_LINE_LIMIT);
  const window = lines.slice(start, end);
  const numbered = window.map((line, i) => `${start + i + 1}\t${truncateLine(line)}`).join('\n');
  // Only warn when our own default cap hid lines — an explicit page knows it is paging.
  if (!explicit && lines.length > end) {
    return `${numbered}\n[truncated by coa: showing ${window.length} of ${lines.length} lines — pass offset to page]`;
  }
  return numbered;
}

/** Build a distilled-handle tool return (flags are added by the enrich decorator). */
export function wrap<R>(result: R, handle: string, pointer: string): ToolResponse<R> {
  return { result, handle, pointer };
}

/** A rejected write/edit return (unapplied + typed reason). */
export function fail(error: CoaError): ToolResponse<WriteResult> {
  return { result: { applied: false, error }, handle: 'base:rejected', pointer: error.code };
}

export type WriteResult =
  | { applied: true; path: string; seq: number; created: boolean }
  | { applied: false; error: CoaError };

const sha256 = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');

/** `Write` — confined whole-file create/overwrite, emitted through the M1 spine (P7). */
export function write(
  req: { path: string; content: string },
  deps: BaseToolDeps,
): ToolResponse<WriteResult> {
  const confined = confine(req.path, deps);
  if (!confined.ok) return fail(confined.error);
  const existed = deps.fileExists(confined.path);
  let source: string;
  try {
    source = existed ? deps.readFile(confined.path) : '';
  } catch (err) {
    return fail({ code: 'write-failed', message: `could not write ${req.path}: ${String(err)}` });
  }
  try {
    deps.writeFile(confined.path, req.content);
  } catch (err) {
    return fail({ code: 'write-failed', message: `could not write ${req.path}: ${String(err)}` });
  }
  const seq = emitFileChange(
    req.path,
    existed ? 'modify' : 'create',
    existed ? source : null,
    req.content,
    deps,
  );
  return {
    result: { applied: true, path: req.path, seq, created: !existed },
    handle: `write:${req.path}@${seq}`,
    pointer: req.path,
  };
}

/** `Edit` — confined string-replacement edit, emitted through the M1 spine (P7). */
export function edit(
  req: { path: string; old_string: string; new_string: string; replace_all?: boolean | undefined },
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
  try {
    deps.writeFile(confined.path, applied.bytes);
  } catch (err) {
    return fail({ code: 'write-failed', message: `could not write ${req.path}: ${String(err)}` });
  }
  const seq = emitFileChange(req.path, 'modify', source, applied.bytes, deps);
  return {
    result: { applied: true, path: req.path, seq, created: false },
    handle: `edit:${req.path}@${seq}`,
    pointer: req.path,
  };
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

/**
 * `Bash` — run a shell command in the worktree. On the pure-API path there is no
 * SDK OS sandbox, so this is confined only to `cwd = worktreeRoot` (a named,
 * maintainer-authorized S-2 deviation, at parity with Claude Code's shell). The
 * exec port never throws — a spawn failure comes back as a non-zero exitCode.
 */
/**
 * Bash caps (Claude-Code parity). The pure-API shell has no SDK guard, so left
 * unbounded a `yes`-style command floods the transcript and a runaway command hangs
 * the loop. Each output stream is truncated to {@link BASH_OUTPUT_CAP} chars, and an
 * absent `timeout` defaults to {@link DEFAULT_BASH_TIMEOUT_MS} so nothing runs forever.
 */
export const BASH_OUTPUT_CAP = 30000;
export const DEFAULT_BASH_TIMEOUT_MS = 120000;

/** Bound one output stream, marking the cut so the model knows more was produced. */
function capOutput(stream: string): string {
  if (stream.length <= BASH_OUTPUT_CAP) return stream;
  return `${stream.slice(0, BASH_OUTPUT_CAP)}\n[truncated by coa: showing ${BASH_OUTPUT_CAP} of ${stream.length} chars]`;
}

export function bash(
  req: { command: string; timeout?: number | undefined; description?: string | undefined },
  deps: BaseToolDeps,
): ToolResponse<ExecResult> {
  const result = deps.exec(req.command, {
    cwd: deps.worktreeRoot,
    timeoutMs: req.timeout ?? DEFAULT_BASH_TIMEOUT_MS,
  });
  const capped: ExecResult = {
    stdout: capOutput(result.stdout),
    stderr: capOutput(result.stderr),
    exitCode: result.exitCode,
  };
  return wrap(capped, `bash:${result.exitCode}`, 'bash');
}

/** The pure-API base-tool catalogue — always-loaded (kernel), tagged by capability group. */
export const BASE_TOOL_CATALOGUE: readonly ToolManifestEntry[] = [
  {
    name: 'Read',
    partition: 'kernel',
    group: 'read',
    description: 'read a file from the worktree',
  },
  { name: 'Glob', partition: 'kernel', group: 'read', description: 'find files by glob pattern' },
  {
    name: 'Grep',
    partition: 'kernel',
    group: 'read',
    description: 'search file contents (ripgrep)',
  },
  { name: 'Write', partition: 'kernel', group: 'write', description: 'create or overwrite a file' },
  {
    name: 'Edit',
    partition: 'kernel',
    group: 'write',
    description: 'string-replacement edit of a file',
  },
  {
    name: 'Bash',
    partition: 'kernel',
    group: 'exec',
    description: 'run a shell command in the worktree',
  },
];

/**
 * The base-tool dispatch table for {@link buildGovernedTools}, keyed by tool name.
 * Each spec dispatches into the injected {@link BaseToolDeps} (asserted present by
 * `buildGovernedTools` when `includeBaseTools` is set).
 */
export function baseToolSpecs(): Record<string, ToolSpec<{ base?: BaseToolDeps }>> {
  const b = (deps: { base?: BaseToolDeps }): BaseToolDeps => {
    if (deps.base === undefined) throw new Error('base tools require GovernedToolDeps.base');
    return deps.base;
  };
  return {
    Read: spec(
      { path: z.string(), offset: z.number().optional(), limit: z.number().optional() },
      (a, d) => readFileTool(a, b(d)),
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
      {
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
      },
      (a, d) => edit(a, b(d)),
    ),
    Bash: spec(
      { command: z.string(), timeout: z.number().optional(), description: z.string().optional() },
      (a, d) => bash(a, b(d)),
    ),
  };
}

/** Deterministic string replacement with Claude-Code Edit semantics (unique unless replace_all). */
export function applyReplace(
  source: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): { ok: true; bytes: string } | { ok: false; error: CoaError } {
  const first = source.indexOf(oldStr);
  if (first === -1)
    return {
      ok: false,
      error: { code: 'edit-no-match', message: `old_string not found: ${oldStr}` },
    };
  if (replaceAll) return { ok: true, bytes: source.split(oldStr).join(newStr) };
  if (source.indexOf(oldStr, first + oldStr.length) !== -1) {
    return {
      ok: false,
      error: {
        code: 'edit-ambiguous',
        message: `old_string is not unique; pass replace_all: ${oldStr}`,
      },
    };
  }
  return { ok: true, bytes: source.slice(0, first) + newStr + source.slice(first + oldStr.length) };
}
