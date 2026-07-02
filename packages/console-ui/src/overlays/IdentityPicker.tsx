import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';
import {
  AGENT_COLOR_NAMES,
  AGENT_GLYPHS,
  AGENT_ICON_NAMES,
  AGENT_SOLID_CLASSES,
  AgentChip,
  type AgentColorName,
  type AgentIconName,
} from '../data/AgentChip.js';
import { Popover } from './Popover.js';

export interface IdentityPickerProps {
  icon: AgentIconName;
  color: AgentColorName;
  onIconChange: (icon: AgentIconName) => void;
  onColorChange: (color: AgentColorName) => void;
  /** Accessible name for the trigger (e.g. the agent name); the action is appended. */
  label: string;
  disabled?: boolean;
}

/** Choose an agent's icon and color from the curated vocabulary. The trigger is
 *  the live lg identity chip itself; picks preview instantly because the parent
 *  owns the value and re-renders the chip. */
export function IdentityPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
  label,
  disabled,
}: IdentityPickerProps): React.JSX.Element {
  return (
    <Popover
      trigger={
        <button
          type="button"
          aria-label={`${label} — change icon and color`}
          disabled={disabled ?? false}
          className={cx(
            'rounded-surface border border-transparent p-0.5 transition-transform duration-fast',
            'enabled:hover:border-border-default enabled:active:scale-95 data-[state=open]:border-border-default',
            'disabled:opacity-50',
            focusRing,
          )}
        >
          <AgentChip icon={icon} color={color} size="lg" />
        </button>
      }
    >
      <div className="flex w-56 flex-col gap-3">
        <div role="group" aria-label="Icon" className="flex flex-col gap-1.5">
          <span className="text-eyebrow font-semibold uppercase tracking-[0.06em] text-faint">
            Icon
          </span>
          <div className="grid grid-cols-8 gap-1">
            {AGENT_ICON_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={name === icon}
                onClick={() => onIconChange(name)}
                className={cx(
                  'flex h-6 w-6 items-center justify-center rounded-control transition-transform duration-fast active:scale-95',
                  name === icon
                    ? 'bg-element-active text-fg'
                    : 'text-muted hover:bg-element-hover hover:text-fg',
                  focusRing,
                )}
              >
                <Icon name={AGENT_GLYPHS[name]} size={14} />
              </button>
            ))}
          </div>
        </div>
        <div role="group" aria-label="Color" className="flex flex-col gap-1.5">
          <span className="text-eyebrow font-semibold uppercase tracking-[0.06em] text-faint">
            Color
          </span>
          <div className="flex gap-1.5">
            {AGENT_COLOR_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={name === color}
                onClick={() => onColorChange(name)}
                className={cx(
                  'h-5 w-5 rounded-full transition-transform duration-fast hover:scale-110 active:scale-95',
                  AGENT_SOLID_CLASSES[name],
                  name === color && 'ring-2 ring-fg ring-offset-2 ring-offset-raised',
                  focusRing,
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </Popover>
  );
}
