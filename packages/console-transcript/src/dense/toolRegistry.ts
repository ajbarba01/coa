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
  // `limit` is a line COUNT, so the last line is offset + limit - 1 (not offset + limit).
  // An offset with no limit shows just the start line rather than a trailing-dash range.
  const range =
    offset === undefined
      ? ''
      : limit !== undefined
        ? `:${offset}-${offset + limit - 1}`
        : `:${offset}`;
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

/** A compact shape hint for a `DiffSpec` — `whole file` or `N hunk(s)` — for a patch/edit
 *  title, so it says more than the bare target path. '' for a malformed/unknown spec. */
function diffHunkSummary(diff: unknown): string {
  if (typeof diff !== 'object' || diff === null) return '';
  const d = diff as Record<string, unknown>;
  if (d['form'] === 'whole-file') return 'whole file';
  if (d['form'] === 'search-replace' && Array.isArray(d['hunks'])) {
    const n = d['hunks'].length;
    return `${n} ${n === 1 ? 'hunk' : 'hunks'}`;
  }
  return '';
}

/** `apply_patch`'s target: its `target` path plus a `· N hunks` shape hint from the diff. */
function applyPatchTarget(rec: Record<string, unknown> | undefined): string {
  const target = str(rec, 'target');
  if (target === undefined) return '';
  const hint = diffHunkSummary(rec?.['diff']);
  return hint.length > 0 ? `${target} · ${hint}` : target;
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
  NotebookEdit: {
    icon: Notebook,
    target: (r) => str(r, 'notebook_path') ?? str(r, 'file_path') ?? '',
  },
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
  apply_patch: { icon: FileDiff, target: applyPatchTarget },
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

/** The path from a SymbolRef (`{path, symbol?}`), or undefined when name-only (a bare
 *  string / `{name}` — unresolvable to a path without a lookup). Never throws. */
function refPath(v: unknown): string | undefined {
  if (typeof v === 'object' && v !== null) {
    const p = (v as Record<string, unknown>)['path'];
    if (typeof p === 'string') return p;
  }
  return undefined;
}

/** Where a card's header link reveals: a path plus an optional line. Covers the file
 *  tools (`Read`'s line comes from `offset`) and the symbol/patch tools (path from the
 *  ref, or `apply_patch`'s `target`). Returns undefined when there is no resolvable path
 *  (non-target tools, a name-only ref, malformed input). Pure; never throws. */
export function toolTarget(
  tool: string,
  input: string,
): { path: string; line?: number } | undefined {
  const rec = parseInput(input);
  switch (tool) {
    case 'Read': {
      const path = str(rec, 'file_path') ?? str(rec, 'path');
      if (path === undefined) return undefined;
      const line = int(rec, 'offset');
      return line === undefined ? { path } : { path, line };
    }
    case 'Edit':
    case 'Write': {
      const path = str(rec, 'file_path') ?? str(rec, 'path');
      return path === undefined ? undefined : { path };
    }
    case 'NotebookEdit': {
      const path = str(rec, 'notebook_path') ?? str(rec, 'file_path');
      return path === undefined ? undefined : { path };
    }
    case 'get_symbol':
    case 'edit_symbol':
    case 'get_piece':
    case 'get_spec': {
      const path = refPath(rec?.['ref']);
      return path === undefined ? undefined : { path };
    }
    case 'apply_patch': {
      const path = str(rec, 'target');
      return path === undefined ? undefined : { path };
    }
    default:
      return undefined;
  }
}
