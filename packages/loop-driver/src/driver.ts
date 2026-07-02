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
   * Called once the turn settles with the full conversation (system prompt omitted)
   * so the caller can persist it as the next turn's {@link history}. Not called if
   * the loop throws before settling.
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
  const usage: RuntimeUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  for (let i = 0; i < maxIterations; i += 1) {
    const result = await deps.complete(messages, tools);
    addUsage(usage, result.usage);
    if (result.text !== '') emit({ t: 'text', text: result.text });
    messages.push({
      role: 'assistant',
      content: result.text,
      ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
    });

    if (result.toolCalls.length === 0) {
      // The model wants to stop — the close-gate decides (SC-1). Allowed ⇒ settle & end;
      // blocked ⇒ inject the reason (as the SDK's Stop hook does) and let it continue.
      const decision = await deps.gate();
      if (decision.allow) break;
      messages.push({ role: 'user', content: decision.message });
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
      // Pair the result to its `tool_use` by the per-call handle (console correlation);
      // binding that handle to coa's raw store (`response.handle`) for getToolDetail is a follow-up.
      emit({ t: 'tool_result', handle, ok: true, pointer: response.pointer });
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify(response.result),
      });
    }
  }

  deps.onSettle?.(deps.sessionId, usage);
  // Hand back the whole conversation (system omitted — it's re-rendered each turn)
  // so the caller can persist it as the next turn's `history`.
  deps.onMessages?.(messages.slice(1));
}
