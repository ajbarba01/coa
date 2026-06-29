/**
 * Identifier aliases used across module boundaries. These are plain string
 * aliases (the SPEC's D-CAT defines them as `string`); they document intent at
 * call sites without imposing nominal typing.
 */

/** Attribution / rewind unit. The literal {@link GLOBAL_WORKTREE} is reserved for daemon-wide events. */
export type WorktreeId = string;

/** A live agent session. */
export type SessionId = string;

/** A named scope reference (D32) — the key into a {@link Scope} definition. */
export type ScopeRef = string;

/** A reference to a {@link Piece} (its `name`). */
export type PieceRef = string;

/** Reserved daemon-wide worktree sentinel — carries governance events not bound to a real worktree. */
export const GLOBAL_WORKTREE = '@global';
