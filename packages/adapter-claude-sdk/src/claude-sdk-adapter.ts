import type {
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
    });

    let backendSessionReported = false;
    for await (const message of query({
      prompt: toSdkPrompt(this.#init.input),
      options: { ...options, cwd: sessionConfig.worktree },
    })) {
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
      }
    }
  }
}
