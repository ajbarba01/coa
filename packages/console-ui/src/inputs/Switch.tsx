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
    <div className={cx('flex items-center gap-2', className)}>
      <RxSwitch.Root
        id={id}
        {...(checked !== undefined ? { checked } : {})}
        {...(defaultChecked !== undefined ? { defaultChecked } : {})}
        {...(onCheckedChange !== undefined ? { onCheckedChange } : {})}
        disabled={disabled ?? false}
        className={cx(
          'relative h-4 w-7 rounded-full border border-border-default bg-element transition-colors duration-fast data-[state=checked]:border-transparent data-[state=checked]:bg-accent disabled:opacity-50',
          focusRing,
        )}
      >
        <RxSwitch.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-fg transition-transform duration-fast data-[state=checked]:translate-x-3.5 data-[state=checked]:bg-on-accent" />
      </RxSwitch.Root>
      <label htmlFor={id} className="text-[13px] text-fg">
        {label}
      </label>
    </div>
  );
}
