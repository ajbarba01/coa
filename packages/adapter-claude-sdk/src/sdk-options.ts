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
 * call) is what lets the loop stay behind the M9 port and stay testable.
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
 * Map M3/M7's per-tool decision (assembled by M8) onto the SDK `canUseTool` result.
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
 * Map M3's close-gate decision onto the SDK `Stop`-hook output.
 *
 * SPEC-fold-in correction: the SPEC draft says return `{continue:false,
 * systemMessage}`, but on the live SDK `continue:false` *ends the turn* — the
 * opposite of the gate's intent. To **block the close and feed M3's message back
 * so the agent keeps working**, the correct shape is `{decision:'block',
 * reason}`. The design (the gate blocks the close) is unchanged; only the SDK
 * field names differ from the draft.
 */
export function toStopHookOutput(decision: StopDecision): SyncHookJSONOutput {
  return decision.allow ? { continue: true } : { decision: 'block', reason: decision.message };
}

/**
 * Build the static `query()` options from the rendered backend config + the M7
 * sandbox set. The dynamic parts (`canUseTool`, the `Stop` hook, `mcpServers`,
 * `maxBudgetUsd`) are layered on by the adapter/M8 at session construction.
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
    // B1 — isolate the session from on-disk config (D108). Omitting these lets the
    // SDK default load ALL setting sources (the target repo's CLAUDE.md +
    // .claude/settings + ~/.claude) as authority coa did NOT author, and pull in
    // MCP servers coa did not register. This is a SEPARATE mechanism from the
    // preset above: the preset supplies Anthropic-authored baseline behavior,
    // while `settingSources: []` blocks the TARGET REPO's own on-disk
    // config/MCP servers from leaking in. coa authors its own standing
    // authority via the rendered `systemPrompt`; mid-session re-read moves to
    // the daemon-authored reminder hooks (D133), which do not depend on
    // setting sources.
    settingSources: [],
    strictMcpConfig: true,
    ...(tools !== undefined ? { tools } : {}),
    ...(model !== undefined && model !== '' ? { model } : {}),
    ...(reasoning !== undefined ? reasoningToOptions(reasoning) : {}),
  };
}
