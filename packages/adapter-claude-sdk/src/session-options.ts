import type { CapabilitySet, ClaudeReasoning, ToolCall } from '@coa/shared';
import type { BackendConfig, CanUseTool, StopPredicate } from '@coa/spi';
import type {
  CanUseTool as SdkCanUseTool,
  HookCallback,
  McpServerConfig,
  Options,
} from '@anthropic-ai/claude-agent-sdk';
import { buildBaseOptions, toSdkPermission, toStopHookOutput } from './sdk-options.js';

/**
 * Assemble the SDK hook registrations for one session. Kept separate from the
 * option spread because the SDK exposes 30 hook events and coa registers a growing
 * subset of them; a hardcoded literal made adding the second one a rewrite.
 */
export function buildHooks(args: {
  stopPredicate: StopPredicate;
  canUseTool: CanUseTool;
  sessionId: string;
  /**
   * Drive producer ② after a tool runs (M8-owned). REQUIRED rather than optional so it
   * is impossible to register the hooks while forgetting the recorder — the gap this
   * closes was exactly that: nothing observed a native tool's writes.
   */
  observeChanges: () => void;
}): NonNullable<Options['hooks']> {
  const { stopPredicate, canUseTool, sessionId, observeChanges } = args;

  // `PreToolUse` is the per-tool gate for the WHOLE session, not just delegation.
  // `canUseTool` is never consulted for a native spawn, and the 2026-08-03 gate run
  // measured it not firing for an ordinary in-cwd read either; this seam sees both.
  // See docs/adr/0029, which supersedes the two-seam split of docs/adr/0028.
  //
  // It DENIES or ABSTAINS and never asserts `allow`: SC-1 gives coa two blocks and no
  // grants, and an explicit allow here is an auto-approve that would suppress a prompt
  // the harness would otherwise raise.
  const gateToolCall: HookCallback = async (input) => {
    if (!('tool_name' in input)) return {};
    const args_ = 'tool_input' in input ? input.tool_input : {};
    const call: ToolCall = {
      tool: input.tool_name,
      args: (args_ ?? {}) as Record<string, unknown>,
      sessionId,
    };
    const decision = await canUseTool(call);
    if (decision.behavior === 'allow') return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: decision.message,
      },
    };
  };

  // The producer trigger. coa does not parse `tool_input` per tool: the reconciler scans
  // the worktree itself, so one trigger covers a native Edit, a Write, and any file a Bash
  // command touched — which per-tool parsing would miss entirely. Abstains always;
  // observation is not governance (docs/adr/0029).
  const observeAfterTool: HookCallback = async () => {
    observeChanges();
    return {};
  };

  return {
    Stop: [{ hooks: [async () => toStopHookOutput(await stopPredicate())] }],
    PreToolUse: [{ hooks: [gateToolCall] }],
    PostToolUse: [{ hooks: [observeAfterTool] }],
  };
}

/**
 * Assemble one session's `query()` options from the rendered config, the M7
 * sandbox set, and the injected predicates M8 hands the adapter at session
 * construction (D121). This is where the two SC-1 blocks are wired onto the two
 * SDK hooks: the cost-cap/per-tool deny onto `canUseTool`, the close-gate onto
 * the `Stop` hook. The wiring is pure and testable; only the `query()` call
 * itself (in the adapter) touches the live backend.
 */
export function assembleSessionOptions(args: {
  sessionId: string;
  backend: BackendConfig;
  sandbox: CapabilitySet;
  /** The assembled per-tool predicate (M8: cost-cap → M3.perToolDeny, first-deny-wins). */
  canUseTool: CanUseTool;
  /** M3's close-gate, read on each Stop event. */
  stopPredicate: StopPredicate;
  /**
   * Drive producer ② after each tool call (M8: the daemon's reconciler). Absent ⇒ a
   * no-op, so a caller that does not supply it behaves exactly as before (D85).
   */
  observeChanges?: () => void;
  mcpServers?: Record<string, McpServerConfig>;
  maxBudgetUsd?: number;
  /** The restricted built-in tool set (from the resolved frame); absent ⇒ the SDK default (no restriction). */
  tools?: string[];
  /** The agent's model id; absent ⇒ account/SDK default. */
  model?: string;
  /** The agent's reasoning config; absent ⇒ SDK default. */
  reasoning?: ClaudeReasoning;
  /** The full subprocess env (M9 auth seam) — REPLACES process.env, so it's pre-spread by the caller. */
  env?: Record<string, string | undefined>;
  /** A prior backend session id to resume (R-7 continuity): loads that conversation's history. */
  resume?: string;
  /**
   * The SDK-owned controller the adapter binds to M8's neutral `AbortSignal`
   * (SC-1 — a user stop, not a governance block); absent ⇒ no controller passed,
   * byte-identical to today (D85).
   */
  abortController?: AbortController;
}): Options {
  const {
    sessionId,
    backend,
    sandbox,
    canUseTool,
    stopPredicate,
    observeChanges,
    mcpServers,
    maxBudgetUsd,
    tools,
    model,
    reasoning,
    env,
    resume,
    abortController,
  } = args;

  const sdkCanUseTool: SdkCanUseTool = async (toolName, input) => {
    const call: ToolCall = { tool: toolName, args: input, sessionId };
    return toSdkPermission(await canUseTool(call), input);
  };

  return {
    ...buildBaseOptions({
      backend,
      sandbox,
      ...(tools !== undefined ? { tools } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
    }),
    canUseTool: sdkCanUseTool,
    // Stream partial assistant messages (Piece B / G7): the adapter maps their content-block
    // deltas to delivery-only `text-delta`/`thinking-delta` frames (docs/adr/0013).
    includePartialMessages: true,
    hooks: buildHooks({
      stopPredicate,
      canUseTool,
      sessionId,
      observeChanges: observeChanges ?? ((): void => {}),
    }),
    ...(mcpServers ? { mcpServers } : {}),
    ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
    ...(env ? { env } : {}),
    ...(resume !== undefined ? { resume } : {}),
    ...(abortController !== undefined ? { abortController } : {}),
  };
}
