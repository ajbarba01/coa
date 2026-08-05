import { Slider } from '@base-ui/react/slider';
import { cx } from '../cx.js';

export interface StepSliderProps<T extends string> {
  stops: readonly T[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
}

/** A discrete step slider: named stops, boxy thumb. Base UI owns pointer,
 *  keyboard, and aria mechanics (value = the stop index); the kit maps
 *  index↔name and draws the rail.
 *
 *  GEOMETRY: the track is inset by exactly half the thumb's width, so the thumb
 *  parked on the first or last stop lands flush with the control's own edge. The
 *  control's visual extent is therefore its box — nothing bleeds past it on the
 *  right, nothing sits short of it on the left — and whatever padding a container
 *  gives it reads the same on both sides. Inset by less and the thumb overhangs one
 *  end; inset by more and the track floats inside a box wider than anything drawn. */
export function StepSlider<T extends string>({
  stops,
  value,
  onChange,
  'aria-label': ariaLabel,
}: StepSliderProps<T>): React.JSX.Element {
  const idx = stops.indexOf(value);
  const last = stops.length - 1;

  return (
    <Slider.Root
      value={idx}
      min={0}
      max={last}
      step={1}
      onValueChange={(v) => {
        const next = stops[v];
        if (next && next !== value) onChange(next);
      }}
    >
      <Slider.Control className="relative h-5 cursor-pointer touch-none">
        {/* left/right = half the 7px thumb; see the geometry note above. */}
        <Slider.Track className="absolute top-1/2 right-[3.5px] left-[3.5px] h-[3px] -translate-y-1/2 bg-s5">
          {/* filled span up to the thumb */}
          <Slider.Indicator className="slip-move absolute inset-y-0 bg-s8" />
          {/* stop ticks */}
          {stops.map((s, i) => (
            <span
              key={s}
              data-testid="step-tick"
              className={cx(
                'absolute top-1/2 h-[9px] w-[3px] -translate-x-1/2 -translate-y-1/2',
                i <= idx ? 'bg-s9' : 'bg-s6',
              )}
              style={{ left: `${(i / last) * 100}%` }}
            />
          ))}
          <Slider.Thumb
            aria-label={ariaLabel}
            getAriaValueText={(_, v) => stops[v] ?? ''}
            className="slip-move absolute top-1/2 h-[13px] w-[7px] -translate-x-1/2 -translate-y-1/2 bg-s11"
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
