import { renderSections, type NeutralConfig, type Reminder } from '@coa/shared';

/**
 * The neutral→LongCat prompt render. A pure API has only a system message, so this
 * collapses the compiled `NeutralConfig` to a single system-prompt string: the most-stable-first
 * prefix (byte-stable — cache invariant honored), rendered into the section skeleton,
 * followed by the standing-authority reminders. LongCat has no preset to defer to, so it
 * renders every Piece — no drop-set, no boundary heading. Pull-only/scope-pushed content
 * is deferred to its own delivery channel, never folded in.
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
