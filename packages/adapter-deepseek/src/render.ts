import type { NeutralConfig, Reminder } from '@coa/shared';

/**
 * The neutral→DeepSeek prompt render (M9). A pure API has only a system message,
 * so this collapses M5's `NeutralConfig` to a single system-prompt string: the
 * most-stable-first prefix (byte-stable — cache invariant honored) followed by the
 * standing-authority reminders. There is no re-anchor file (that is a Claude-SDK
 * concern) and pull-only/scope-pushed content is deferred (TAX-1), never folded in.
 */
function renderReminder(reminder: Reminder): string {
  return `[${reminder.rule}] ${reminder.reason}`;
}

export function renderSystemPrompt(neutralConfig: NeutralConfig): string {
  const prefix = [...neutralConfig.prefixHead]
    .sort((a, b) => a.order - b.order)
    .map((ordered) => ordered.piece.body)
    .join('\n\n');
  const authority = neutralConfig.systemReminders.map(renderReminder);
  return authority.length > 0 ? [prefix, authority.join('\n')].join('\n\n') : prefix;
}
