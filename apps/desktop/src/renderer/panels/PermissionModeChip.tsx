import { useState } from 'react';
import type { PermissionMode } from '@coa/console-viewmodel';
import {
  CapsLabel,
  InlineMessage,
  MenuItem,
  PopoverCard,
  StatusDot,
  cx,
  type SessionStatus,
} from '@coa/console-kit';

/**
 * The composer shelf's permission-mode chip — F2's live, ruled-color-ramp control.
 * Mirrors the model/reasoning chips beside it (`ModelPicker`/`ReasoningChip`): a
 * trigger naming the current state, opening a popup of the other choices. Mode is
 * enforced ONLY by the daemon's mode-aware `canUseTool` predicate; this control
 * only reflects/selects it — picking a row calls `onChange` and nothing else, so
 * the daemon's own `mode` push is what actually confirms the switch.
 *
 * No confirmation gate on switching TO a riskier mode (the ruled design
 * philosophy): visibility IS the guardrail. The trigger always renders off
 * `effectiveMode`, never the merely-configured `mode` — SC-1 honesty: a degraded
 * session (no approval seam on the active backend) must show as the bypass it
 * actually is, never as the plan/manual/edits it was asked for.
 */

const MODE_ORDER: readonly PermissionMode[] = ['plan', 'manual', 'edits', 'bypass'];

const MODE_COPY: Record<PermissionMode, { label: string; hint: string }> = {
  plan: { label: 'Plan', hint: 'Read-only — no writes, no commands' },
  manual: { label: 'Manual', hint: 'Asks before a write or a command' },
  edits: { label: 'Edits', hint: 'Auto-approves edits, still asks before a command' },
  bypass: { label: 'Bypass', hint: 'Nothing blocked, nothing asked' },
};

/** The indicator-law dot per mode (state is a dot, never a word). */
const MODE_DOT: Record<PermissionMode, SessionStatus> = {
  plan: 'running',
  manual: 'idle',
  edits: 'needs-you',
  bypass: 'critical',
};

/** The ruled risk color ramp: plan calm blue, manual no accent at all, edits a
 *  warm amber, bypass the one FILLED face — the state where nothing is blocked
 *  must not read as calm. `bg-crit` against `text-s12` clears ~4:1 (short of the
 *  4.5:1 body-text floor, same documented tradeoff as the composer's own
 *  approve/deny gate below it — the largest legibility gain solid crit offers). */
const MODE_TRIGGER: Record<PermissionMode, string> = {
  plan: 'text-run',
  manual: 'text-s9',
  edits: 'text-warn',
  bypass: 'bg-crit font-semibold text-s12',
};

export interface PermissionModeChipProps {
  /** The session's CONFIGURED mode (what was picked, or the agent's default). */
  mode: PermissionMode;
  /** The mode actually enforced right now — the chip always RENDERS this one. */
  effectiveMode: PermissionMode;
  /** Present only when `effectiveMode !== mode` — the honest reason why. */
  degraded?: string | undefined;
  onChange: (mode: PermissionMode) => void;
  disabled?: boolean;
}

export function PermissionModeChip({
  mode,
  effectiveMode,
  degraded,
  onChange,
  disabled = false,
}: PermissionModeChipProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const copy = MODE_COPY[effectiveMode];
  const filled = effectiveMode === 'bypass';

  return (
    <PopoverCard
      open={open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
      side="top"
      align="end"
      className="w-64"
      tooltip={{
        label: degraded !== undefined ? `Permission mode — ${degraded}` : 'Permission mode',
        side: 'top',
      }}
      trigger={
        <button
          type="button"
          disabled={disabled}
          className={cx(
            'inline-flex flex-none items-center gap-1.5 rounded-r2 px-2 py-1 font-mono text-meta',
            disabled
              ? 'cursor-default text-s6'
              : cx(
                  'slip slip-press cursor-pointer active:scale-[0.97]',
                  MODE_TRIGGER[effectiveMode],
                  filled ? (open ? 'brightness-110' : 'hover:brightness-110') : open && 'bg-s4',
                ),
          )}
        >
          <StatusDot status={MODE_DOT[effectiveMode]} />
          <span className="truncate">{copy.label}</span>
          <span aria-hidden>▾</span>
        </button>
      }
    >
      <CapsLabel>Permission mode</CapsLabel>
      {degraded !== undefined && (
        <div className="px-3 pt-0.5 pb-1.5">
          <InlineMessage tone="warning" className="text-fine">
            {degraded}
          </InlineMessage>
        </div>
      )}
      {MODE_ORDER.map((m) => (
        <MenuItem
          key={m}
          selected={m === mode}
          onClick={() => {
            onChange(m);
            setOpen(false);
          }}
        >
          <StatusDot status={MODE_DOT[m]} />
          <span className="flex min-w-0 flex-col">
            <span className="text-s11">{MODE_COPY[m].label}</span>
            <span className="truncate font-mono text-fine text-s7">{MODE_COPY[m].hint}</span>
          </span>
        </MenuItem>
      ))}
    </PopoverCard>
  );
}
