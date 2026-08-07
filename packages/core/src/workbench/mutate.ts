import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type { CoaError, DiffSpec, SymbolRef, ToolResponse } from '@coa/shared';
import type { ChangeEventDraft } from '../event.js';
import { applyDiff } from './apply-diff.js';
import { confinePath } from './confine.js';

/**
 * Producer ① — the precise-Mutate surface. Every precise write resolves and
 * confines its target (S-1), applies the lenient diff, writes the new bytes, and
 * routes the change through the single chokepoint `emit` so the WAL, graph,
 * flags, and all consumers see it immediately. The workbench never writes the graph
 * independently; the change-event is the only authoritative record. The handler
 * never throws to the agent and never denies — a confinement or diff
 * failure comes back as an unapplied result the agent can retry.
 */

/** The narrow port the Mutate handlers need, injected by the daemon at session construction (no kernel import). */
export interface WorkbenchDeps {
  /** The session worktree root — a POSIX absolute path (S-1 confinement base). */
  worktreeRoot: string;
  /** The worktree name stamped on emitted change-events. */
  worktree: string;
  /** Forbidden-within-worktree globs (S-1); defaults applied by {@link confinePath}. */
  denyRead?: readonly string[];
  /** Symlink resolver for confinement, injected for testability. */
  realpath?: (absolutePath: string) => string;
  /** Read a file's current bytes by absolute path. */
  readFile: (absolutePath: string) => string;
  /** Write a file's new bytes by absolute path. */
  writeFile: (absolutePath: string, bytes: string) => void;
  /** The single kernel append path; returns the authoritative seq. */
  emit: (draft: ChangeEventDraft) => number;
  /** Refresh the kernel's derived symbol/graph projections from the new bytes (local, not WAL'd). */
  reindex?: (relPath: string, bytes: string) => void;
  /** Register the precise write with producer ② so its disk observation dedups to a confirm. */
  expectPrecise?: (relPath: string) => void;
  /** Resolve a name-only ref to a worktree-relative path (the kernel symbol table). */
  resolveFile?: (ref: SymbolRef) => string | undefined;
}

/** The outcome of a precise write: applied with its kernel seq, or unapplied with the reason. */
export type MutateResult =
  | { applied: true; path: string; seq: number }
  | { applied: false; error: CoaError };

const sha256 = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');

const fail = (error: CoaError): ToolResponse<MutateResult> => ({
  result: { applied: false, error },
  handle: 'mutate:rejected',
  pointer: error.code,
});

/** `edit_symbol` — the PRIMARY localized-edit path: a lenient diff against the ref's file. */
export function editSymbol(
  req: { ref: SymbolRef; diff: DiffSpec },
  deps: WorkbenchDeps,
): ToolResponse<MutateResult> {
  const rel = refPath(req.ref, deps);
  if (rel === undefined) {
    return fail({ code: 'ref-unresolved', message: 'could not resolve the ref to a file path' });
  }
  return mutateFile(rel, req.diff, deps);
}

/** `apply_patch` — the co-equal whole-file / multi-hunk escape, addressed by an explicit target path. */
export function applyPatch(
  req: { target: string; diff: DiffSpec },
  deps: WorkbenchDeps,
): ToolResponse<MutateResult> {
  return mutateFile(req.target, req.diff, deps);
}

/** Resolve, confine, apply, write, and emit a precise change-event for one file. */
function mutateFile(rel: string, diff: DiffSpec, deps: WorkbenchDeps): ToolResponse<MutateResult> {
  const confined = confinePath(rel, {
    worktreeRoot: deps.worktreeRoot,
    ...(deps.denyRead ? { denyRead: deps.denyRead } : {}),
    ...(deps.realpath ? { realpath: deps.realpath } : {}),
  });
  if (!confined.ok) return fail(confined.error);

  const source = deps.readFile(confined.path);
  const applied = applyDiff(source, diff);
  if (!applied.ok) return fail(applied.error);

  deps.writeFile(confined.path, applied.bytes);
  const draft: ChangeEventDraft = {
    worktree: deps.worktree,
    actor: 'session',
    op_id: ulid(),
    provenance: 'declared',
    cause: null,
    kind: 'modify',
    path: rel,
    pre_hash: sha256(source),
    post_hash: sha256(applied.bytes),
    generated: false,
  };
  const seq = deps.emit(draft);
  deps.reindex?.(rel, applied.bytes);
  deps.expectPrecise?.(rel);

  return {
    result: { applied: true, path: rel, seq },
    handle: `mutate:${rel}@${seq}`,
    pointer: rel,
  };
}

/** The worktree-relative path a ref names: its `path`, or a name-only ref resolved via the kernel. */
function refPath(ref: SymbolRef, deps: WorkbenchDeps): string | undefined {
  if ('path' in ref) return ref.path;
  return deps.resolveFile?.(ref);
}
