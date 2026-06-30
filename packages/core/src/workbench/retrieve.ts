import type { Piece, PieceRef, SymbolRef, SymbolRecord, ToolResponse } from '@coa/shared';
import { confinePath } from './confine.js';

/**
 * M6 Retrieve — the structure-first read surface (D57/D58). Each tool returns a
 * distilled handle + a pointer; the raw blob stays in the daemon and is never
 * inflated into the agent's context. These are pure M1 reads over the resident
 * symbol index / graph / piece-resolver (no disk in the floor); a path-bearing
 * ref is still confined to the worktree first (S-1). The byte-level symbol-body
 * slice that touches disk is a D58 follow-up and confines at that point.
 */
export interface RetrieveDeps {
  worktreeRoot: string;
  denyRead?: readonly string[];
  realpath?: (absolutePath: string) => string;
  /** O(1) name → record lookup against M1's symbol table. */
  lookupSymbol: (name: string) => SymbolRecord | undefined;
  /** The structural outline (resident symbols) of a file. */
  outline: (relPath: string) => readonly SymbolRecord[];
  /** The reference sites of a symbol (M1 graph reverse edges). */
  references: (symbol: string) => readonly string[];
  /** Resolve a reference Piece on demand (M1 piece-resolver). */
  resolvePiece: (ref: PieceRef) => Piece | undefined;
}

export type GetSymbolResult =
  | { found: true; symbol: SymbolRecord }
  | { found: false; reason?: string };
export type OutlineResult = { path: string; symbols: readonly SymbolRecord[] };
export type ReferencesResult = { symbol: string; sites: readonly string[] };
export type GetPieceResult = { found: true; piece: Piece } | { found: false };

/** `get_symbol` — a distilled symbol record by name or `{path, symbol}` ref. */
export function getSymbol(ref: SymbolRef, deps: RetrieveDeps): ToolResponse<GetSymbolResult> {
  if ('path' in ref) {
    const confined = confine(ref.path, deps);
    if (confined !== undefined) {
      return wrap({ found: false, reason: confined }, 'symbol:rejected', ref.path);
    }
  }
  const name = 'name' in ref ? ref.name : ref.symbol;
  if (name === undefined) return wrap({ found: false, reason: 'no-symbol' }, 'symbol:miss', '');
  const symbol = deps.lookupSymbol(name);
  return symbol
    ? wrap({ found: true, symbol }, `symbol:${name}`, symbol.definedIn)
    : wrap({ found: false }, 'symbol:miss', name);
}

/** `find_references` — the reference sites of a symbol. */
export function findReferences(
  req: { symbol: string },
  deps: RetrieveDeps,
): ToolResponse<ReferencesResult> {
  const sites = deps.references(req.symbol);
  return wrap({ symbol: req.symbol, sites }, `refs:${req.symbol}`, req.symbol);
}

/** `outline` — the structural outline of a file (resident symbols). */
export function outline(req: { path: string }, deps: RetrieveDeps): ToolResponse<OutlineResult> {
  const rejected = confine(req.path, deps);
  const symbols = rejected === undefined ? deps.outline(req.path) : [];
  return wrap({ path: req.path, symbols }, `outline:${req.path}`, req.path);
}

/** `get_piece` — a reference Knowledge Piece on demand. */
export function getPiece(req: { ref: PieceRef }, deps: RetrieveDeps): ToolResponse<GetPieceResult> {
  const piece = deps.resolvePiece(req.ref);
  return piece
    ? wrap({ found: true, piece }, `piece:${req.ref}`, req.ref)
    : wrap({ found: false }, 'piece:miss', req.ref);
}

/** Confine a path-bearing ref; returns the rejection code, or `undefined` when allowed. */
function confine(relPath: string, deps: RetrieveDeps): string | undefined {
  const result = confinePath(relPath, {
    worktreeRoot: deps.worktreeRoot,
    ...(deps.denyRead ? { denyRead: deps.denyRead } : {}),
    ...(deps.realpath ? { realpath: deps.realpath } : {}),
  });
  return result.ok ? undefined : result.error.code;
}

/** Build a distilled-handle tool return (grounding/flags are added by the enrich decorator). */
function wrap<R>(result: R, handle: string, pointer: string): ToolResponse<R> {
  return { result, handle, pointer };
}
