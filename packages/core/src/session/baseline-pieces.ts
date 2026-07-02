import type { CapabilityFrame, Piece } from '@coa/shared';
import type { AssemblePiecesContext } from './session.js';

/**
 * The coa-authored, backend-NEUTRAL baseline Piece set — the standing behavioral
 * scaffold every governed agent gets (the "pieces phase" floor). It replaces what
 * the Claude Agent SDK's `claude_code` preset would carry but coa's custom-string
 * prompt path deletes, and it is the exact scaffold a pure-API backend (which has
 * NOTHING native) needs. Authored once here; both backends consume it through the
 * existing `assemblePieces → M5.compile → M9.renderNative` pipeline (no backend
 * ever imports this module — it flows through the neutral config).
 *
 * Design rules (see docs/design/research/pieces-and-dual-backend-spec.md §A1):
 * - coa-neutral identity — never impersonate "Claude Code" (matters for parity
 *   AND for a from-scratch backend).
 * - minimal-but-sufficient — a faithful re-declaration, not a copy of the preset.
 * - cache-friendly order — stable authored text first, volatile environment last,
 *   so M5's most-stable-first ordering + the renderer's byte-stable prefix keep
 *   the prompt cache warm (D-P2 / P1).
 */

/** The per-session facts the environment Piece is authored from (the "dynamic section"). */
export interface BaselineContext {
  /** The session worktree root — the agent's working directory. */
  worktree: string;
  /** The OS platform (e.g. `win32`, `linux`, `darwin`). */
  platform: string;
  /** The active model id, when known. */
  model?: string;
  /** The current date (`YYYY-MM-DD`) for temporal grounding. */
  date: string;
}

/** A standing, pushed-into-prompt, human-authored Piece (no reminder cadence). */
function authoredPush(name: string, description: string, body: string): Piece {
  return {
    name,
    description,
    body,
    axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
  };
}

const IDENTITY = authoredPush(
  'baseline-identity',
  'who the agent is and how it operates',
  [
    'You are a software-engineering agent operating under coa governance.',
    'A human is present and steers the work. When you have enough to act, act —',
    'do not narrate options you will not take or re-litigate settled decisions.',
  ].join(' '),
);

const SAFETY = authoredPush(
  'baseline-safety',
  'refusal posture and destructive-action care',
  [
    'Refuse destructive, mass-targeting, or clearly malicious requests; legitimate',
    'security work with a clear context is fine. For actions that are hard to',
    'reverse or reach outside the worktree, confirm first unless told to proceed.',
    'Before deleting or overwriting something you did not create, inspect it and',
    'surface any mismatch instead of proceeding.',
  ].join(' '),
);

const TOOL_USE = authoredPush(
  'baseline-tool-use',
  'how to use the available tools well',
  [
    'Prefer the dedicated file and search tools over shell equivalents when one',
    'fits. Make independent tool calls in parallel. A denied tool call means the',
    'human declined it — adjust rather than retrying it verbatim. Prefer small,',
    'targeted edits (a diff) over rewriting whole files.',
  ].join(' '),
);

const CODE_QUALITY = authoredPush(
  'baseline-code-quality',
  'output-quality expectations',
  [
    'Match the surrounding code’s style, naming, and idiom. Comment to explain',
    'why, not what. Handle errors rather than swallowing them. Report outcomes',
    'honestly — if a step failed or was skipped, say so plainly.',
  ].join(' '),
);

/** The self-identity Piece stating which model the agent runs as (volatile → tail). */
function modelPiece(model: string): Piece {
  return authoredPush(
    'baseline-model',
    'the model the agent is running as',
    `You are running as the model \`${model}\`. Do not claim to be a different model.`,
  );
}

/** Author the volatile environment Piece from the session's facts (ordered last, per D-P2). */
function environmentPiece(ctx: BaselineContext): Piece {
  const lines = [
    `Working directory: ${ctx.worktree}`,
    `Platform: ${ctx.platform}`,
    `Date: ${ctx.date}`,
  ];
  return authoredPush('baseline-environment', 'the session runtime facts', lines.join('\n'));
}

/**
 * The stable authored guidance — identity, safety, tool-use, and code-quality.
 * Session-invariant, so it forms the cache-warm prefix; the agent-assembly
 * resolver inserts role/package/skill Pieces after it and the volatile tail last.
 */
export function baselineStablePieces(): Piece[] {
  return [IDENTITY, SAFETY, TOOL_USE, CODE_QUALITY];
}

/**
 * The volatile per-session tail — the model self-identity (present whenever the
 * model id is known) then the environment block. Ordered last so the stable
 * prefix stays cache-warm (D-P2).
 */
export function baselineVolatilePieces(ctx: BaselineContext): Piece[] {
  return [
    ...(ctx.model !== undefined && ctx.model !== '' ? [modelPiece(ctx.model)] : []),
    environmentPiece(ctx),
  ];
}

/**
 * The ordered baseline Piece set for a session (stable head + volatile tail). The
 * simple path (no packages) uses this directly; the agent-assembly resolver uses
 * the split halves so it can insert package/skill Pieces between them.
 */
export function baselinePieces(ctx: BaselineContext): Piece[] {
  return [...baselineStablePieces(), ...baselineVolatilePieces(ctx)];
}

const EMPTY_FRAME: CapabilityFrame = { allow: [], deny: [] };

/** ISO `YYYY-MM-DD` in UTC (deterministic — no locale/timezone drift in the prompt). */
function isoDate(when: Date): string {
  return when.toISOString().slice(0, 10);
}

/**
 * Build an `assemblePieces` implementation that seeds every session with the
 * neutral baseline scaffold (an empty capability frame — the kept-built-in
 * allow-list is a later increment). `platform` and `now` are injected so the
 * function stays pure/testable; the daemon passes `process.platform` + the wall
 * clock. Role/scope Pieces and M4-derived context are concatenated later.
 */
export function createBaselineAssemblePieces(deps: {
  platform: string;
  now?: () => Date;
}): (ctx: AssemblePiecesContext) => { pieces: Piece[]; frame: CapabilityFrame } {
  const now = deps.now ?? ((): Date => new Date());
  return (ctx) => ({
    pieces: baselinePieces({
      worktree: ctx.worktree,
      platform: deps.platform,
      date: isoDate(now()),
      ...(ctx.model !== undefined ? { model: ctx.model } : {}),
    }),
    frame: EMPTY_FRAME,
  });
}
