import { useId } from 'react';
import { Select as RxSelect } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  disabled,
  className,
}: SelectProps): React.JSX.Element {
  const labelId = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <span id={labelId} className="text-[12px] font-medium text-fg">
        {label}
      </span>
      <RxSelect.Root
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        {...(onValueChange !== undefined ? { onValueChange } : {})}
        disabled={disabled ?? false}
      >
        <RxSelect.Trigger
          aria-labelledby={labelId}
          className={cx(
            'inline-flex h-7 items-center justify-between gap-2 rounded-control border border-border-default bg-element px-2 text-[13px] text-fg disabled:opacity-50',
            focusRing,
          )}
        >
          <RxSelect.Value placeholder={placeholder ?? 'Select…'} />
          <RxSelect.Icon>
            <Icon name={ChevronDown} size={14} />
          </RxSelect.Icon>
        </RxSelect.Trigger>
        <RxSelect.Portal>
          <RxSelect.Content className="z-[200] overflow-hidden rounded-surface border border-border-default bg-raised text-[13px] text-fg shadow-lg">
            <RxSelect.Viewport className="p-1">
              {options.map((opt) => (
                <RxSelect.Item
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled ?? false}
                  className="flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none data-[highlighted]:bg-element-hover data-[disabled]:opacity-50"
                >
                  <RxSelect.ItemText>{opt.label}</RxSelect.ItemText>
                  <RxSelect.ItemIndicator className="ml-auto">
                    <Icon name={Check} size={12} />
                  </RxSelect.ItemIndicator>
                </RxSelect.Item>
              ))}
            </RxSelect.Viewport>
          </RxSelect.Content>
        </RxSelect.Portal>
      </RxSelect.Root>
    </div>
  );
}
