import { mcpToolName } from './mcp-tools.js';

/**
 * Map a neutral capability frame (coa tool names) onto the Claude Agent SDK's
 * tool transport. This is the backend-specific half of the agent-assembly model:
 * a resolved {@link import('@coa/shared').CapabilityFrame}'s `allow`/`deny` are
 * neutral names; here they become the SDK's `tools` (availability), `allowedTools`
 * (auto-approve), `disallowedTools` (removal), and the subset of the coa MCP
 * catalogue to register.
 *
 * Key SDK facts this encodes (verified against `sdk.d.ts`): `allowedTools` is an
 * *auto-approve* list, not an availability gate; **availability** of built-ins is
 * the `tools` option, and of coa tools is which MCP tools get registered. Real
 * governance stays on `canUseTool` (the cost-cap + M3 deny) — this only shapes
 * *which tools exist* for the agent.
 *
 * An EMPTY `allow` set is the D85 pass-through: no `tools` restriction, every coa
 * tool registered — byte-identical to the pre-frame behavior. A frame ref that is
 * neither a coa catalogue tool nor a known built-in (e.g. a not-yet-built
 * coa-control tool) is dropped rather than sent to the SDK.
 */

/** The SDK built-in tool names coa may grant/deny — backend-specific, so it lives here. */
export const KNOWN_BUILTINS: ReadonlySet<string> = new Set([
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
  'Task',
  'TodoWrite',
]);

export interface ToolTransport {
  /** Restrict the SDK built-in set (undefined ⇒ leave the default — no restriction). */
  tools?: string[];
  /** Auto-approve list — granted built-ins (bare) + granted coa tools (mcp names). */
  allowedTools: string[];
  /** Removal list — denied built-ins/rules + denied coa tools (mcp names). */
  disallowedTools: string[];
  /** The coa catalogue tool names to actually register (all when unrestricted). */
  registerCoaTools: string[];
}

/** Resolve a neutral frame (`allow`/`deny`) + the coa catalogue names into the SDK tool transport. */
export function resolveToolTransport(args: {
  allow: readonly string[];
  deny: readonly string[];
  coaToolNames: readonly string[];
}): ToolTransport {
  const coa = new Set(args.coaToolNames);
  const restrict = args.allow.length > 0;

  const allowCoa = args.allow.filter((name) => coa.has(name));
  const allowBuiltin = args.allow.filter((name) => !coa.has(name) && KNOWN_BUILTINS.has(name));
  const registerCoaTools = restrict ? allowCoa : [...args.coaToolNames];

  const denyCoa = args.deny.filter((name) => coa.has(name)).map(mcpToolName);
  const denyOther = args.deny.filter((name) => !coa.has(name)); // a built-in name or a raw deny-rule string

  return {
    ...(restrict ? { tools: allowBuiltin } : {}),
    allowedTools: [...allowBuiltin, ...registerCoaTools.map(mcpToolName)],
    disallowedTools: [...denyOther, ...denyCoa],
    registerCoaTools,
  };
}
