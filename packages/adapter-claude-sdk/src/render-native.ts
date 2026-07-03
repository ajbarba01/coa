import type { NeutralConfig, Reminder } from '@coa/shared';
import type { BackendConfig, BackendFile } from '@coa/spi';

/** The worktree-relative re-anchor file — gitignored + reconciler-excluded (S-5). */
const REANCHOR_PATH = '.claude/CLAUDE.md';

/** Render one standing-authority reminder to a single, stable line. */
function renderReminder(r: Reminder): string {
  return `[${r.rule}] ${r.reason}`;
}

/**
 * Baseline pieces the `claude_code` preset already covers — dropped from the Claude append so coa
 * layers ON the preset without duplicating it. coa-specific pieces (baseline-identity,
 * coa-orientation, role sections) are deliberately absent here: they carry coa's own authority the
 * preset lacks. This set is the backend-specific delta and is meant to be tuned once an A/B harness
 * exists.
 */
export const PRESET_COVERED_PIECES: ReadonlySet<string> = new Set([
  'baseline-tool-use',
  'baseline-code-quality',
  'baseline-environment',
]);

/**
 * The neutral→native renderer (M9). Turns M5's backend-NEUTRAL `NeutralConfig`
 * into the Claude-SDK-native {@link BackendConfig}. Pure and deterministic (P1) —
 * the only place backend binding happens, so swapping the backend edits this
 * function, never M5/M8.
 *
 * Cache invariant (honored): the most-stable-first prefix M5 produced is kept
 * byte-stable; the same input renders byte-identically, so the renderer never
 * self-busts the prompt cache.
 */
export function renderNative(neutralConfig: NeutralConfig): BackendConfig {
  const prefix = [...neutralConfig.prefixHead]
    .sort((a, b) => a.order - b.order)
    .filter((o) => !PRESET_COVERED_PIECES.has(o.piece.name))
    .map((o) => o.piece.body)
    .join('\n\n');

  // Standing authority (the salient systemReminders): there is no programmatic
  // mid-session role:system channel (verified SDK fact), so it lands in the
  // systemPrompt (head/tail, D108) and is re-anchored into a re-read-each-request
  // .claude file. Pull-only + scope-pushed content is deferred (TAX-1) and never
  // folded into the static prompt.
  const authority = neutralConfig.systemReminders.map(renderReminder);
  const systemPrompt = authority.length > 0 ? [prefix, authority.join('\n')].join('\n\n') : prefix;
  const files: BackendFile[] =
    authority.length > 0 ? [{ path: REANCHOR_PATH, content: authority.join('\n') }] : [];

  const { allow, deny, perAgent } = neutralConfig.toolIntents;
  const renderedPerAgent: BackendConfig['perAgent'] = {};
  for (const [agent, frame] of Object.entries(perAgent ?? {})) {
    renderedPerAgent[agent] = { allowedTools: frame.allow, disallowedTools: frame.deny };
  }

  return {
    systemPrompt,
    allowedTools: allow,
    disallowedTools: deny,
    perAgent: renderedPerAgent,
    files,
  };
}
