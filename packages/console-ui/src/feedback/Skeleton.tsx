import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx.js';

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...rest }: SkeletonProps): React.JSX.Element {
  return (
    <div
      aria-hidden
      className={cx(
        'h-4 w-full rounded-control bg-element animate-pulse motion-reduce:animate-none',
        className,
      )}
      {...rest}
    />
  );
}
