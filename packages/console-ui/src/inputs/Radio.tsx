import { useId } from 'react';
import { RadioGroup } from 'radix-ui';
import { cx, focusRing } from '../lib/cx.js';

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioProps {
  label: string;
  options: RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function Radio({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  className,
}: RadioProps): React.JSX.Element {
  const labelId = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <span id={labelId} className="text-label font-medium text-fg">
        {label}
      </span>
      <RadioGroup.Root
        aria-labelledby={labelId}
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        {...(onValueChange !== undefined ? { onValueChange } : {})}
        className="flex flex-col gap-1.5"
      >
        {options.map((opt) => {
          const id = `${labelId}-${opt.value}`;
          return (
            <div key={opt.value} className={cx('flex items-center gap-2', !opt.disabled && 'group')}>
              <RadioGroup.Item
                id={id}
                value={opt.value}
                disabled={opt.disabled ?? false}
                className={cx(
                  "relative flex h-control-indicator w-control-indicator shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-default bg-element transition-colors duration-fast before:absolute before:-inset-1.5 before:content-[''] group-hover:border-accent data-[state=checked]:border-accent disabled:cursor-not-allowed disabled:opacity-50",
                  focusRing,
                )}
              >
                <RadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-accent" />
              </RadioGroup.Item>
              <label
                htmlFor={id}
                className={cx(
                  'text-body text-fg',
                  opt.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                )}
              >
                {opt.label}
              </label>
            </div>
          );
        })}
      </RadioGroup.Root>
    </div>
  );
}
