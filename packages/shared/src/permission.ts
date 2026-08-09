import { z } from 'zod';

/**
 * The F2 permission-mode wire vocabulary. Exactly four modes — semantics mirror
 * Claude Code's own plan/default/acceptEdits/bypassPermissions (interop-familiar
 * names, studied for behavior only; no code ported): `plan` is read-only (no
 * writes, no commands, ever); `manual` asks before a write OR a command;
 * `edits` auto-approves file edits but still asks before a command; `bypass`
 * asks nothing and blocks nothing. Enforced ONLY by the daemon's mode-aware
 * `canUseTool` layer (packages/core/src/session/permission.ts) — the console
 * only reflects/selects it, never decides allow/deny itself.
 */
export const PERMISSION_MODES = ['plan', 'manual', 'edits', 'bypass'] as const;
export const permissionModeSchema = z.enum(PERMISSION_MODES);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

/**
 * A tool's risk class for mode purposes, from the workbench catalogue's declared
 * capability `group` (packages/core/src/workbench/catalogue.ts): `read` never
 * needs asking, `write` is a file edit, `exec` is a command/subagent-spawn — the
 * bucket every unrecognized tool falls into (fail-closed, not fail-open).
 */
export const TOOL_CLASSES = ['read', 'write', 'exec'] as const;
export const toolClassSchema = z.enum(TOOL_CLASSES);
export type ToolClass = z.infer<typeof toolClassSchema>;

/** The console's answer to a pending approval request — the wire vocabulary
 *  `respondApproval` accepts (distinct from the internal allow/deny
 *  {@link ToolClass}-adjacent vocabulary `ToolPermissionDecision` uses). */
export const APPROVAL_DECISIONS = ['approve', 'deny'] as const;
export const approvalDecisionSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
