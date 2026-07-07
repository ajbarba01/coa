import type { TurnFrame } from '@coa/shared';
import type { CanUseTool, RuntimeUsage, StopPredicate, ToolCatalogue } from '@coa/spi';
import type { CompleteFn, DriverMessage, ToolDef } from './complete.js';

/**
 * The coa-owned governed loop driver (dual-backend spec C2) — the ReAct loop the
 * Claude Agent SDK runs for its backend, reimplemented once here so every thin
 * pure-API backend reuses it. It owns the governance-critical machinery so it
 * lives in one audited place: the per-tool block, the close-gate, executing every
 * governed tool itself (producer ①, total visibility), and mapping each step to a
 * neutral {@link TurnFrame}. The only backend-specific surface it consumes is the
 * {@link CompleteFn} primitive; adding another pure API is just implementing that.
 *
 * Governance parity with the SDK backend (spec Part E): the per-tool cost-cap + M3
 * deny predicate is checked inline before any execution, and the close-gate runs
 * before the turn is allowed to end — a block injects the reason and the loop
 * continues rather than stopping. Neither ever throws (SC-1: surface, don't cage).
 */

/** A hard bound on model round-trips — a fail-safe against a non-terminating loop. */
export const DEFAULT_MAX_ITERATIONS = 24;

/**
 * A catastrophe backstop on how many characters of any single tool result may enter
 * the resent transcript. Per-tool handlers do the primary bounding (Read line/char
 * caps, Bash/Grep output caps); this is the defense-in-depth net that keeps an
 * uncapped or future tool — or a pathological result — from poisoning every later
 * turn, since the pure-API loop resends the whole history each round-trip. Sized well
 * above the per-tool caps so a normally-capped result is never clipped. The verbatim
 * raw store (getToolDetail) keeps the full result; only the resent copy is bounded.
 */
export const TOOL_RESULT_CHAR_CAP = 200_000;

/** Bound a tool-result string for the transcript, appending a marker when it truncates. */
export function capToolResult(content: string, cap = TOOL_RESULT_CHAR_CAP): string {
  if (content.length <= cap) return content;
  return `${content.slice(0, cap)}\n\n[truncated by coa: showing ${cap} of ${content.length} chars]`;
}

export interface GovernedLoopDeps {
  sessionId: string;
  /** The one backend-specific surface — a pure model round-trip. */
  complete: CompleteFn;
  /** M6's governed tool catalogue; the driver executes `invoke` itself (producer ①). */
  catalogue: ToolCatalogue;
  /** The coa-authored system prompt (M5 render → the scaffold + context). */
  systemPrompt: string;
  /** The user's turn. */
  input: string;
  /**
   * The prior conversation (R-7), minus the system prompt, replayed verbatim ahead
   * of `input` so a pure-API backend has memory across turns (a server-session
   * backend resumes by id instead). The WHOLE transcript is resent unmodified —
   * tool calls and results included — so the model stays coherent and the provider's
   * prefix/context cache hits on the identical leading prefix.
   */
  history?: readonly DriverMessage[];
  /**
   * Called once the turn settles — cleanly, OR on a model/fetch error (or, later, an
   * interrupt) — with the full conversation (system prompt omitted) so the caller can
   * persist it as the next turn's {@link history}. Every *completed* block is included;
   * the block in flight when a throw happened is excluded by construction, so the
   * persisted transcript is always block-consistent.
   */
  onMessages?: (messages: readonly DriverMessage[]) => void;
  /** The per-tool block: cost-cap + M3 deny, assembled by M8 (first-deny-wins, fail-closed). */
  canUseTool: CanUseTool;
  /** The close-gate (M3.gate) run before the turn may end. */
  gate: StopPredicate;
  /** Per-frame session output → M8's emission policy (sequenced + pushed, R-12). */
  onTurn?: (frame: TurnFrame) => void;
  /** Settlement → M7.charge, called once with the loop's summed usage. */
  onSettle?: (sessionId: string, usage: RuntimeUsage) => void;
  /** Override the round-trip bound (tests / tuning). */
  maxIterations?: number;
}

/** Map the governed catalogue to the model-facing tool list. */
export function toToolDefs(catalogue: ToolCatalogue): ToolDef[] {
  return catalogue.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // The M6 Zod raw shape; the concrete adapter converts it to its provider's
    // tool-parameter format (JSON schema), so the driver stays provider-neutral.
    parameters: tool.inputSchema,
  }));
}

/** Fold one completion's usage into the running total (cache reads summed when present). */
function addUsage(total: RuntimeUsage, next: RuntimeUsage): void {
  total.tokensIn += next.tokensIn;
  total.tokensOut += next.tokensOut;
  total.costUsd += next.costUsd;
  if (next.cacheReadTokens !== undefined) {
    total.cacheReadTokens = (total.cacheReadTokens ?? 0) + next.cacheReadTokens;
  }
}

/** Drive the governed ReAct loop for one session. Runs to a clean close-gate or the round-trip bound. */
export async function runGovernedLoop(deps: GovernedLoopDeps): Promise<void> {
  const emit = (frame: TurnFrame): void => deps.onTurn?.(frame);
  const tools = toToolDefs(deps.catalogue);
  const byName = new Map(deps.catalogue.map((tool) => [tool.name, tool] as const));
  const messages: DriverMessage[] = [
    { role: 'system', content: deps.systemPrompt },
    ...(deps.history ?? []),
    { role: 'user', content: deps.input },
  ];
  // The `[system, ...history, user]` state above is round-trip-consistent (no dangling
  // tool_use). Advanced only when `messages` returns to a consistent boundary, so a throw
  // mid round-trip flushes the last consistent prefix instead of a dangling tool call.
  let lastConsistent = messages.length;
  const usage: RuntimeUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  try {
    for (let i = 0; i < maxIterations; i += 1) {
      const result = await deps.complete(messages, tools);
      addUsage(usage, result.usage);
      // Reasoning precedes the answer (pre-answer thinking). Display-only: emitted as a
      // thinking frame but never pushed into `messages` — the API rejects reasoning on input.
      if (result.reasoning !== undefined && result.reasoning !== '') {
        emit({ t: 'thinking', text: result.reasoning });
      }
      if (result.text !== '') emit({ t: 'text', text: result.text });
      messages.push({
        role: 'assistant',
        content: result.text,
        ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
      });

      if (result.toolCalls.length === 0) {
        // A plain answer carries no pending tool_use — consistent as soon as it's pushed,
        // so a clean `break` right below still flushes it.
        lastConsistent = messages.length;
        // The model wants to stop — the close-gate decides (SC-1). Allowed ⇒ settle & end;
        // blocked ⇒ inject the reason (as the SDK's Stop hook does) and let it continue.
        const decision = await deps.gate();
        if (decision.allow) break;
        messages.push({ role: 'user', content: decision.message });
        lastConsistent = messages.length;
        continue;
      }

      for (const call of result.toolCalls) {
        const handle = `${deps.sessionId}:${call.id}`;
        emit({ t: 'tool_use', tool: call.name, input: call.arguments, handle });
        // Per-tool block (Part E): the predicate is checked before any execution, so a
        // denied call never runs — the deny reason goes back to the model as the result.
        const decision = await deps.canUseTool({
          tool: call.name,
          args: call.arguments,
          sessionId: deps.sessionId,
        });
        if (decision.behavior === 'deny') {
          emit({ t: 'tool_result', handle, ok: false, pointer: decision.message });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: `denied by coa governance: ${decision.message}`,
          });
          continue;
        }
        const tool = byName.get(call.name);
        if (tool === undefined) {
          const message = `unknown tool: ${call.name}`;
          emit({ t: 'tool_result', handle, ok: false, pointer: message });
          messages.push({ role: 'tool', toolCallId: call.id, content: message });
          continue;
        }
        // coa executes every governed tool itself (producer ①) → total visibility. `invoke`
        // never throws and never denies (SC-1): a bad input comes back as an unapplied result.
        const response = await tool.invoke(call.arguments);
        // A pure-API backend has no SDK-rendered result text, so the tool renders its own
        // structured `result` to human-readable display text (its `pointer` is only a terse
        // handle — often the INPUT). That text is used for BOTH the frame the console shows
        // and the model's tool message; capped for the resent transcript either way.
        const display = capToolResult(
          tool.render?.(response.result) ?? JSON.stringify(response.result),
        );
        // The tool owns its result shape, so it owns the success predicate: a pure-API backend
        // has no SDK error signal, so `ok` (the frame's ✓/✗ + the console's red error body)
        // comes from the tool. Absent ⇒ presume success. Pair the result to its `tool_use` by
        // the per-call handle (console correlation); binding that handle to coa's raw store
        // (`response.handle`) for getToolDetail is a follow-up.
        const ok = tool.ok?.(response.result) ?? true;
        emit({ t: 'tool_result', handle, ok, pointer: display });
        messages.push({ role: 'tool', toolCallId: call.id, content: display });
      }
      // Every call's result is in — the round-trip is answered, so this is a consistent
      // boundary again.
      lastConsistent = messages.length;
    }
  } finally {
    // Flush on EVERY exit — clean settle, model/fetch error, or (later) interrupt — so the
    // canonical transcript records every completed block and a partial turn is still charged.
    // Trimmed to `lastConsistent`: a throw between pushing an assistant message that carries
    // `toolCalls` and pushing its tool results would otherwise leave the flushed transcript
    // ending in an unanswered tool_use — a permanent 400 on replay to an OpenAI-compatible
    // endpoint next turn. On every clean exit `lastConsistent === messages.length`, so this
    // is a no-op slice and existing behavior is unchanged.
    deps.onSettle?.(deps.sessionId, usage);
    deps.onMessages?.(messages.slice(1, lastConsistent));
  }
}
