import { useId } from 'react';
import { Switch as RxSwitch } from 'radix-ui';
import { cx, focusRing } from '../lib/cx.js';

export interface SwitchProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Switch({
  label,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  className,
}: SwitchProps): React.JSX.Element {
  const id = useId();
  return (
    <div className={cx('flex items-center gap-2', !disabled && 'group', className)}>
      <RxSwitch.Root
        id={id}
        {...(checked !== undefined ? { checked } : {})}
        {...(defaultChecked !== undefined ? { defaultChecked } : {})}
        {...(onCheckedChange !== undefined ? { onCheckedChange } : {})}
        disabled={disabled ?? false}
        className={cx(
          "relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border-default bg-element before:absolute before:-inset-1.5 before:content-[''] group-hover:border-accent data-[state=checked]:border-transparent data-[state=checked]:bg-accent data-[state=checked]:group-hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50",
          focusRing,
        )}
      >
        <RxSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-fg transition-transform duration-fast data-[state=checked]:translate-x-4 data-[state=checked]:bg-on-accent" />
      </RxSwitch.Root>
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
