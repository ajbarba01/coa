import type { CapabilityFrame, Piece, SlotId } from '@coa/shared';
import type { AssemblePiecesContext } from './session.js';

/**
 * The coa-authored, backend-NEUTRAL baseline Piece set — the standing behavioral
 * scaffold every governed agent gets (the "pieces phase" floor). It replaces what
 * the Claude Agent SDK's `claude_code` preset would carry but coa's custom-string
 * prompt path deletes, and it is the exact scaffold a pure-API backend (which has
 * NOTHING native) needs. Authored once here; both backends consume it through the
 * existing `assemblePieces → the prompt compile step → the backend renderNative step` pipeline (no backend
 * ever imports this module — it flows through the neutral config).
 *
 * Design rules:
 * - coa-neutral identity — never impersonate "Claude Code" (matters for parity
 *   AND for a from-scratch backend).
 * - minimal-but-sufficient — a faithful re-declaration, not a copy of the preset.
 * - cache-friendly order — stable authored text first, volatile environment last,
 *   so the compiler's most-stable-first ordering + the renderer's byte-stable prefix keep
 *   the prompt cache warm (cache-warm prefix; determinism-first).
 */

/**
 * The session-invariant facts the environment Piece is authored from. Deliberately
 * excludes the worktree path and the model id: both are dynamic per invocation and
 * the backend already supplies them natively (the SDK sets `cwd` and knows its own
 * model), so keeping them out of the compiled prompt is what makes `promptVersion`
 * stable across model switches and keeps the frozen prompt from going stale.
 */
export interface BaselineContext {
  /** The OS platform (e.g. `win32`, `linux`, `darwin`). */
  platform: string;
  /** What shell the `Bash` tool runs commands through (e.g. `Git Bash (POSIX sh)`,
   *  `cmd.exe`), so the agent writes command lines for the right shell instead of
   *  guessing cmd.exe on Windows. Host-invariant, so it stays in the cache-warm set. */
  shell: string;
  /** The current date (`YYYY-MM-DD`) for temporal grounding. */
  date: string;
  /** The model this agent is actually running as — authored into its own `## Model`
   *  section (near identity, not in it) so BOTH backends tell the agent what it is.
   *  `provider` always resolves (defaults to `claude` upstream); `model`/`effort`
   *  are appended only when set. This is why the frozen prompt is model-aware: a
   *  model switch must recompile so the line stays correct (silently — not via the
   *  drift banner, which stays role/package-keyed). */
  model: ModelPrompt;
}

/** The model facts the `baseline-model` piece is authored from (provider always
 *  present; model id + reasoning effort optional). */
export interface ModelPrompt {
  provider: string;
  model?: string;
  effort?: string;
}

/** A standing, pushed-into-prompt, human-authored Piece (no reminder cadence), placed in a DC-6 section slot. */
function authoredPush(name: string, description: string, body: string, slot: SlotId): Piece {
  return {
    name,
    description,
    body,
    axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
    slot,
  };
}

const IDENTITY = authoredPush(
  'baseline-identity',
  'who the agent is and how it operates',
  'You are an AI assistant operating under coa, a local governance layer over your agent loop. A human is present and steers the work. When you have enough to act, act — do not narrate options you will not take or re-litigate settled decisions.',
  'identity',
);

const TONE = authoredPush(
  'baseline-tone',
  'response length and directness',
  'Be concise and direct. Answer in as few words as the task allows; a short reply is usually best. Skip preamble and postamble — do not open with “Sure”, “Great question”, or a restatement of the request. Lead with the substance.',
  'tone',
);

const TOOL_USE = authoredPush(
  'baseline-tool-use',
  'how to use the available tools well',
  [
    'Prefer the dedicated file and search tools over shell equivalents when one fits.',
    'Make independent tool calls in parallel.',
    'A denied tool call means the human declined it — adjust rather than retrying it verbatim.',
  ]
    .map((l) => `- ${l}`)
    .join('\n'),
  'tool-use',
);

/**
 * Author the model Piece — `You are running as <provider>/<model>` (append
 * ` (<effort>)` when a reasoning effort is set; just `<provider>` when the model id
 * is unknown). Placed in its own `## Model` slot right after identity, on BOTH
 * backends, so the agent always knows what it is running as.
 */
function modelPiece(model: ModelPrompt): Piece {
  const idPart = model.model !== undefined && model.model !== '' ? `/${model.model}` : '';
  const effortPart = model.effort !== undefined && model.effort !== '' ? ` (${model.effort})` : '';
  const body = `You are running as ${model.provider}${idPart}${effortPart}`;
  return authoredPush('baseline-model', 'which model the agent is running as', body, 'model');
}

/** Author the volatile environment Piece from the session-invariant facts (ordered last to keep the stable prefix cache-warm). */
function environmentPiece(ctx: BaselineContext): Piece {
  const lines = [`Platform: ${ctx.platform}`, `Shell: ${ctx.shell}`, `Date: ${ctx.date}`];
  return authoredPush(
    'baseline-environment',
    'the session runtime facts',
    lines.join('\n'),
    'volatile',
  );
}

/**
 * The stable authored guidance — identity, tone, and tool-use. Universal only:
 * task-specific conduct (e.g. code-editing discipline) lives in packages, not here.
 * Session-invariant, so it forms the cache-warm prefix; the agent-assembly
 * resolver inserts role/package/skill Pieces after it and the volatile tail last.
 */
export function baselineStablePieces(): Piece[] {
  return [IDENTITY, TONE, TOOL_USE];
}

/**
 * The volatile per-session tail — the environment block (platform + date). Ordered
 * last so the stable prefix stays cache-warm. The model id is deliberately
 * absent: the backend names its own model, and keeping it out keeps the compiled
 * prompt (and thus `promptVersion`) invariant across model switches.
 */
export function baselineVolatilePieces(ctx: BaselineContext): Piece[] {
  // The model piece renders in the `## Model` slot (right after identity) regardless
  // of its position in this array; it rides the per-session injection because it is
  // authored from the model selection, and a model switch recompiles the prompt.
  return [modelPiece(ctx.model), environmentPiece(ctx)];
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
 * clock. Role/scope Pieces and assembled context are concatenated later.
 */
export function createBaselineAssemblePieces(deps: {
  platform: string;
  shell: string;
  now?: () => Date;
}): (ctx: AssemblePiecesContext) => { pieces: Piece[]; frame: CapabilityFrame } {
  const now = deps.now ?? ((): Date => new Date());
  return (ctx) => ({
    pieces: baselinePieces({
      platform: deps.platform,
      shell: deps.shell,
      date: isoDate(now()),
      model: modelPromptOf(ctx),
    }),
    frame: EMPTY_FRAME,
  });
}

/** Resolve the model facts for the prompt from an {@link AssemblePiecesContext},
 *  defaulting the provider to `claude` (mirrors session.ts) and surfacing the
 *  reasoning effort only when the reasoning mode is `effort`. */
export function modelPromptOf(ctx: AssemblePiecesContext): ModelPrompt {
  const provider = ctx.model?.provider ?? 'claude';
  const model = ctx.model?.model;
  const effort = ctx.model?.reasoning?.mode === 'effort' ? ctx.model.reasoning.effort : undefined;
  return {
    provider,
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { effort } : {}),
  };
}
