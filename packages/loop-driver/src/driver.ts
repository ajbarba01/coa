import type { TurnFrame } from '@coa/shared';
import type {
  CanUseTool,
  CompleteFn,
  CompletionDelta,
  CompletionResult,
  DrainDeliveries,
  DriverMessage,
  RuntimeUsage,
  StopPredicate,
  ToolCatalogue,
  ToolDef,
} from '@coa/spi';

/**
 * The coa-owned governed loop driver — the ReAct loop the
 * Claude Agent SDK runs for its backend, reimplemented once here so every thin
 * pure-API backend reuses it. It owns the governance-critical machinery so it
 * lives in one audited place: the per-tool block, the close-gate, executing every
 * governed tool itself (producer ①, total visibility), and mapping each step to a
 * neutral {@link TurnFrame}. The only backend-specific surface it consumes is the
 * {@link CompleteFn} primitive; adding another pure API is just implementing that.
 *
 * Governance parity with the SDK backend: the per-tool cost-cap + governance
 * deny predicate is checked inline before any execution, and the close-gate runs
 * before the turn is allowed to end — a block injects the reason and the loop
 * continues rather than stopping. Neither ever throws (surface, don't cage).
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
  /** The governed tool catalogue; the driver executes `invoke` itself (producer ①). */
  catalogue: ToolCatalogue;
  /** The coa-authored system prompt (the compiled-config render → the scaffold + context). */
  systemPrompt: string;
  /** The user's turn. */
  input: string;
  /**
   * The prior conversation from the conversation store, minus the system prompt, replayed verbatim ahead
   * of `input` so a pure-API backend has memory across turns (a server-session
   * backend resumes by id instead). The WHOLE transcript is resent unmodified —
   * tool calls and results included — so the model stays coherent and the provider's
   * prefix/context cache hits on the identical leading prefix.
   */
  history?: readonly DriverMessage[];
  /** The per-tool block: cost-cap + governance deny, assembled by the session host (first-deny-wins, fail-closed). */
  canUseTool: CanUseTool;
  /** The close-gate run before the turn may end. */
  gate: StopPredicate;
  /**
   * Per-frame session output → the session host's emission policy (sequenced + pushed).
   * `full`, present on a `tool_result`, is the complete (uncapped) display body —
   * the append-only log's fidelity companion to the capped `pointer`.
   */
  onTurn?: (frame: TurnFrame, full?: string) => void;
  /** Settlement → the cost meter's charge, called once with the loop's summed usage. */
  onSettle?: (sessionId: string, usage: RuntimeUsage) => void;
  /** Override the round-trip bound (tests / tuning). */
  maxIterations?: number;
  /**
   * Record on-disk changes the loop did not make through a catalogue tool — a file a
   * Bash command wrote, for instance. Driven at the same boundary the Claude backend
   * drives it from (its `PostToolUse` hook), so both backends record the same facts.
   * Absent ⇒ byte-identical to today (a disabled feature degrades to a pass-through).
   */
  observeChanges?: () => void;
  /**
   * A user-initiated stop (interrupt), checked at the safe boundary — the top of
   * the loop. This is a user stop, not a governance block. Absent ⇒ current
   * behavior byte-identical. A steer no longer produces a whole-session stop signal —
   * it only ever lands on `session.deliveries`.
   */
  signal?: AbortSignal;
  /**
   * Pending mid-loop deliveries (user steers and system notices), drained at the top
   * of each round trip — the driver's soonest safe boundary, discarding nothing.
   * Absent ⇒ no deliveries, byte-identical to today (a disabled feature degrades to a pass-through).
   */
  drainDeliveries?: DrainDeliveries;
}

/** Map the governed catalogue to the model-facing tool list. */
export function toToolDefs(catalogue: ToolCatalogue): ToolDef[] {
  return catalogue.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // The governed tool's Zod raw shape; the concrete adapter converts it to its provider's
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
  const emit = (frame: TurnFrame, full?: string): void => deps.onTurn?.(frame, full);
  const tools = toToolDefs(deps.catalogue);
  const byName = new Map(deps.catalogue.map((tool) => [tool.name, tool] as const));
  const messages: DriverMessage[] = [
    { role: 'system', content: deps.systemPrompt },
    ...(deps.history ?? []),
    { role: 'user', content: deps.input },
  ];
  const usage: RuntimeUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  /**
   * Take everything pending and hand it to the model. One helper, two call sites (the
   * top of each round trip and the close-gate floor) — draining is destructive, so the
   * gate cannot defer to the top-of-loop drain, and two copies could diverge.
   *
   * A `system` entry rides the user role because the Messages API offers no other slot
   * for mid-conversation input; the notice framing keeps the model from reading an
   * automated report as the person speaking. No frame is emitted — core's drain closure
   * is the single writer of the log line.
   */
  const absorbDeliveries = (): boolean => {
    const pending = deps.drainDeliveries?.() ?? [];
    for (const delivery of pending) {
      messages.push({
        role: 'user',
        content: delivery.origin === 'user' ? delivery.text : `[coa notice] ${delivery.text}`,
      });
    }
    return pending.length > 0;
  };

  try {
    for (let i = 0; i < maxIterations; i += 1) {
      if (deps.signal?.aborted) break;
      // Mid-loop delivery, drained at the loop's soonest safe boundary (user/system
      // input injected, not a governance block).
      absorbDeliveries();
      // Drive the streaming round-trip: emit each delta live, then settle from the
      // generator's return value. Delta frames are delivery-only —
      // the session host's record policy pushes but never persists them.
      const it = deps.complete(messages, tools, deps.signal);
      let step: IteratorResult<CompletionDelta, CompletionResult>;
      try {
        step = await it.next();
        while (step.done !== true) {
          const delta = step.value;
          if (delta.kind === 'text') emit({ t: 'text-delta', text: delta.text });
          else emit({ t: 'thinking-delta', text: delta.text });
          step = await it.next();
        }
      } catch (err) {
        // A user interrupt mid-stream is not an error. The partial is NOT re-emitted
        // here — the session host's interrupt closure already settled it from the streamed deltas
        // and recorded the `interrupted` marker, so emitting it again would duplicate the block
        // (once from the live stream, once from this settled frame). Any other throw still propagates.
        if (deps.signal?.aborted === true) {
          break; // settle via the outer finally; interrupted-status suppression is the session host's job
        }
        throw err;
      }
      const result = step.value;
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
        // The model wants to stop — the close-gate decides (one of the system's two
        // sanctioned blocks). Allowed ⇒ settle & end;
        // blocked ⇒ inject the reason (as the SDK's Stop hook does) and let it continue.
        const decision = await deps.gate();
        if (decision.allow) {
          // The floor: text that arrived with no drain point left would otherwise be fed to
          // nobody — the person or the parent agent would get silence.
          if (absorbDeliveries()) continue;
          break;
        }
        messages.push({ role: 'user', content: decision.message });
        continue;
      }

      for (const call of result.toolCalls) {
        const handle = `${deps.sessionId}:${call.id}`;
        emit({ t: 'tool_use', tool: call.name, input: call.arguments, handle });
        // Per-tool block: the predicate is checked before any execution, so a
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
        // never throws and never denies (advisory only — surface, never block): a bad input comes back as an unapplied result.
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
        // `full` = `display`: the driver has no separate lossy/lossless bodies (unlike the
        // SDK's short pointer), so the append-only log gets the same text as the frame.
        emit({ t: 'tool_result', handle, ok, pointer: display }, display);
        messages.push({ role: 'tool', toolCallId: call.id, content: display });
        // Producer ② at the same boundary the SDK backend uses. coa executes this tool
        // itself, so its own writes are already on the spine — but a shell command can
        // touch anything, and only a worktree scan sees that.
        deps.observeChanges?.();
      }
    }
  } finally {
    // Settle on EVERY exit — clean end, model/fetch error, or (later) interrupt — so a
    // partial turn is still charged. The canonical transcript is the append-only event
    // log, not this in-memory array; `messages` (bounded per-tool by
    // `capToolResult`) exists only to resend the round-trip history to the model.
    deps.onSettle?.(deps.sessionId, usage);
  }
}
