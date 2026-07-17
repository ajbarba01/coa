import type {
  BackendMessage,
  CapabilitySet,
  ContextPackage,
  Locator,
  ModelSelection,
  NeutralConfig,
  Piece,
  Reminder,
  SessionConfig,
  SymbolRef,
  TurnFrame,
} from '@coa/shared';
import type {
  BackendConfig,
  CacheBreakpoints,
  CanUseTool,
  EvalCorpus,
  EvalResult,
  ReminderAt,
  RuntimeAdapter,
  RuntimeUsage,
  StopPredicate,
  SymbolReference,
  ToolCatalogue,
  TurnInterrupt,
} from '@coa/spi';
import { barebonesProfile, REFS_NULL_FALLBACK } from '@coa/spi';
import type { CapabilityProfile } from '@coa/shared';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { renderNative } from './render-native.js';
import { assembleSessionOptions } from './session-options.js';
import { toCoaMcpServer } from './mcp-tools.js';
import { resolveToolTransport } from './tool-frame.js';
import { sessionAuthEnv } from './auth-env.js';
import { messageToEnrichedFrames } from './enriched-frames.js';
import { withHistoryPreamble, withHistoryPreambleStreaming } from './history-preamble.js';
import { toSdkPrompt } from './session-input.js';

/** The session-construction I/O M8 injects (D121) — defined here as M9's seam, not known by the core. */
export interface ClaudeSdkAdapterInit {
  sessionId: string;
  /** The per-session capability set from `M7.sandboxPolicy(sessionCtx)`. */
  sandbox: CapabilitySet;
  /**
   * The session's prompt input (the human's turns, driven by M8). Neutral: a
   * one-shot string or an async stream of user-turn strings — never an SDK type,
   * so a from-scratch backend targets the same seam.
   */
  input: string | AsyncIterable<string>;
  /**
   * Bridge each mapped neutral {@link TurnFrame} to M8's emission policy (which
   * sequences + wraps it into a `turn` Push, R-12). Best-effort; the SDK→frame
   * mapping is M9's ({@link messageToEnrichedFrames}), the wire vocabulary is M0's.
   * `full`, present on a `tool_result`, is the complete body the model saw — the
   * append-only log's fidelity companion to the lossy `pointer` (docs/adr/0010).
   */
  onTurn?: (frame: TurnFrame, full?: string) => void;
  /** The agent's model selection (model id + faithful reasoning config); absent ⇒ account/SDK defaults. */
  model?: ModelSelection;
  /** M9's settlement step → `M7.charge(sessionId, cost)`, called once per settled result. */
  onSettle?: (sessionId: string, usage: RuntimeUsage) => void;
  /** The native mid-loop hard stop: `min(perSessionCeiling?, M7.capState().remaining)`. */
  maxBudgetUsd?: number;
  /** The active account's neutral login pointer (M8 from the registry); absent ⇒ ambient (today's auth). */
  locator?: Locator;
  /** A prior backend session id to resume (R-7 continuity), so the model has the conversation's memory. */
  resume?: string;
  /** Report the backend's own session id (captured once from the stream) so M8 can store it for the next resume. */
  onBackendSession?: (backendSessionId: string) => void;
  /**
   * The prior conversation transcript (R-7, system omitted). Unlike a pure-API
   * backend, Claude does NOT feed this to the model when resuming by id (the server
   * session already holds the memory) — it is carried here only for the cross-provider
   * switch INTO Claude, where M8 delivers it as a first-turn context preamble (there is
   * no server session to resume). The canonical record itself is the append-only event
   * log (docs/adr/0010), folded at read time — this adapter no longer reports a
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
   * The neutral user-stop M8 hands every backend (SC-1 — a user interrupt, not a
   * governance block). Forwarded into a fresh `AbortController` the SDK owns
   * (`Options.abortController`); absent ⇒ no controller is built, byte-identical
   * to today (D85).
   */
  signal?: AbortSignal;
  /**
   * Report this backend's turn-level interrupt UP to M8 (docs/adr/0012 barge-in
   * follow-up): a held-open streaming-input `query` can stop its current turn while
   * staying alive. Called once, streaming-input only (the SDK `interrupt` control
   * request is streaming-input only). Absent input-string path ⇒ never called (D85).
   */
  onTurnInterrupt?: (interrupt: TurnInterrupt) => void;
}

const NO_USAGE: RuntimeUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

/**
 * The one Claude Agent SDK backend implementation of the M9 `RuntimeAdapter`
 * port. The pure halves (`renderNative`, the option/hook assembly) are the tested
 * core; `runLoop` drives the rented `query()` loop with the two SC-1 blocks on
 * the two SDK hooks. High-fidelity ports (`refs` via tsserver, `runEval` via the
 * secondary path, the context-delivery + cache ports) sit at their honest floor
 * state, advertised through {@link capabilityProfile} (the barebones baseline).
 */
export class ClaudeSdkAdapter implements RuntimeAdapter {
  readonly #init: ClaudeSdkAdapterInit;
  #backend: BackendConfig | undefined;
  #canUseTool: CanUseTool | undefined;
  #stopPredicate: StopPredicate | undefined;
  #catalogue: ToolCatalogue = [];
  #disallowedBuiltins: string[] = [];
  #lastUsage: RuntimeUsage = NO_USAGE;

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
    // (Zod-validate → dispatch → enrich) inside the core; M9 only transports.
    // An empty catalogue leaves the loop on built-ins (D85 floor).
    this.#catalogue = catalogue;
  }

  denyBuiltins(): void {
    // D-T2: do NOT deny the built-in `Edit` by default. It is a targeted,
    // prior-backed, token-cheap edit (≈ M6's `edit_symbol`), and change-event
    // integrity is guaranteed by the reconciler (D81 producer ②), not by
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

  deliverReminder(_reminder: Reminder, _at: ReminderAt): void {
    // Floor: standing authority is delivered at session start via the rendered
    // systemPrompt (renderNative). Mid-session delivery (PostToolUse /
    // UserPromptSubmit `additionalContext`) is the enhancement layer (D108/D133).
  }

  render_context(_pkg: ContextPackage): void {
    // The assembled-context delivery (L-ASM) is the M4 enhancement layer; the
    // floor delivers context through the rendered systemPrompt.
  }

  inject_runtime(_slice: readonly Piece[]): void {
    // In-flight scope-push (SCO-4) is the enhancement layer; barebones marks it absent.
  }

  cache_control(_breakpoints: CacheBreakpoints): void {
    // No prompt-cache breakpoints in the floor; barebones marks this absent.
  }

  usageTelemetry(): RuntimeUsage {
    return this.#lastUsage;
  }

  capabilityProfile(): CapabilityProfile {
    return barebonesProfile;
  }

  refs(_symbol: SymbolRef): SymbolReference[] | null {
    // tsserver backend not yet wired → null-fallback; the caller degrades to the
    // M2 tree-sitter floor (D144).
    return REFS_NULL_FALLBACK;
  }

  runEval(_corpus: EvalCorpus): Promise<EvalResult> {
    // The golden-corpus eval rides the D117 secondary direct-call path, which is
    // not wired yet (advertised absent in the barebones profile). Fail loudly
    // rather than return a vacuous pass that a self-mod guard would trust.
    return Promise.reject(new Error('runEval: secondary-path eval backend is not wired'));
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
    // the D85 pass-through (every coa tool registered, no built-in restriction).
    const transport = resolveToolTransport({
      allow: backend.allowedTools,
      deny: backend.disallowedTools,
      coaToolNames: this.#catalogue.map((tool) => tool.name),
    });
    const registerSet = new Set(transport.registerCoaTools);
    const registered = this.#catalogue.filter((tool) => registerSet.has(tool.name));
    const mcpServers = registered.length > 0 ? { coa: toCoaMcpServer(registered) } : undefined;
    // The M9 auth seam: map the active account's locator to the loop's login env
    // (select CLAUDE_CONFIG_DIR, clear the API-key/ambient-token vars). Absent
    // locator ⇒ no overlay ⇒ the subprocess inherits process.env (today's auth).
    const env = sessionAuthEnv(this.#init.locator);
    const model = this.#init.model;
    // The SDK wants an AbortController it owns; M8 hands a neutral AbortSignal
    // (no SDK type crosses the seam, ADR 0002/0004). Build a fresh controller and
    // forward the neutral signal's abort into it — absent signal ⇒ no controller,
    // byte-identical to today (D85).
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
        allowedTools: transport.allowedTools,
        disallowedTools: [...transport.disallowedTools, ...this.#disallowedBuiltins],
      },
      sandbox: this.#init.sandbox,
      canUseTool: this.#canUseTool,
      stopPredicate: this.#stopPredicate,
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
    // canonical memory (the append-only event log, docs/adr/0010, is that record now).
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
    // request. A one-shot string turn has no held-open query to interrupt (D85).
    if (typeof this.#init.input !== 'string' && this.#init.onTurnInterrupt !== undefined) {
      this.#init.onTurnInterrupt(() => sdkQuery.interrupt());
    }
    for await (const message of sdkQuery) {
      // Capture the backend's own session id once — M8 stores it to `resume` the
      // conversation's memory on the next send (R-7 continuity).
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
        this.#lastUsage = {
          tokensIn: message.usage.input_tokens,
          tokensOut: message.usage.output_tokens,
          costUsd: message.total_cost_usd,
          cacheReadTokens: message.usage.cache_read_input_tokens,
        };
        this.#init.onSettle?.(this.#init.sessionId, this.#lastUsage);
      }
    }
  }
}
