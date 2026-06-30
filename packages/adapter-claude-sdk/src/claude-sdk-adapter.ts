import type {
  CapabilitySet,
  ContextPackage,
  NeutralConfig,
  Piece,
  Reminder,
  SessionConfig,
  SymbolRef,
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
import type { McpServerConfig, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { renderNative } from './render-native.js';
import { assembleSessionOptions } from './session-options.js';

/** The session-construction I/O M8 injects (D121) — defined here as M9's seam, not known by the core. */
export interface ClaudeSdkAdapterInit {
  sessionId: string;
  /** The per-session capability set from `M7.sandboxPolicy(sessionCtx)`. */
  sandbox: CapabilitySet;
  /** The session's prompt input (the human's turns, driven by M8). */
  input: string | AsyncIterable<SDKUserMessage>;
  /** Bridge each streamed SDK message to M8's WAL→Push consumer (R-12). Best-effort. */
  onMessage?: (message: SDKMessage) => void;
  /** M9's settlement step → `M7.charge(sessionId, cost)`, called once per settled result. */
  onSettle?: (sessionId: string, usage: RuntimeUsage) => void;
  /** The native mid-loop hard stop: `min(perSessionCeiling?, M7.capState().remaining)`. */
  maxBudgetUsd?: number;
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
  #mcpServers: Record<string, McpServerConfig> = {};
  #disallowedBuiltins: string[] = [];
  #lastUsage: RuntimeUsage = NO_USAGE;

  constructor(init: ClaudeSdkAdapterInit) {
    this.#init = init;
  }

  renderNative(neutralConfig: NeutralConfig): BackendConfig {
    this.#backend = renderNative(neutralConfig);
    return this.#backend;
  }

  registerTools(_catalogue: ToolCatalogue): void {
    // The MCP surface is built from M6's real tool handlers (createSdkMcpServer +
    // `tool(...)`); the `ToolCatalogue` port shape carries only names until M6
    // exists, so registration is a no-op floor (the loop runs with built-ins).
  }

  denyBuiltins(): void {
    // Ruling 3: denying the built-in whole-file `Edit` nudges the model onto the
    // diff-shaped Mutate path — a demotable default (M6 declares, M9 enforces).
    this.#disallowedBuiltins = ['Edit'];
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

    const mcpServers = Object.keys(this.#mcpServers).length > 0 ? this.#mcpServers : undefined;
    const options = assembleSessionOptions({
      sessionId: this.#init.sessionId,
      backend: {
        ...backend,
        disallowedTools: [...backend.disallowedTools, ...this.#disallowedBuiltins],
      },
      sandbox: this.#init.sandbox,
      canUseTool: this.#canUseTool,
      stopPredicate: this.#stopPredicate,
      ...(mcpServers ? { mcpServers } : {}),
      ...(this.#init.maxBudgetUsd !== undefined ? { maxBudgetUsd: this.#init.maxBudgetUsd } : {}),
    });

    for await (const message of query({
      prompt: this.#init.input,
      options: { ...options, cwd: sessionConfig.worktree },
    })) {
      this.#init.onMessage?.(message);
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
