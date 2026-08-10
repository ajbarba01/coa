import { Button, Icon, StatusDot, Tooltip, cx } from '@coa/console-kit';
import type { SessionStatus } from '@coa/console-kit';
import type { ChatNotice } from './banners.js';

/** The dot carries severity (indicator law): cache is informational and passive, so it
 *  wears the ground/idle dot; drift needs you, so it wears the amber needs-you dot. The
 *  warn tint underneath says "attention"; the dot says how much. */
const DOT: Record<ChatNotice['kind'], SessionStatus> = {
  cache: 'idle',
  drift: 'needs-you',
};

/** Text is for names — the notice's own name, not its prose. */
const NAME: Record<ChatNotice['kind'], string> = {
  cache: 'Prompt cache',
  drift: 'Configuration drift',
};

/**
 * The predictive chat notices, rendered as sections INSIDE the composer's own rect —
 * same construction as the approval gate, above the field and under the top radius,
 * rather than as pills floating above the shell. The composer is the session's attention
 * port, so a standing fact about the prompt belongs in it.
 *
 * Each row is a dot, a name, one clause of cause, its actions, and a dismiss. Both kinds
 * are dismissable: cache offers nothing else (an idle cache cannot be un-cooled), drift
 * additionally offers Recompile, because prompts are stored per session and dismissing
 * genuinely means "keep this session's prompt as it is".
 *
 * FLAGGED DEVIATION (docs/UI.md): the one-clause `summary` is permanently visible, which
 * the indicator law's "detail is proximity, never permanent prose" would forbid. The copy
 * law's "one fact, at the moment it is load-bearing" wins here — a warning carrying an
 * action must say what happened, or it asks for a decision the reader cannot make. The
 * full paragraph stays behind hover and keyboard focus, where the law wants it.
 *
 * Renders nothing when there is nothing to say.
 */
export function NoticeLine({
  notices,
  onAction,
}: {
  notices: ChatNotice[];
  onAction: (id: string, actionId: string) => void;
}): React.JSX.Element | null {
  if (notices.length === 0) return null;
  return (
    <>
      {notices.map((n) => (
        <div
          key={n.id}
          data-notice-kind={n.kind}
          className={cx(
            'slip-enter flex items-center gap-2 border-b border-s4 px-3 py-1.5',
            // The passive notice sits a step quieter than the one asking for a decision.
            n.kind === 'drift' ? 'bg-warn/7' : 'bg-warn/4',
          )}
        >
          <StatusDot status={DOT[n.kind]} />
          <span className="flex-none text-sec text-s11">{NAME[n.kind]}</span>
          <Tooltip label={n.reason} side="top">
            <span tabIndex={0} className="min-w-0 flex-1 truncate text-code text-s8">
              {n.summary}
            </span>
          </Tooltip>
          {n.actions?.map((a) => (
            <Button key={a.id} onClick={() => onAction(n.id, a.id)}>
              {a.label}
            </Button>
          ))}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => onAction(n.id, 'dismiss')}
            className="slip slip-press flex-none cursor-pointer rounded-r1 p-0.5 text-s7 hover:bg-s4 hover:text-s10 focus-visible:outline-focus active:scale-[0.97]"
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
    </>
  );
}
