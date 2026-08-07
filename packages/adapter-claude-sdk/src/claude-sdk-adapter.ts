import type {
  BackendMessage,
  CapabilitySet,
  Locator,
  ModelSelection,
  NeutralConfig,
  SessionConfig,
  TurnFrame,
} from '@coa/shared';
import type {
  BackendConfig,
  CanUseTool,
  DrainDeliveries,
  RuntimeAdapter,
  RuntimeUsage,
  StopPredicate,
  ToolCatalogue,
  TurnInterrupt,
} from '@coa/spi';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { renderNative } from './render-native.js';
import { assembleSessionOptions } from './session-options.js';
import { toCoaMcpServer } from './mcp-tools.js';
import { resolveToolTransport } from './tool-frame.js';
import { sessionAuthEnv } from './auth-env.js';
import { messageToEnrichedFrames } from './enriched-frames.js';
import { withHistoryPreamble, withHistoryPreambleStreaming } from './history-preamble.js';
import { toSdkPrompt } from './session-input.js';

/** The session-construction I/O the daemon injects — defined here as the adapter's seam, not known by the core. */
export interface ClaudeSdkAdapterInit {
  sessionId: string;
  /** The per-session capability set from the governance sandbox policy. */
  sandbox: CapabilitySet;
  /**
   * The session's prompt input (the human's turns, driven by the daemon). Neutral: a
   * one-shot string or an async stream of user-turn strings — never an SDK type,
   * so a from-scratch backend targets the same seam.
   */
  input: string | AsyncIterable<string>;
  /**
   * Bridge each mapped neutral {@link TurnFrame} to the daemon's emission policy
   * (which sequences + wraps it into a `turn` Push). Best-effort; the SDK→frame
   * mapping is the adapter's ({@link messageToEnrichedFrames}), the wire vocabulary
   * is the shared schema's. `full`, present on a `tool_result`, is the complete body
   * the model saw — the append-only log's fidelity companion to the lossy `pointer`.
   */
  onTurn?: (frame: TurnFrame, full?: string) => void;
  /** The agent's model selection (model id + faithful reasoning config); absent ⇒ account/SDK defaults. */
  model?: ModelSelection;
  /** The adapter's settlement step → the governance ledger's charge, called once per settled result. */
  onSettle?: (sessionId: string, usage: RuntimeUsage) => void;
  /** The native mid-loop hard stop: the lesser of the per-session ceiling and the cost cap's remaining budget. */
  maxBudgetUsd?: number;
  /**
   * Record on-disk changes coa did not perform itself (the daemon's reconciler): the
   * adapter fires it after every tool call, since a native Edit — or any file a Bash
   * command touched — reaches the change-event spine through no other path. Absent ⇒
   * a no-op, so a caller that does not supply it behaves exactly as today.
   */
  observeChanges?: () => void;
  /**
   * Pull the session's pending deliveries (the daemon owns the queue). This backend realizes the
   * neutral intent by returning the text as `PostToolUse` additional context, so it
   * lands beside the next tool result — the loop's next round trip — instead of waiting
   * for the turn boundary. Absent ⇒ nothing is appended, byte-identical to today.
   */
  drainDeliveries?: DrainDeliveries;
  /** The active account's neutral login pointer (the daemon reads it from the registry); absent ⇒ ambient (today's auth). */
  locator?: Locator;
  /** A prior backend session id to resume (cross-turn continuity), so the model has the conversation's memory. */
  resume?: string;
  /** Report the backend's own session id (captured once from the stream) so the daemon can store it for the next resume. */
  onBackendSession?: (backendSessionId: string) => void;
  /**
   * The prior conversation transcript (system omitted). Unlike a pure-API
   * backend, Claude does NOT feed this to the model when resuming by id (the server
   * session already holds the memory) — it is carried here only for the cross-provider
   * switch INTO Claude, where the daemon delivers it as a first-turn context preamble
   * (there is no server session to resume). The canonical record itself is the
   * append-only event log, folded at read time — this adapter no longer reports a
   * transcript back for persistence.
   */
  history?: readonly BackendMessage[];
  /**
   * Deliver {@link history} to the model as a first-turn context preamble instead of
   * resuming (the cross-provider switch INTO Claude — no resumable server session
   * exists for this transcript). Ignored when there is no history or `resume` is set.
   */
  deliverHistoryAsPreamble?: boolean;
  /**
   * The SDK `query` primitive. Injectable so the loop can be unit-tested with a
   * scripted stream; defaults to the real `@anthropic-ai/claude-agent-sdk` import.
   */
  query?: typeof query;
  /**
   * The neutral user-stop the daemon hands every backend (a user interrupt, not a
   * governance block). Forwarded into a fresh `AbortController` the SDK owns
   * (`Options.abortController`); absent ⇒ no controller is built, byte-identical
   * to today.
   */
  signal?: AbortSignal;
  /**
   * Report this backend's turn-level interrupt UP to the daemon: a held-open
   * streaming-input `query` can stop its current turn while staying alive. Originally
   * built as a barge-in follow-up to streaming-input steering; with barge-in removed
   * (a steer is now recorded when the model receives it) this exists
   * solely for the user-Stop path (`setInterruptClosure`) — no other caller reaches it.
   * Called once, streaming-input only (the SDK `interrupt` control request is
   * streaming-input only). Absent input-string path ⇒ never called.
   */
  onTurnInterrupt?: (interrupt: TurnInterrupt) => void;
}

/**
 * Whether a throw out of `query()` is the enforced cost cap.
 *
 * The SDK raises the cap as a plain `Error` ("Reached maximum budget ($X)") with no
 * inspectable subtype and no `result` frame, so a message match is the only signal
 * available. Matching a vendor string is fragile, which is why the guard is narrow —
 * coa must have set a cap for this run — and the fallback is to rethrow. A missed match
 * degrades to today's generic error frame; it never swallows a real failure.
 */
function isCostCapStop(err: unknown, maxBudgetUsd: number | undefined): err is Error {
  return (
    maxBudgetUsd !== undefined &&
    err instanceof Error &&
    /reached maximum budget/i.test(err.message)
  );
}

/**
 * The one Claude Agent SDK backend implementation of the `RuntimeAdapter`
 * port. The pure halves (`renderNative`, the option/hook assembly) are the tested
 * core; `runLoop` drives the rented `query()` loop with the system's only two blocks
 * (close-gate + cost-cap) on the two SDK hooks.
 */
export class ClaudeSdkAdapter implements RuntimeAdapter {
  readonly #init: ClaudeSdkAdapterInit;
  #backend: BackendConfig | undefined;
  #canUseTool: CanUseTool | undefined;
  #stopPredicate: StopPredicate | undefined;
  #catalogue: ToolCatalogue = [];
  #disallowedBuiltins: string[] = [];

  constructor(init: ClaudeSdkAdapterInit) {
    this.#init = init;
  }

  renderNative(neutralConfig: NeutralConfig): BackendConfig {
    this.#backend = renderNative(neutralConfig);
    return this.#backend;
  }

  registerTools(catalogue: ToolCatalogue): void {
    // Store the governed catalogue; the in-process `coa` MCP server is built
    // per-run in `runLoop` from the resolved tool frame, so an agent registers
    // only the coa tools its packages grant. Each tool stays governed
    // (Zod-validate → dispatch → enrich) inside the core; the adapter only transports.
    // An empty catalogue leaves the loop on built-ins (the pass-through floor).
    this.#catalogue = catalogue;
  }

  denyBuiltins(): void {
    // Do NOT deny the built-in `Edit` by default. It is a targeted,
    // prior-backed, token-cheap edit (≈ the workbench's `edit_symbol`), and change-event
    // integrity is guaranteed by the reconciler, not by
    // tool-exclusivity — so denying it buys attribution, not correctness, at the
    // cost of the tool Claude is most fluent with. Demotion is now a *measured*
    // knob (v0-spike-gated), not a standing default; the machinery stays so a
    // future policy can populate `#disallowedBuiltins`.
    this.#disallowedBuiltins = [];
  }

  interceptTool(canUseTool: CanUseTool): void {
    this.#canUseTool = canUseTool;
  }

  interceptStop(stopPredicate: StopPredicate): void {
    this.#stopPredicate = stopPredicate;
  }

  async runLoop(sessionConfig: SessionConfig): Promise<void> {
    const backend = this.#backend;
    if (backend === undefined) {
      throw new Error('runLoop: renderNative must be called before runLoop');
    }
    if (this.#canUseTool === undefined || this.#stopPredicate === undefined) {
      throw new Error('runLoop: interceptTool and interceptStop must be wired before runLoop');
    }

    // Map the neutral capability frame (backend.allowedTools/disallowedTools) onto
    // the SDK tool transport: coa tools → `mcp__coa__*`, built-ins → the `tools`
    // availability set, and register only the granted coa tools. An empty frame is
    // the literal pass-through (every coa tool registered, no built-in restriction).
    const transport = resolveToolTransport({
      allow: backend.allowedTools,
      deny: backend.disallowedTools,
      coaToolNames: this.#catalogue.map((tool) => tool.name),
    });
    const registerSet = new Set(transport.registerCoaTools);
    const registered = this.#catalogue.filter((tool) => registerSet.has(tool.name));
    const mcpServers = registered.length > 0 ? { coa: toCoaMcpServer(registered) } : undefined;
    // The adapter's auth seam: map the active account's locator to the loop's login env
    // (select CLAUDE_CONFIG_DIR, clear the API-key/ambient-token vars). Absent
    // locator ⇒ no overlay ⇒ the subprocess inherits process.env (today's auth).
    const env = sessionAuthEnv(this.#init.locator);
    const model = this.#init.model;
    // The SDK wants an AbortController it owns; the daemon hands a neutral AbortSignal
    // (no SDK type crosses the seam — backends are swappable and never branched on).
    // Build a fresh controller and forward the neutral signal's abort into it — absent
    // signal ⇒ no controller, byte-identical to today.
    const signal = this.#init.signal;
    let abortController: AbortController | undefined;
    if (signal !== undefined) {
      abortController = new AbortController();
      if (signal.aborted) abortController.abort();
      else signal.addEventListener('abort', () => abortController?.abort(), { once: true });
    }
    const options = assembleSessionOptions({
      sessionId: this.#init.sessionId,
      backend: {
        ...backend,
        allowedTools: transport.autoApprove,
        disallowedTools: [...transport.disallowedTools, ...this.#disallowedBuiltins],
      },
      sandbox: this.#init.sandbox,
      canUseTool: this.#canUseTool,
      stopPredicate: this.#stopPredicate,
      ...(this.#init.observeChanges !== undefined
        ? { observeChanges: this.#init.observeChanges }
        : {}),
      ...(this.#init.drainDeliveries !== undefined
        ? { drainDeliveries: this.#init.drainDeliveries }
        : {}),
      ...(transport.tools ? { tools: transport.tools } : {}),
      ...(mcpServers ? { mcpServers } : {}),
      ...(this.#init.maxBudgetUsd !== undefined ? { maxBudgetUsd: this.#init.maxBudgetUsd } : {}),
      ...(model?.model !== undefined ? { model: model.model } : {}),
      ...(model?.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
      ...(env ? { env } : {}),
      ...(this.#init.resume !== undefined ? { resume: this.#init.resume } : {}),
      ...(abortController !== undefined ? { abortController } : {}),
    });

    // On a cross-provider switch into Claude there is no server session to resume, so
    // deliver the prior memory as a first-turn preamble — model delivery only, never
    // canonical memory (the append-only event log is that record now).
    const modelPrompt: string | AsyncIterable<string> =
      typeof this.#init.input === 'string'
        ? this.#init.deliverHistoryAsPreamble
          ? withHistoryPreamble(this.#init.input, this.#init.history ?? [])
          : this.#init.input
        : this.#init.deliverHistoryAsPreamble
          ? withHistoryPreambleStreaming(this.#init.input, this.#init.history ?? [])
          : this.#init.input;

    let backendSessionReported = false;
    const runQuery = this.#init.query ?? query;
    const sdkQuery = runQuery({
      prompt: toSdkPrompt(modelPrompt),
      options: { ...options, cwd: sessionConfig.worktree },
    });
    // Streaming-input only: the SDK's turn-level interrupt is a streaming-input control
    // request. A one-shot string turn has no held-open query to interrupt.
    if (typeof this.#init.input !== 'string' && this.#init.onTurnInterrupt !== undefined) {
      this.#init.onTurnInterrupt(() => sdkQuery.interrupt());
    }
    try {
      for await (const message of sdkQuery) {
        // Capture the backend's own session id once — the daemon stores it to `resume`
        // the conversation's memory on the next send.
        if (
          !backendSessionReported &&
          'session_id' in message &&
          typeof message.session_id === 'string'
        ) {
          backendSessionReported = true;
          this.#init.onBackendSession?.(message.session_id);
        }
        for (const { frame, full } of messageToEnrichedFrames(message))
          this.#init.onTurn?.(frame, full);
        if (message.type === 'result') {
          const usage: RuntimeUsage = {
            tokensIn: message.usage.input_tokens,
            tokensOut: message.usage.output_tokens,
            costUsd: message.total_cost_usd,
            cacheReadTokens: message.usage.cache_read_input_tokens,
          };
          this.#init.onSettle?.(this.#init.sessionId, usage);
        }
      }
    } catch (err) {
      if (!isCostCapStop(err, this.#init.maxBudgetUsd)) throw err;
      // The cap is a deliberate stop (one of the system's two sanctioned blocks), so it
      // settles the turn as a governed deny rather than propagating a crash to the
      // session's error path.
      // The boundary is REQUIRED, not decoration: the daemon resolves its turn driver on a
      // boundary, so a cap that emits only the deny would leave the session pending
      // forever. It carries no `terminal` — the SDK threw instead of producing a result,
      // so there is no terminal_reason to report, and `max_budget` is not a member of the
      // SDK's TerminalReason union, so inventing it would be a fiction.
      this.#init.onTurn?.({ t: 'deny', denyKind: 'cost-cap', reason: err.message });
      this.#init.onTurn?.({ t: 'turn-boundary', role: 'assistant' });
    }
  }
}
