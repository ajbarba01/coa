import { useId } from 'react';
import { Checkbox as RxCheckbox } from 'radix-ui';
import { Check } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface CheckboxProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({
  label,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  className,
}: CheckboxProps): React.JSX.Element {
  const id = useId();
  return (
    <div className={cx('flex items-center gap-2', !disabled && 'group', className)}>
      <RxCheckbox.Root
        id={id}
        {...(checked !== undefined ? { checked } : {})}
        {...(defaultChecked !== undefined ? { defaultChecked } : {})}
        {...(onCheckedChange !== undefined
          ? { onCheckedChange: (v: boolean | 'indeterminate') => onCheckedChange(v === true) }
          : {})}
        disabled={disabled ?? false}
        className={cx(
          "relative flex h-control-indicator w-control-indicator shrink-0 cursor-pointer items-center justify-center rounded-control border border-border-default bg-element before:absolute before:-inset-1.5 before:content-[''] group-hover:border-accent data-[state=checked]:border-transparent data-[state=checked]:bg-accent data-[state=checked]:group-hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50",
          focusRing,
        )}
      >
        <RxCheckbox.Indicator className="text-on-accent">
          <Icon name={Check} size={14} />
        </RxCheckbox.Indicator>
      </RxCheckbox.Root>
      <label
        htmlFor={id}
        className={cx(
          'text-body text-fg',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        )}
      >
        {label}
      </label>
    </div>
  );
}
