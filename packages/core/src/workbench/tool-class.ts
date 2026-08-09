import type { ToolClass } from '@coa/shared';
import { BASE_TOOL_CATALOGUE } from './base-tools.js';
import { TOOL_CATALOGUE } from './catalogue.js';
import { WEB_TOOL_CATALOGUE } from './web-tools.js';

/**
 * F2's tool→risk-class lookup, built once from the SAME manifest `group` tags
 * `catalogue.ts`/`base-tools.ts`/`web-tools.ts` already declare for frame-level
 * allow-listing — one taxonomy, not a parallel one. `egress` (WebSearch/WebFetch)
 * folds into `read`: it touches the network but neither the worktree nor a
 * subprocess, the same risk shape a read has for permission-mode purposes.
 */
const GROUP_TO_CLASS: Record<'read' | 'write' | 'exec' | 'egress', ToolClass> = {
  read: 'read',
  egress: 'read',
  write: 'write',
  exec: 'exec',
};

const CLASS_BY_TOOL: ReadonlyMap<string, ToolClass> = new Map(
  [...TOOL_CATALOGUE, ...BASE_TOOL_CATALOGUE, ...WEB_TOOL_CATALOGUE].map((tool) => [
    tool.name,
    tool.group !== undefined ? GROUP_TO_CLASS[tool.group] : 'exec',
  ]),
);

/**
 * Classify a tool call for F2 permission-mode purposes. A tool coa's own
 * catalogues don't name — a native backend built-in with no manifest entry here,
 * today or in the future — classifies as `exec`, the most cautious bucket:
 * fail-closed, not fail-open, so a mode's enforcement can never be silently
 * skipped just because coa doesn't yet know a tool's real risk.
 */
export function classifyTool(name: string): ToolClass {
  return CLASS_BY_TOOL.get(name) ?? 'exec';
}
