import { renderSections, type NeutralConfig, type Reminder } from '@coa/shared';
import type { BackendConfig } from '@coa/spi';

/** Render one standing-authority reminder to a single, stable line. */
function renderReminder(r: Reminder): string {
  return `[${r.rule}] ${r.reason}`;
}

/**
 * Baseline pieces the `claude_code` preset already covers — dropped from the Claude append so coa
 * layers ON the preset without duplicating it. coa-specific pieces (coa-orientation, pkg-coding,
 * role sections) are deliberately absent here: they carry coa's own authority the preset lacks.
 * This set is the backend-specific delta and is meant to be tuned once an A/B harness exists.
 */
export const PRESET_COVERED_PIECES: ReadonlySet<string> = new Set([
  'baseline-identity',
  'baseline-tone',
  'baseline-tool-use',
  'baseline-environment',
]);

/**
 * The neutral→native renderer. Turns the config compiler's backend-NEUTRAL
 * `NeutralConfig` into the Claude-SDK-native {@link BackendConfig}. Pure and
 * deterministic (no model call) — the only place backend binding happens, so
 * swapping the backend edits this function, never the compiler or the daemon.
 *
 * Cache invariant (honored): the most-stable-first prefix the compiler produced is kept
 * byte-stable; the same input renders byte-identically, so the renderer never
 * self-busts the prompt cache.
 */
export function renderNative(neutralConfig: NeutralConfig): BackendConfig {
  const pieces = [...neutralConfig.prefixHead]
    .sort((a, b) => a.order - b.order)
    .map((o) => o.piece)
    .filter((piece) => !PRESET_COVERED_PIECES.has(piece.name));
  const sections = renderSections(pieces);

  // Standing authority (the salient systemReminders) lands in the systemPrompt (the
  // head/tail split). A mid-session channel DOES exist — a `shouldQuery:false` user message lands its
  // content in context — but it costs its own turn, so using it is a policy decision and
  // waits for a caller that wants to pay. A streamed `role:system` message is transmitted
  // and NOT obeyed, so it is not that channel. Pull-only + scope-pushed content is deferred
  // to its own delivery channel and never folded into the static prompt.
  const authority = neutralConfig.systemReminders.map(renderReminder);
  const inner = [sections, authority.join('\n')].filter((s) => s !== '').join('\n\n');
  const systemPrompt = inner === '' ? '' : `# coa governance layer\n\n${inner}`;

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
  };
}
