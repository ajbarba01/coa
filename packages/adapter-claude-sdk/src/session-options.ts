import type { CapabilitySet, ClaudeReasoning, ToolCall } from '@coa/shared';
import type { BackendConfig, CanUseTool, StopPredicate } from '@coa/spi';
import type {
  CanUseTool as SdkCanUseTool,
  McpServerConfig,
  Options,
} from '@anthropic-ai/claude-agent-sdk';
import { buildBaseOptions, toSdkPermission, toStopHookOutput } from './sdk-options.js';

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
  /** The agent's model id; absent ⇒ account/SDK default. */
  model?: string;
  /** The agent's reasoning config; absent ⇒ SDK default. */
  reasoning?: ClaudeReasoning;
  /** The full subprocess env (M9 auth seam) — REPLACES process.env, so it's pre-spread by the caller. */
  env?: Record<string, string | undefined>;
}): Options {
  const {
    sessionId,
    backend,
    sandbox,
    canUseTool,
    stopPredicate,
    mcpServers,
    maxBudgetUsd,
    model,
    reasoning,
    env,
  } = args;

  const sdkCanUseTool: SdkCanUseTool = async (toolName, input) => {
    const call: ToolCall = { tool: toolName, args: input, sessionId };
    return toSdkPermission(await canUseTool(call));
  };

  return {
    ...buildBaseOptions({
      backend,
      sandbox,
      ...(model !== undefined ? { model } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
    }),
    canUseTool: sdkCanUseTool,
    hooks: {
      Stop: [{ hooks: [async () => toStopHookOutput(await stopPredicate())] }],
    },
    ...(mcpServers ? { mcpServers } : {}),
    ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
    ...(env ? { env } : {}),
  };
}
