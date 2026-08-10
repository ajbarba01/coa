import type { CapabilitySet, ClaudeReasoning } from '@coa/shared';
import type { BackendConfig, StopDecision, ToolPermissionDecision } from '@coa/spi';
import type {
  Options,
  PermissionMode,
  PermissionResult,
  SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import { reasoningToOptions } from './reasoning.js';

/**
 * The pure mapping seams between coa's backend-neutral decisions and the Claude
 * Agent SDK's native option/callback shapes. Keeping these pure (no `query()`
 * call) is what lets the loop stay behind the backend port and stay testable.
 *
 * Verified against the installed SDK types (`@anthropic-ai/claude-agent-sdk`
 * 0.3.196), per the "verify against the live SDK callback contract at build"
 * requirement. Note the close-gate mapping below corrects the SPEC draft.
 */

/** The SDK PermissionMode values; the sandbox set carries a free string we narrow against these. */
const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
];

function asPermissionMode(value: string): PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value)
    ? (value as PermissionMode)
    : 'default';
}

/**
 * Map the governance per-tool decision (assembled by the daemon from the constraint
 * system's deny rules) onto the SDK `canUseTool` result.
 *
 * The allow branch MUST echo `input` back as `updatedInput`. It is optional on
 * `PermissionResult`, so a bare `{behavior:'allow'}` typechecks — but the real CLI
 * reads the absence as a permission error and refuses the call, so every tool fails
 * while the types stay green. Verified live against CLI 2.1.196.
 */
export function toSdkPermission(
  decision: ToolPermissionDecision,
  input: Record<string, unknown>,
): PermissionResult {
  return decision.behavior === 'allow'
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: decision.message };
}

/**
 * Map the close-gate decision onto the SDK `Stop`-hook output.
 *
 * SPEC-fold-in correction: the SPEC draft says return `{continue:false,
 * systemMessage}`, but on the live SDK `continue:false` *ends the turn* — the
 * opposite of the gate's intent. To **block the close and feed the gate's message back
 * so the agent keeps working**, the correct shape is `{decision:'block',
 * reason}`. The design (the gate blocks the close) is unchanged; only the SDK
 * field names differ from the draft.
 */
export function toStopHookOutput(decision: StopDecision): SyncHookJSONOutput {
  return decision.allow ? { continue: true } : { decision: 'block', reason: decision.message };
}

/**
 * Build the static `query()` options from the rendered backend config + the governance
 * sandbox set. The dynamic parts (`canUseTool`, the `Stop` hook, `mcpServers`)
 * are layered on by the adapter/daemon at session construction.
 */
export function buildBaseOptions(args: {
  backend: BackendConfig;
  sandbox: CapabilitySet;
  /** The restricted built-in tool set (from the resolved frame); absent ⇒ the SDK default (all built-ins). */
  tools?: string[];
  /** The agent's model id; absent ⇒ the account/SDK default model. */
  model?: string;
  /** The agent's reasoning config; absent ⇒ the SDK default (adaptive/high). */
  reasoning?: ClaudeReasoning;
}): Options {
  const { backend, sandbox, tools, model, reasoning } = args;
  const disallowedTools = [
    ...backend.disallowedTools,
    ...sandbox.denyRules,
    ...sandbox.denyRead.map((glob) => `Read(${glob})`),
  ];

  return {
    // coa LAYERS its rendered prompt ON the `claude_code` preset rather than
    // replacing it: the preset supplies Claude Code's own baseline (tool-use,
    // code-quality, environment guidance — the pieces `PRESET_COVERED_PIECES`
    // drops from `backend.systemPrompt` so they aren't duplicated), and coa's
    // `append` layers its own authority (identity, orientation, role, standing
    // reminders) on top. `append` is omitted entirely when there is nothing to
    // add, rather than appending an empty string.
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      ...(backend.systemPrompt !== '' ? { append: backend.systemPrompt } : {}),
    },
    allowedTools: backend.allowedTools,
    disallowedTools,
    permissionMode: asPermissionMode(sandbox.permissionMode),
    // Isolate the session from on-disk config. Omitting `settingSources` lets
    // the SDK load ALL setting sources (the target repo's CLAUDE.md + .claude/settings +
    // ~/.claude) as authority coa did NOT author. This is a SEPARATE mechanism from the
    // preset above: the preset supplies Anthropic-authored baseline behavior, while this
    // blocks the TARGET REPO's own on-disk config from leaking in.
    //
    // Its reach is narrower than it looks, and the rest of this block is the honest
    // accounting (measured against SDK 0.3.196):
    //  - The MANAGED/POLICY tier is still read from disk by design. Not blockable. coa
    //    accepts it and says so rather than claiming an isolation it does not have.
    //  - Project `.mcp.json` is blocked by `strictMcpConfig` below — a DIFFERENT option.
    //    settingSources gets no credit for it.
    //  - `skills` unset is NOT "skills off"; the CLI's own discovery defaults still apply,
    //    so it is set explicitly. A later arc turns this from empty into coa's own list.
    //  - `AgentDefinition.memory: 'project'` auto-loads from the target repo on a channel
    //    settingSources does not appear on. coa declares no agents today; anything that
    //    starts declaring them inherits that leak.
    settingSources: [],
    strictMcpConfig: true,
    skills: [],
    ...(tools !== undefined ? { tools } : {}),
    ...(model !== undefined && model !== '' ? { model } : {}),
    ...(reasoning !== undefined ? reasoningToOptions(reasoning) : {}),
  };
}
