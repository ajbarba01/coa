import { useId, useMemo, useState } from 'react';
import { cx, focusRing } from '../lib/cx.js';

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  label: string;
  options: ComboboxOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function Combobox({
  label,
  options,
  value,
  onValueChange,
  placeholder,
  className,
}: ComboboxProps): React.JSX.Element {
  const labelId = useId();
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const [query, setQuery] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())),
    [options, query],
  );

  function choose(opt: ComboboxOption): void {
    setQuery(opt.label);
    setOpen(false);
    onValueChange?.(opt.value);
  }

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <span id={labelId} className="text-[12px] font-medium text-fg">
        {label}
      </span>
      <div className="relative">
        <input
          role="combobox"
          aria-labelledby={labelId}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          placeholder={placeholder ?? ''}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          className={cx(
            'h-7 w-full rounded-control border border-border-default bg-element px-2 text-[13px] text-fg placeholder:text-faint',
            focusRing,
          )}
        />
        {open && filtered.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-[200] mt-1 max-h-56 w-full overflow-auto rounded-surface border border-border-default bg-raised p-1 text-[13px] text-fg shadow-lg"
          >
            {filtered.map((opt) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                // onMouseDown (not onClick) so it fires before the input blur closes the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(opt);
                }}
                className="cursor-default rounded-control px-2 py-1 hover:bg-element-hover aria-selected:bg-element-active"
              >
                {opt.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
