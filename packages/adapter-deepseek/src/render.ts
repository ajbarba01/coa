import { renderSections, type NeutralConfig, type Reminder } from '@coa/shared';

/**
 * The neutral→DeepSeek prompt render (M9). A pure API has only a system message,
 * so this collapses M5's `NeutralConfig` to a single system-prompt string: the
 * most-stable-first prefix (byte-stable — cache invariant honored), rendered into
 * the DC-6 section skeleton, followed by the standing-authority reminders. Unlike
 * the Claude adapter there is no drop-set and no boundary heading — DeepSeek has no
 * preset to defer to, so it renders every Piece. There is no re-anchor file (that is
 * a Claude-SDK concern) and pull-only/scope-pushed content is deferred (TAX-1),
 * never folded in.
 */
function renderReminder(reminder: Reminder): string {
  return `[${reminder.rule}] ${reminder.reason}`;
}

export function renderSystemPrompt(neutralConfig: NeutralConfig): string {
  const sections = renderSections(
    [...neutralConfig.prefixHead].sort((a, b) => a.order - b.order).map((ordered) => ordered.piece),
  );
  const authority = neutralConfig.systemReminders.map(renderReminder);
  return authority.length > 0 ? [sections, authority.join('\n')].join('\n\n') : sections;
}
