import type {
  CapabilityProfile,
  ContextPackage,
  NeutralConfig,
  Piece,
  Reminder,
  SessionConfig,
  SymbolRef,
  ToolCall,
  ToolResponse,
} from '@coa/shared';
import type { ZodRawShape } from 'zod';

/**
 * The M9 capability-port contract (D109): the narrow interface the core calls,
 * implemented once per backend. The core NEVER branches on which backend is
 * active — a backend that lacks a capability returns a **null-fallback** (a
 * defined "degrade gracefully" result; see `./null-fallback.ts`), never a thrown
 * error or a `which-backend` branch. These are **type signatures only**; the
 * concrete Claude-SDK implementation is handed in at runtime by M8 (D121).
 *
 * Payloads owned by a consumer module are typed at the narrowest shape the
 * adapter needs and annotated with their owner; the adapter does not re-decide
 * them.
 */

/** A file the renderer emits for the backend to materialize (e.g. `.claude/CLAUDE.md`). */
export interface BackendFile {
  /** Worktree-relative path. Written gitignored + reconciler-excluded (S-5). */
  path: string;
  content: string;
}

/**
 * The backend-native config `renderNative` produces from M5's neutral output —
 * the **internal D109 port shape** (D126), not the deferred public SPI (D110).
 * Carries the static options + files; the two hooks (`canUseTool` / `Stop`) are
 * wired separately via {@link RuntimeAdapter.interceptTool}/`interceptStop`.
 */
export interface BackendConfig {
  systemPrompt: string;
  /** Allow intent → SDK `tools`. */
  allowedTools: string[];
  /** Deny intent → SDK `disallowedTools` (incl. the demoted built-in `Edit`). */
  disallowedTools: string[];
  /** Per-subagent frames (the `perAgent` intents), rendered structurally. */
  perAgent: Record<string, { allowedTools: string[]; disallowedTools: string[] }>;
  files: BackendFile[];
}

/** The deterministic close-gate decision M3 returns; M9 maps it onto the SDK `Stop` hook. */
export type StopDecision = { allow: true } | { allow: false; message: string };

/** The `Stop`-hook predicate M9 wires (M3.gate, handed in by M8). */
export type StopPredicate = () => StopDecision | Promise<StopDecision>;

/** The per-tool decision the assembled `canUseTool` predicate returns. */
export type ToolPermissionDecision = { behavior: 'allow' } | { behavior: 'deny'; message: string };

/**
 * The single `canUseTool` predicate M9 wires (assembled by M8 from M7's cost-cap
 * + M3's `perToolDeny`, first-deny-wins, fail-closed). M9 holds no policy.
 */
export type CanUseTool = (
  call: ToolCall,
) => ToolPermissionDecision | Promise<ToolPermissionDecision>;

/** Where in the transcript a reminder lands (D108/D133). */
export type ReminderAt = 'session-start' | 'prompt' | 'post-tool';

/** Prompt-cache breakpoint markers (byte offsets into the stable prefix). */
export interface CacheBreakpoints {
  breakpoints: number[];
}

/** Settled token/cost usage read from the backend at session end. */
export interface RuntimeUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  cacheReadTokens?: number;
}

/** A precise reference location from the LSP port (D144). */
export interface SymbolReference {
  path: string;
  line: number;
  column: number;
}

/** The governed tool catalogue M6 registers into the loop (M6 owns the rich shape). */
export type ToolCatalogue = readonly { readonly name: string }[];

/** Where a registered tool's schema sits in the D100 budget: always-loaded vs pulled on demand. */
export type ToolPartition = 'kernel' | 'on-demand';

/**
 * One governed M6 tool, ready for M9 to register as an in-process MCP tool. M6
 * (in the core) builds these by wiring its handlers to the live M1/M3/M4/M7 ports
 * and decorating each return with `enrich`; M9 turns each into an SDK
 * `tool(name, description, inputSchema, handler)` inside a `createSdkMcpServer`.
 * The handler dispatch is the boundary at which `enrich` is applied (every return
 * carries grounding + gated flags) and at which inputs are Zod-validated before
 * the handler touches shared state (D141(c)). `invoke` never throws and never
 * denies (SC-1): a bad input or a confinement/diff failure comes back as an
 * unapplied result the agent can retry.
 */
export interface RegisteredTool {
  name: string;
  description: string;
  /** D100 schema-budget partition — M9 marks the kernel set always-loaded, the rest deferred. */
  partition: ToolPartition;
  /** The Zod raw shape M9 hands the SDK `tool(...)` as the MCP input schema (D141(c) validate-before-touch). */
  inputSchema: ZodRawShape;
  /** The governed, enriched dispatch: validate args → route to the M6 handler → enrich the return. */
  invoke: (args: unknown) => ToolResponse<unknown> | Promise<ToolResponse<unknown>>;
}

/** The golden-corpus eval input/result (D138 mechanism; M8/M7 own the policy). */
export interface EvalCorpus {
  readonly cases: readonly unknown[];
}
export interface EvalResult {
  readonly passed: number;
  readonly failed: number;
}

/**
 * The one backend seam. Every method is a port; a missing capability degrades to
 * a null-fallback (`./null-fallback.ts`), never a throw.
 */
export interface RuntimeAdapter {
  /** Drive one rented agent turn-loop for a session. */
  runLoop(sessionConfig: SessionConfig): Promise<void>;
  /** Register M6's governed tool catalogue (the MCP surface) into the loop. */
  registerTools(catalogue: ToolCatalogue): void;
  /** Disable the built-in tools coa demotes (e.g. built-in `Edit`) — a demotable default. */
  denyBuiltins(): void;
  /** Wire the SDK `canUseTool` hook. M9 owns the wiring; M8 owns the predicate. */
  interceptTool(canUseTool: CanUseTool): void;
  /** Wire the SDK `Stop` hook — the close-gate rides here (there is no "finish" tool). */
  interceptStop(stopPredicate: StopPredicate): void;
  /** Deliver the reminder M3 decided, at the position D108 dictates. */
  deliverReminder(reminder: Reminder, at: ReminderAt): void;
  /** Render M5's backend-neutral config into backend-native form. Pure (P1). */
  renderNative(neutralConfig: NeutralConfig): BackendConfig;
  /** Deliver an assembled context package at session start (M8 calls; M4 does not). */
  render_context(pkg: ContextPackage): void;
  /** Inject scope-selected pieces in-flight (the M9 loop calls; SCO-4 delivery). */
  inject_runtime(slice: readonly Piece[]): void;
  /** Set prompt-cache breakpoints over the stable prefix. */
  cache_control(breakpoints: CacheBreakpoints): void;
  /** Report settled token/cost usage (M9's settlement step calls `M7.charge`). */
  usageTelemetry(): RuntimeUsage;
  /** Report what this backend supports; null-fallback = the barebones baseline (D62). */
  capabilityProfile(): CapabilityProfile;
  /** Precise references when `tsserver` is available; null → M2 tree-sitter floor (D144). */
  refs(symbol: SymbolRef): SymbolReference[] | null;
  /** Run the golden-corpus eval (D138 mechanism); M8 orchestrates, M7 guards. */
  runEval(corpus: EvalCorpus): Promise<EvalResult>;
}
