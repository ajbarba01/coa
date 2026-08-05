import { useState } from 'react';
import { PopoverCard, StepSlider, cx } from '@coa/console-kit';

/**
 * The console's reasoning-effort control, in its two placements.
 *
 * Effort is a SECOND axis, not a property of the model choice: the same model runs at
 * every stop, and moving a stop is a far more frequent act than switching backends. On
 * the agent editor's roomy field the ladder sits in flow under the model; on the
 * composer's dense shelf it is its own chip, so neither axis is buried inside the
 * other's popup.
 */

export interface EffortLadderProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}

/** The reasoning ladder and its three end captions. One renderer for both placements, so
 *  the surfaces cannot drift. It inherits its container's padding rather than choosing
 *  its own — a control that padded itself could not sit flush in a field. */
export function EffortLadder({ options, value, onChange }: EffortLadderProps): React.JSX.Element {
  const current = options.find((o) => o.value === value);
  return (
    <div className="flex flex-col gap-1">
      <StepSlider
        stops={options.map((o) => o.value)}
        value={value}
        onChange={onChange}
        aria-label="Reasoning effort"
      />
      {/* A THREE-COLUMN GRID, not absolute positioning. Real stop names run long ("No
          thinking", "max"), and absolutely-positioned ends sit outside flow, so the
          centred current value had nothing to push against and collided with them. Each
          cell owns its own track and truncates inside it.
          The ends are sized to their CONTENT rather than to a third of the row: on the
          16.5rem rail the editor's two-column layout uses, an even third is narrower than
          "No thinking" and clipped a caption that had room to spare. `minmax(0,…)` keeps
          every track shrinkable, so a genuinely cramped row still degrades by truncating
          instead of overflowing. */}
      <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,auto)] items-baseline gap-1.5 font-mono text-meta text-s7">
        <span className="truncate">{options[0]?.label}</span>
        <span className="truncate text-center text-s9">{current?.label ?? value}</span>
        <span className="truncate text-right">{options[options.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export interface ReasoningChipProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

/** The composer shelf's reasoning chip: the current stop named on a trigger that grows the
 *  ladder. Renders NOTHING when the model offers no ladder — a control with one position
 *  is not a control, and a shelf slot that means nothing still costs a glance. */
export function ReasoningChip({
  options,
  value,
  onChange,
  disabled = false,
}: ReasoningChipProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (options.length === 0) return null;
  const current = options.find((o) => o.value === value);

  return (
    <PopoverCard
      open={open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
      side="top"
      // The shelf packs right, so this chip's LEFT edge moves every time the stop's name
      // changes width — the popup hangs from the edge that holds still.
      align="end"
      className="w-56"
      // The ladder owns the card's padding, so the surface must not add its own on top.
      flush
      tooltip={{ label: 'Reasoning effort', side: 'top' }}
      trigger={
        <button
          type="button"
          aria-label="Reasoning"
          disabled={disabled}
          className={cx(
            'inline-flex flex-none items-center gap-1.5 rounded-r2 px-2 py-1 font-mono text-meta',
            disabled
              ? 'cursor-default text-s6'
              : cx(
                  'slip slip-press cursor-pointer active:scale-[0.97]',
                  open ? 'bg-s4 text-s11' : 'text-s9 hover:bg-s4 hover:text-s11',
                ),
          )}
        >
          <span className="truncate">{current?.label ?? value}</span>
          <span aria-hidden>▾</span>
        </button>
      }
    >
      {/* Titled, because a bare ladder names its own stops and nothing else — a popup of
          three words and a track left you to infer which axis you were moving. The title
          sits in the CAPTIONS' own register rather than shouting in caps above them: it
          belongs to this control, and a header loud enough to outrank the value it labels
          is the wrong way round. One padding owner, so the box is even on all four sides. */}
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <span className="font-mono text-meta text-s7">Reasoning effort</span>
        <EffortLadder options={options} value={value} onChange={onChange} />
      </div>
    </PopoverCard>
  );
}
