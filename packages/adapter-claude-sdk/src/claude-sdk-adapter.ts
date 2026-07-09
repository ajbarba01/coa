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
} from '@coa/spi';
import { barebonesProfile, REFS_NULL_FALLBACK } from '@coa/spi';
import type { CapabilityProfile } from '@coa/shared';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { renderNative } from './render-native.js';
import { assembleSessionOptions } from './session-options.js';
import { toCoaMcpServer } from './mcp-tools.js';
import { resolveToolTransport } from './tool-frame.js';
import { sessionAuthEnv } from './auth-env.js';
import { messageToFrames } from './turn-frames.js';
import {
  dropTrailingDanglingToolCall,
  messageToBackendMessages,
  tapStreamedUserTurns,
} from './transcript.js';
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
   * mapping is M9's ({@link messageToFrames}), the wire vocabulary is M0's.
   */
  onTurn?: (frame: TurnFrame) => void;
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
   * session already holds the memory) — it is carried here only so the adapter can
   * append this turn and report the FULL canonical transcript back for persistence.
   * (On a cross-provider switch INTO Claude, where there is no server session to
   * resume, M8 additionally delivers it as a first-turn context preamble.)
   */
  history?: readonly BackendMessage[];
  /** Report the settled canonical transcript (system omitted) so M8 can persist it —
   *  the same neutral shape DeepSeek reports, making the memory provider-independent. */
  onBackendMessages?: (messages: readonly BackendMessage[]) => void;
  /**
   * Deliver {@link history} to the model as a first-turn context preamble instead of
   * resuming (the cross-provider switch INTO Claude — no resumable server session
   * exists for this transcript). The preamble carries the prior memory in-band; the
   * canonical transcript still records the raw turns, so what the agent sees matches
   * what the user sees. Ignored when there is no history or `resume` is set.
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

    // Accumulate the canonical neutral transcript: the prior history (carried for
    // bookkeeping — the server session already holds it when resuming), this turn's
    // raw user prompt, then every assistant/tool message the SDK streams. Reported
    // at settle so M8 persists it in the same shape DeepSeek uses (provider-neutral
    // memory). The one-shot string path has a single raw prompt, recorded here
    // directly; the streaming-input path (async iterable) has no single raw prompt —
    // each turn (the initial one, and any later steer) is recorded as it is consumed,
    // below, via `tapStreamedUserTurns` (D85: this branch is unchanged).
    const rawInput = typeof this.#init.input === 'string' ? this.#init.input : '';
    const transcript: BackendMessage[] = [...(this.#init.history ?? [])];
    if (rawInput !== '') transcript.push({ role: 'user', content: rawInput });

    // On a cross-provider switch into Claude there is no server session to resume, so
    // deliver the prior memory as a first-turn preamble. The raw turn is still what
    // the transcript records above (or, under streaming, what the tap records below)
    // — the preamble is model delivery only, never canonical memory. Under streaming
    // input, tap the feed so each consumed turn lands in `transcript` (same buffer,
    // same `onBackendMessages` report) at the moment it is pulled — ordered ahead of
    // that turn's assistant/tool messages, which arrive later off the outbound
    // stream. The preamble wrapper composes OUTSIDE the tap (wraps its output) so
    // the tap observes only the raw turn text, never the preamble-augmented one.
    const modelPrompt: string | AsyncIterable<string> =
      typeof this.#init.input === 'string'
        ? this.#init.deliverHistoryAsPreamble
          ? withHistoryPreamble(this.#init.input, this.#init.history ?? [])
          : this.#init.input
        : this.#init.deliverHistoryAsPreamble
          ? withHistoryPreambleStreaming(
              tapStreamedUserTurns(this.#init.input, transcript),
              this.#init.history ?? [],
            )
          : tapStreamedUserTurns(this.#init.input, transcript);

    let backendSessionReported = false;
    // Whether the transcript holds messages not yet flushed by a per-result flush.
    // Guards the `finally` net so a clean run that already flushed at its terminal
    // `result` does not flush a second, redundant time (the one-shot path stays a
    // single flush — D85); a pre-`result` throw/interrupt still flushes there.
    // A throw before the FIRST streamed message leaves `dirty` false, so that turn's
    // un-answered user text is intentionally not flushed — acceptable because the SDK
    // yields a system/init message before any network failure, setting `dirty`, so any
    // realistic mid-turn drop still reaches canonical memory.
    let dirty = false;
    const runQuery = this.#init.query ?? query;
    try {
      for await (const message of runQuery({
        prompt: toSdkPrompt(modelPrompt),
        options: { ...options, cwd: sessionConfig.worktree },
      })) {
        dirty = true;
        transcript.push(...messageToBackendMessages(message));
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
        if (this.#init.onTurn !== undefined) {
          for (const frame of messageToFrames(message)) this.#init.onTurn(frame);
        }
        if (message.type === 'result') {
          this.#lastUsage = {
            tokensIn: message.usage.input_tokens,
            tokensOut: message.usage.output_tokens,
            costUsd: message.total_cost_usd,
            cacheReadTokens: message.usage.cache_read_input_tokens,
          };
          this.#init.onSettle?.(this.#init.sessionId, this.#lastUsage);
          // Flush the canonical transcript at EACH turn boundary (every `result`), not
          // only at session end — so under the held-open streaming-input strategy
          // (docs/adr/0012) a crash loses only the in-flight turn, matching the one-shot
          // path's durability. Trimmed identically to the `finally` flush (A1
          // block-preserving: never end on a dangling tool_use). The one-shot string path
          // has a single terminal `result`, so this is that path's sole flush and stays
          // byte-identical (D85) — the `finally` net is skipped when nothing is unflushed.
          this.#init.onBackendMessages?.(dropTrailingDanglingToolCall(transcript));
          dirty = false;
        }
      }
    } finally {
      // The A1 net: flush unflushed work on an early exit (a pre-`result` throw or an
      // interrupt) — the model may have produced real blocks before the stream dropped;
      // they must reach canonical memory. Skipped when a terminal `result` already
      // flushed everything (`dirty === false`), so a clean run flushes exactly once
      // (D85). Usage is intentionally NOT settled here: the SDK exposes it only on the
      // terminal `result` (above), so a pre-`result` throw settles nothing — bounded by
      // the SDK's own `maxBudgetUsd`, not coa's ledger. Trimmed to drop a trailing
      // dangling tool_use (an interrupt or mid-tool error between an assistant's
      // tool_use and its tool_result): a cross-provider switch replays this transcript
      // as structured history, and an OpenAI-compatible endpoint 400s on an assistant
      // tool_calls turn with no matching tool results.
      if (dirty) this.#init.onBackendMessages?.(dropTrailingDanglingToolCall(transcript));
    }
  }
}
