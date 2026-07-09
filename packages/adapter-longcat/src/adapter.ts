import type {
  BackendMessage,
  CapabilityProfile,
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
 * `complete()` primitive, and hands the loop the two SC-1 predicates. Every enhancement
 * port degrades to its null-fallback (barebones profile). It imports no provider SDK.
 */

const NO_USAGE: RuntimeUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

export interface LongCatAdapterInit {
  sessionId: string;
  /** The session's prompt input (neutral); the one-shot prompt is the first turn. */
  input: string | AsyncIterable<string>;
  model?: ModelSelection;
  /** M9's settlement step → M7.charge, called once with the loop's summed usage. */
  onSettle?: (sessionId: string, usage: RuntimeUsage) => void;
  /** Per-frame session output → M8's emission policy. */
  onTurn?: (frame: TurnFrame) => void;
  /** The prior conversation transcript (R-7, system omitted), resent verbatim for cross-turn memory. */
  history?: readonly BackendMessage[];
  /** Report the settled transcript so M8 can persist it as the next turn's `history`. */
  onBackendMessages?: (messages: readonly BackendMessage[]) => void;
  /** The account's login pointer (an env-var/key-file pointer); absent ⇒ the default key var. */
  locator?: Locator;
  /** Accepted for D121 parity; a raw chat API has no native mid-loop hard stop. */
  maxBudgetUsd?: number;
  /** Injectable seams (tests / config). */
  env?: Record<string, string | undefined>;
  baseUrl?: string;
  prices?: PriceTable;
  fetchImpl?: FetchLike;
  /**
   * The neutral user-stop from M8, forwarded into the governed loop so an interrupt
   * aborts the in-flight HTTP request; SC-1 — a user stop, not a governance block.
   */
  signal?: AbortSignal;
  /**
   * A synchronous drain of user turns queued while mid-round-trip (steering), from
   * M8; the governed loop drains it at the next safe boundary (SC-1 — a user
   * input, not a governance block).
   */
  drainSteer?: () => readonly string[];
  /**
   * A synchronous drain of `queue`-mode steers — user turns that should run AFTER the
   * current turn's work, from M8; the governed loop drains it at the close-gate
   * boundary (see {@link drainSteer} for the `barge-in` counterpart).
   */
  drainQueuedSteer?: () => readonly string[];
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
  #lastUsage: RuntimeUsage = NO_USAGE;

  constructor(init: LongCatAdapterInit) {
    this.#init = init;
  }

  renderNative(neutralConfig: NeutralConfig): BackendConfig {
    this.#backend = {
      systemPrompt: renderSystemPrompt(neutralConfig),
      allowedTools: neutralConfig.toolIntents.allow,
      disallowedTools: neutralConfig.toolIntents.deny,
      perAgent: {},
      files: [],
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
      ...(this.#init.onBackendMessages !== undefined
        ? { onMessages: this.#init.onBackendMessages }
        : {}),
      ...(this.#init.signal !== undefined ? { signal: this.#init.signal } : {}),
      ...(this.#init.drainSteer !== undefined ? { drainSteer: this.#init.drainSteer } : {}),
      ...(this.#init.drainQueuedSteer !== undefined
        ? { drainQueuedSteer: this.#init.drainQueuedSteer }
        : {}),
      onSettle: (sessionId, usage) => {
        this.#lastUsage = usage;
        this.#init.onSettle?.(sessionId, usage);
      },
    });
  }

  usageTelemetry(): RuntimeUsage {
    return this.#lastUsage;
  }

  // --- Enhancement ports: LongCat runs the neutral floor; each degrades to its null-fallback. ---

  deliverReminder(_reminder: Reminder, _at: ReminderAt): void {}
  render_context(_pkg: ContextPackage): void {}
  inject_runtime(_slice: readonly Piece[]): void {}
  cache_control(_breakpoints: CacheBreakpoints): void {}

  capabilityProfile(): CapabilityProfile {
    return barebonesProfile;
  }

  refs(_symbol: SymbolRef): SymbolReference[] | null {
    return REFS_NULL_FALLBACK;
  }

  async runEval(_corpus: EvalCorpus): Promise<EvalResult> {
    return { passed: 0, failed: 0 };
  }
}
