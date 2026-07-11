import { Switch } from '@base-ui/react/switch';
import { cx } from '../cx.js';

export interface ToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Boxy switch: NEUTRAL fill when on — accent blue stays reserved for running.
 *  Base UI owns the switch semantics; the kit owns the geometry. */
export function Toggle({
  on,
  onChange,
  disabled = false,
  ...aria
}: ToggleProps): React.JSX.Element {
  return (
    <Switch.Root
      // a real button: honest disabled semantics + focus/keyboard for free
      render={<button type="button" />}
      nativeButton
      checked={on}
      onCheckedChange={(next) => onChange(next)}
      disabled={disabled}
      className={cx(
        'slip relative h-[16px] w-[28px] flex-none rounded-r1 border',
        disabled
          ? 'cursor-default border-s4 bg-s2'
          : cx('cursor-pointer', on ? 'border-s7 bg-s6' : 'border-s5 bg-s3'),
      )}
      {...aria}
    >
      <Switch.Thumb
        className={cx(
          'slip-move absolute top-[2px] h-[10px] w-[10px] rounded-[2px]',
          on ? 'left-[14px]' : 'left-[2px]',
          disabled ? 'bg-s5' : on ? 'bg-s12' : 'bg-s8',
        )}
      />
    </Switch.Root>
  );
}
