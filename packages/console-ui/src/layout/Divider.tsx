import { cx } from '../lib/cx.js';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export function Divider({
  orientation = 'horizontal',
  className,
}: DividerProps): React.JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cx(
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        'bg-hairline',
        className,
      )}
    />
  );
}
