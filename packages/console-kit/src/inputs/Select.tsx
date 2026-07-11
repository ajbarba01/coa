import { Select as BaseSelect } from '@base-ui/react/select';
import { useState } from 'react';
import { cx } from '../cx.js';
import { menuSurface } from '../overlay/MenuCard.js';
import { useDismissLayer } from '../overlay/layers.js';

export interface SelectProps {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  'aria-label'?: string;
}

/** The quiet select: a bordered mono chip that grows a positioned option popup.
 *  Base UI owns focus, typeahead, keyboard selection, and placement; the kit
 *  owns the skin and the `current` marker. */
export function Select({ options, value, onChange, ...aria }: SelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  useDismissLayer(open, () => setOpen(false));
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(v) => {
        if (typeof v === 'string') onChange(v);
      }}
      open={open}
      onOpenChange={(next, details) => {
        // Same escape contract as PopoverCard: the kit's layer stack is the one
        // Escape authority — swallow Base UI's own escape close and let the
        // keydown keep bubbling to the stack's window listener.
        if (!next && details.reason === 'escape-key') {
          details.allowPropagation();
          return;
        }
        setOpen(next);
      }}
    >
      <BaseSelect.Trigger
        className={cx(
          'slip flex-none cursor-pointer rounded-r1 border px-2 py-[3px] font-mono text-code',
          open ? 'border-s5 text-s11' : 'border-s4 text-s9 hover:border-s5 hover:text-s11',
        )}
        {...aria}
      >
        <BaseSelect.Value /> ▾
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          alignItemWithTrigger={false}
          className="z-(--z-dropdown)"
        >
          <BaseSelect.Popup className={cx('slip-enter', menuSurface)}>
            {options.map((o) => (
              <BaseSelect.Item
                key={o}
                value={o}
                className={cx(
                  'slip flex w-full cursor-pointer items-center gap-4 px-3 py-1.5 text-left font-mono text-code whitespace-nowrap',
                  o === value
                    ? 'bg-s4 text-s12'
                    : 'text-s9 data-[highlighted]:bg-s4 data-[highlighted]:text-s11',
                )}
              >
                <BaseSelect.ItemText>{o}</BaseSelect.ItemText>
                {o === value && (
                  <span className="ml-auto font-mono text-caps tracking-normal text-s7">
                    current
                  </span>
                )}
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
