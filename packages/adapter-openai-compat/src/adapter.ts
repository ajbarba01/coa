import type {
  Attachment,
  BackendMessage,
  Locator,
  McpServerEntry,
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
} from '@coa/spi';
import { runGovernedLoop } from '@coa/loop-driver';
import { renderSystemPrompt } from './render.js';
import { resolveApiKey } from './credentials.js';
import { makeOpenAiCompatComplete, type FetchLike } from './complete.js';
import { loadPriceTable, type PriceTable, type ProviderSpec } from './provider-spec.js';

/**
 * The OpenAI-compatible backend — a **thin** `RuntimeAdapter` parameterized by a
 * {@link ProviderSpec}. All the agentic machinery lives in the shared
 * {@link runGovernedLoop} driver; this adapter only renders the neutral config to a
 * system prompt, resolves the API key from the account's pointer, builds the
 * `complete()` primitive, and hands the loop the close-gate and per-tool deny
 * predicates. It imports no provider SDK (just `fetch`), so
 * adding another pure API is a new spec object, the same shape.
 */

export interface OpenAiCompatAdapterInit {
  sessionId: string;
  /** The session's prompt input (neutral); the one-shot prompt is the first turn. */
  input: string | AsyncIterable<string>;
  model?: ModelSelection;
  /** The adapter's settlement step → the governance ledger's charge, called once with the loop's summed usage. */
  onSettle?: (sessionId: string, usage: RuntimeUsage) => void;
  /**
   * Per-frame session output → the daemon's emission policy. `full`, present on a
   * `tool_result`, is the complete display body — the append-only log's fidelity
   * companion to the frame's lossy `pointer`; forwarded unchanged from
   * the governed loop driver, which already supplies it.
   */
  onTurn?: (frame: TurnFrame, full?: string) => void;
  /** The prior conversation transcript (system omitted), resent verbatim for cross-turn memory — a pure chat API has no server-side session to `resume`. */
  history?: readonly BackendMessage[];
  /** Attachments on THIS turn's live user message (images/text files). */
  attachments?: readonly Attachment[];
  /**
   * Whether the active model reports vision support (from the model-metadata
   * catalog) — gates whether an `image` attachment reaches the wire or is rejected
   * with a typed `AttachmentCapabilityError`. Absent ⇒ `false`.
   */
  visionSupported?: boolean;
  /** The account's login pointer (an env-var/key-file pointer); absent ⇒ the spec's default key var. */
  locator?: Locator;
  /**
   * The library-resolved external MCP servers the session ASKED for. This backend
   * has no MCP runtime (a pure chat API + coa's own governed tools), so it cannot
   * honor them — the honest degrade is a typed error frame naming the unavailable
   * servers at loop start (the session carries the fact; strict-superset — a
   * feature this backend lacks is surfaced, never silently pretended). Absent or
   * empty ⇒ byte-identical to before.
   */
  mcpServers?: Record<string, McpServerEntry>;
  /**
   * Record on-disk changes no governed tool made (the daemon's reconciler). Fired after
   * every tool call: coa executes its own tools, but a shell command can touch anything
   * and only a worktree scan sees that. Absent ⇒ byte-identical to today (the feature
   * degrades to a pass-through).
   */
  observeChanges?: () => void;
  /** Injectable seams (tests / config). */
  env?: Record<string, string | undefined>;
  baseUrl?: string;
  prices?: PriceTable;
  fetchImpl?: FetchLike;
  /**
   * The neutral user-stop from the daemon, forwarded into the governed loop so an
   * interrupt aborts the in-flight HTTP request; a user stop, not a governance block.
   */
  signal?: AbortSignal;
  /**
   * A synchronous drain of the session's pending mid-loop deliveries (a user steer, a
   * system notice) from the daemon. Not a turn: the governed loop injects it as a
   * message at the top of its next round trip, inside the turn already running.
   * Absent ⇒ nothing is delivered, byte-identical to today.
   */
  drainDeliveries?: DrainDeliveries;
}

/** The one-shot prompt: a string as-is, or the first turn of a stream. */
async function firstPrompt(input: string | AsyncIterable<string>): Promise<string> {
  if (typeof input === 'string') return input;
  for await (const chunk of input) return chunk;
  return '';
}

export class OpenAiCompatAdapter implements RuntimeAdapter {
  readonly #spec: ProviderSpec;
  readonly #init: OpenAiCompatAdapterInit;
  #backend: BackendConfig | undefined;
  #canUseTool: CanUseTool | undefined;
  #stopPredicate: StopPredicate | undefined;
  #catalogue: ToolCatalogue = [];

  constructor(spec: ProviderSpec, init: OpenAiCompatAdapterInit) {
    this.#spec = spec;
    this.#init = init;
  }

  renderNative(neutralConfig: NeutralConfig): BackendConfig {
    this.#backend = {
      systemPrompt: renderSystemPrompt(neutralConfig),
      allowedTools: neutralConfig.toolIntents.allow,
      disallowedTools: neutralConfig.toolIntents.deny,
      perAgent: {},
    };
    return this.#backend;
  }

  registerTools(catalogue: ToolCatalogue): void {
    this.#catalogue = catalogue;
  }

  /** A pure chat API has no built-in tools to demote — coa supplies every tool. */
  denyBuiltins(): void {}

  interceptTool(canUseTool: CanUseTool): void {
    this.#canUseTool = canUseTool;
  }

  interceptStop(stopPredicate: StopPredicate): void {
    this.#stopPredicate = stopPredicate;
  }

  async runLoop(_sessionConfig: SessionConfig): Promise<void> {
    const backend = this.#backend;
    if (backend === undefined)
      throw new Error('runLoop: renderNative must be called before runLoop');
    if (this.#canUseTool === undefined || this.#stopPredicate === undefined) {
      throw new Error('runLoop: interceptTool and interceptStop must be called before runLoop');
    }
    const apiKey = resolveApiKey(this.#spec, this.#init.locator, this.#init.env);
    if (apiKey === undefined) {
      throw new Error(
        `${this.#spec.id}: no API key — set ${this.#spec.apiKeyEnvVar} or add an env-var account`,
      );
    }
    // MCP degrade, surfaced BEFORE the loop runs: this backend has no MCP runtime,
    // so a session that asked for external servers is told so on its own turn
    // stream (recorded like any loop-origin advisory), never silently shorted.
    const unavailableMcp = Object.keys(this.#init.mcpServers ?? {});
    if (unavailableMcp.length > 0) {
      this.#init.onTurn?.({
        t: 'error',
        origin: 'loop',
        message: `the ${this.#spec.id} backend has no MCP support — configured server(s) unavailable this session: ${unavailableMcp.join(', ')}`,
      });
    }
    const reasoning = this.#init.model?.reasoning;
    const complete = makeOpenAiCompatComplete(this.#spec, {
      apiKey,
      model: this.#init.model?.model ?? this.#spec.defaultModel,
      prices: this.#init.prices ?? loadPriceTable(this.#spec, this.#init.env),
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(this.#init.baseUrl !== undefined ? { baseUrl: this.#init.baseUrl } : {}),
      ...(this.#init.fetchImpl !== undefined ? { fetchImpl: this.#init.fetchImpl } : {}),
      ...(this.#init.visionSupported !== undefined
        ? { visionSupported: this.#init.visionSupported }
        : {}),
      // Everything the driver resends ahead of THIS turn's own live user message — the
      // compiled system prompt (+1) plus the replayed prior conversation — is history:
      // an old attachment in that span must degrade, never hard-fail a turn that never
      // touched it (see complete.ts's `historyBoundary`).
      historyBoundary: 1 + (this.#init.history?.length ?? 0),
    });
    await runGovernedLoop({
      sessionId: this.#init.sessionId,
      complete,
      catalogue: this.#catalogue,
      systemPrompt: backend.systemPrompt,
      input: await firstPrompt(this.#init.input),
      ...(this.#init.history !== undefined ? { history: this.#init.history } : {}),
      ...(this.#init.attachments !== undefined ? { attachments: this.#init.attachments } : {}),
      canUseTool: this.#canUseTool,
      gate: this.#stopPredicate,
      ...(this.#init.onTurn !== undefined ? { onTurn: this.#init.onTurn } : {}),
      ...(this.#init.signal !== undefined ? { signal: this.#init.signal } : {}),
      ...(this.#init.drainDeliveries !== undefined
        ? { drainDeliveries: this.#init.drainDeliveries }
        : {}),
      ...(this.#init.observeChanges !== undefined
        ? { observeChanges: this.#init.observeChanges }
        : {}),
      ...(this.#init.onSettle !== undefined ? { onSettle: this.#init.onSettle } : {}),
    });
  }
}
