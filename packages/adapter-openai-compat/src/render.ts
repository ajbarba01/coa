import { renderSections, type NeutralConfig, type Reminder } from '@coa/shared';

/**
 * The neutral→pure-API prompt render, shared by every provider spec. A pure chat API
 * has only a system message, so this collapses the compiled `NeutralConfig` to a
 * single system-prompt string: the most-stable-first prefix (byte-stable — cache
 * invariant honored), rendered into the section skeleton, followed by the
 * standing-authority reminders. Unlike the Claude adapter there is no drop-set and no
 * boundary heading — a bare chat backend has no preset to defer to, so it renders
 * every Piece. Pull-only/scope-pushed content is deferred to its own delivery
 * channel, never folded in.
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
