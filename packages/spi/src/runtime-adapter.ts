import type { NeutralConfig, SessionConfig, ToolCall, ToolResponse } from '@coa/shared';
import type { ZodRawShape } from 'zod';

/**
 * The backend capability-port contract: the narrow interface the core calls,
 * implemented once per backend. The core NEVER branches on which backend is
 * active. These are **type signatures only**; the concrete backend
 * implementation is handed in at runtime by the session host.
 *
 * Payloads owned by a consumer module are typed at the narrowest shape the
 * adapter needs and annotated with their owner; the adapter does not re-decide
 * them.
 */

/**
 * The backend-native config `renderNative` produces from the config compiler's
 * neutral output — the **internal port shape**, not the deferred public SPI.
 * Carries the static options; the two hooks (`canUseTool` / `Stop`) are
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
}

/** The deterministic close-gate decision; the adapter maps it onto the SDK `Stop` hook. */
export type StopDecision = { allow: true } | { allow: false; message: string };

/** The `Stop`-hook predicate the adapter wires (the close-gate, handed in by the session host). */
export type StopPredicate = () => StopDecision | Promise<StopDecision>;

/**
 * A neutral turn-level interrupt handle a backend reports UP (interrupts flow
 * from the backend to the caller, never the reverse).
 * Calling it stops the CURRENTLY-running turn for a user stop, while keeping the
 * backend session ALIVE — distinct from the whole-session user-stop `signal`
 * (`AbortController`) that terminates the loop. Only a streaming/held-open backend
 * (the Claude SDK's `Query.interrupt`) provides one; a per-turn backend never reports
 * it. Nothing routes a barge-in through it any more — that seam was removed; all
 * mid-turn text now travels as a delivery.
 */
export type TurnInterrupt = () => Promise<void>;

/** The per-tool decision the assembled `canUseTool` predicate returns. */
export type ToolPermissionDecision = { behavior: 'allow' } | { behavior: 'deny'; message: string };

/**
 * The single `canUseTool` predicate the adapter wires (assembled by the session
 * host from the cost-cap + the per-tool deny, first-deny-wins, fail-closed). The
 * adapter holds no policy.
 */
export type CanUseTool = (
  call: ToolCall,
) => ToolPermissionDecision | Promise<ToolPermissionDecision>;

/**
 * Text waiting to reach a running loop, drained by an adapter at its own soonest
 * boundary. Distinct from `Reminder`, which is the governor's `{rule, reason, tier}`
 * authority payload compiled into the config — this carries arbitrary text and a
 * provenance tag, not a rule.
 */
export interface Delivery {
  origin: 'user' | 'system';
  text: string;
}

/** An adapter's pull on the session's pending deliveries; returns [] when there are none. */
export type DrainDeliveries = () => readonly Delivery[];

/**
 * Settled token/cost usage a backend reports through its settlement callback
 * (`onSettle`, once per settled result) — the one usage channel into the cost meter.
 */
export interface RuntimeUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  cacheReadTokens?: number;
}

/** The governed tool catalogue registered into the loop — the rich, callable shape. */
export type ToolCatalogue = readonly RegisteredTool[];

/**
 * One governed tool, ready for the adapter to register as an in-process MCP tool.
 * The tool layer (in the core) builds these by wiring its handlers to the live
 * spine/governor/context/cost ports and decorating each return with `enrich`; the
 * adapter turns each into an SDK `tool(name, description, inputSchema, handler)`
 * inside a `createSdkMcpServer`. The handler dispatch is the boundary at which
 * `enrich` is applied (every return carries gated flags) and at which inputs are
 * Zod-validated before the handler touches shared state. `invoke` never throws
 * and never denies (advisory only — surface, never cage): a bad input or a
 * confinement/diff failure comes back as an unapplied result the agent can retry.
 */
export interface RegisteredTool {
  name: string;
  description: string;
  /** Schema-budget partition (always-loaded vs pulled on demand) — the adapter marks the kernel set always-loaded, the rest deferred. */
  partition: 'kernel' | 'on-demand';
  /** The Zod raw shape handed to the SDK `tool(...)` as the MCP input schema (validate before the handler touches state). */
  inputSchema: ZodRawShape;
  /** The governed, enriched dispatch: validate args → route to the tool handler → enrich the return. */
  invoke: (args: unknown) => ToolResponse<unknown> | Promise<ToolResponse<unknown>>;
  /**
   * Render this tool's structured `result` to human-readable display text — the text a
   * pure-API loop (no SDK-provided result text) shows on the `tool_result` frame and
   * feeds back to the model. The tool owns its result shape, so it owns the rendering.
   * Pure and total: it never throws and an unrecognized shape falls back to raw JSON.
   * Absent ⇒ the loop uses the JSON dump directly (SDK backends render their own text).
   */
  render?: (result: unknown) => string;
  /**
   * Whether this tool's structured `result` represents a success — the pure-API loop uses
   * it to set the `tool_result` frame's `ok` (✓ vs ✗ + an always-visible red error body),
   * since a pure-API backend has no SDK-provided error signal. The tool owns its result
   * shape, so it owns the predicate. Pure and total: it never throws, and an unrecognized
   * shape returns `true` (a well-formed result is never falsely flagged failed). Absent ⇒
   * the loop presumes success (SDK backends carry their own error signal).
   */
  ok?: (result: unknown) => boolean;
}

/**
 * The one backend seam — exactly the calls the session host makes to drive a
 * governed session (render the config, wire the two hooks, register the tools,
 * run the loop). Settled usage flows back through the construction-time
 * `onSettle` callback, not a method here.
 */
export interface RuntimeAdapter {
  /** Drive one rented agent turn-loop for a session. */
  runLoop(sessionConfig: SessionConfig): Promise<void>;
  /** Register the governed tool catalogue (the MCP surface) into the loop. */
  registerTools(catalogue: ToolCatalogue): void;
  /** Disable the built-in tools coa demotes (e.g. built-in `Edit`) — a demotable default. */
  denyBuiltins(): void;
  /** Wire the SDK `canUseTool` hook. The adapter owns the wiring; the session host owns the predicate. */
  interceptTool(canUseTool: CanUseTool): void;
  /** Wire the SDK `Stop` hook — the close-gate rides here (there is no "finish" tool). */
  interceptStop(stopPredicate: StopPredicate): void;
  /** Render the backend-neutral compiled config into backend-native form. Pure — no model call. */
  renderNative(neutralConfig: NeutralConfig): BackendConfig;
}
