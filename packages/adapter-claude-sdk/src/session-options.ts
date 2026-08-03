import type { CapabilitySet, ClaudeReasoning, ToolCall } from '@coa/shared';
import type { BackendConfig, CanUseTool, StopPredicate } from '@coa/spi';
import type {
  CanUseTool as SdkCanUseTool,
  HookCallback,
  McpServerConfig,
  Options,
} from '@anthropic-ai/claude-agent-sdk';
import { buildBaseOptions, toSdkPermission, toStopHookOutput } from './sdk-options.js';
import { DELEGATION_TOOL_NAMES } from './tool-frame.js';

/**
 * Assemble the SDK hook registrations for one session. Kept separate from the
 * option spread because the SDK exposes 30 hook events and coa registers a growing
 * subset of them; a hardcoded literal made adding the second one a rewrite.
 */
export function buildHooks(args: {
  stopPredicate: StopPredicate;
  canUseTool: CanUseTool;
  sessionId: string;
}): NonNullable<Options['hooks']> {
  const { stopPredicate, canUseTool, sessionId } = args;

  // `canUseTool` is never consulted for a native spawn — verified live in a run that
  // set no `allowedTools`, so this is intrinsic to the delegation tool rather than a
  // consequence of auto-approval. `PreToolUse` is the only seam that sees it, and it
  // judges ONLY delegation so no other call is judged by both seams. See docs/adr/0028.
  const gateDelegation: HookCallback = async (input) => {
    if (!('tool_name' in input) || !DELEGATION_TOOL_NAMES.includes(input.tool_name)) return {};
    const args_ = 'tool_input' in input ? input.tool_input : {};
    const call: ToolCall = {
      tool: input.tool_name,
      args: (args_ ?? {}) as Record<string, unknown>,
      sessionId,
    };
    const decision = await canUseTool(call);
    return decision.behavior === 'allow'
      ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
      : {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: decision.message,
          },
        };
  };

  return {
    Stop: [{ hooks: [async () => toStopHookOutput(await stopPredicate())] }],
    PreToolUse: [{ hooks: [gateDelegation] }],
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
    hooks: buildHooks({ stopPredicate, canUseTool, sessionId }),
    ...(mcpServers ? { mcpServers } : {}),
    ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
    ...(env ? { env } : {}),
    ...(resume !== undefined ? { resume } : {}),
    ...(abortController !== undefined ? { abortController } : {}),
  };
}
