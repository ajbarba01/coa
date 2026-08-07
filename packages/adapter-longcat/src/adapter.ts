import type {
  BackendMessage,
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
} from '@coa/spi';
import { runGovernedLoop } from '@coa/loop-driver';
import { renderSystemPrompt } from './render.js';
import { resolveApiKey } from './credentials.js';
import { loadPriceTable, type PriceTable } from './pricing.js';
import {
  makeLongCatComplete,
  DEFAULT_MODEL,
  type LongCatReasoning,
  type FetchLike,
} from './complete.js';

/**
 * The LongCat backend — a **thin** `RuntimeAdapter`. All the agentic machinery lives in
 * the shared {@link runGovernedLoop} driver; this adapter only renders the neutral config
 * to a system prompt, resolves the API key from the account's pointer, builds the
 * `complete()` primitive, and hands the loop the close-gate and cost-cap predicates
 * (the system's only two blocks). It imports no provider SDK.
 */

export interface LongCatAdapterInit {
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
  /** The prior conversation transcript (system omitted), resent verbatim for cross-turn memory. */
  history?: readonly BackendMessage[];
  /** The account's login pointer (an env-var/key-file pointer); absent ⇒ the default key var. */
  locator?: Locator;
  /** Accepted so every backend shares the same session-construction contract; a raw chat API has no native mid-loop hard stop. */
  maxBudgetUsd?: number;
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
  /**
   * Record on-disk changes no governed tool made (the daemon's reconciler). Fired after
   * every tool call: coa executes its own tools, but a shell command can touch anything
   * and only a worktree scan sees that. Absent ⇒ byte-identical to today (the feature
   * degrades to a pass-through).
   */
  observeChanges?: () => void;
}

/**
 * Map coa's faithful reasoning selection to LongCat's real surface: `off` → thinking
 * disabled; any effort → thinking enabled; `budget`/absent → the model default (nothing
 * sent). LongCat has no graded `reasoning_effort`, so effort level is not forwarded.
 */
function toLongCatReasoning(reasoning: ModelSelection['reasoning']): LongCatReasoning | undefined {
  if (reasoning === undefined) return undefined;
  if (reasoning.mode === 'off') return { kind: 'disabled' };
  if (reasoning.mode === 'effort') return { kind: 'enabled' };
  return undefined;
}

/** The one-shot prompt: a string as-is, or the first turn of a stream. */
async function firstPrompt(input: string | AsyncIterable<string>): Promise<string> {
  if (typeof input === 'string') return input;
  for await (const chunk of input) return chunk;
  return '';
}

export class LongCatAdapter implements RuntimeAdapter {
  readonly #init: LongCatAdapterInit;
  #backend: BackendConfig | undefined;
  #canUseTool: CanUseTool | undefined;
  #stopPredicate: StopPredicate | undefined;
  #catalogue: ToolCatalogue = [];

  constructor(init: LongCatAdapterInit) {
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
    const apiKey = resolveApiKey(this.#init.locator, this.#init.env);
    if (apiKey === undefined) {
      throw new Error('longcat: no API key — set LONGCAT_API_KEY or add an env-var account');
    }
    const reasoning = toLongCatReasoning(this.#init.model?.reasoning);
    const complete = makeLongCatComplete({
      apiKey,
      model: this.#init.model?.model ?? DEFAULT_MODEL,
      prices: this.#init.prices ?? loadPriceTable(this.#init.env),
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(this.#init.baseUrl !== undefined ? { baseUrl: this.#init.baseUrl } : {}),
      ...(this.#init.fetchImpl !== undefined ? { fetchImpl: this.#init.fetchImpl } : {}),
    });
    await runGovernedLoop({
      sessionId: this.#init.sessionId,
      complete,
      catalogue: this.#catalogue,
      systemPrompt: backend.systemPrompt,
      input: await firstPrompt(this.#init.input),
      ...(this.#init.history !== undefined ? { history: this.#init.history } : {}),
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
