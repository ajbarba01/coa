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
    <div className={cx('flex items-center gap-2', className)}>
      <RxCheckbox.Root
        id={id}
        {...(checked !== undefined ? { checked } : {})}
        {...(defaultChecked !== undefined ? { defaultChecked } : {})}
        {...(onCheckedChange !== undefined
          ? { onCheckedChange: (v: boolean | 'indeterminate') => onCheckedChange(v === true) }
          : {})}
        disabled={disabled ?? false}
        className={cx(
          'flex h-4 w-4 items-center justify-center rounded-[3px] border border-border-default bg-element data-[state=checked]:border-transparent data-[state=checked]:bg-accent disabled:opacity-50',
          focusRing,
        )}
      >
        <RxCheckbox.Indicator className="text-on-accent">
          <Icon name={Check} size={12} />
        </RxCheckbox.Indicator>
      </RxCheckbox.Root>
      <label htmlFor={id} className="text-[13px] text-fg">
        {label}
      </label>
    </div>
  );
}
