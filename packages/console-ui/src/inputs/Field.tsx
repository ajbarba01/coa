import type { ReactNode } from 'react';
import { useId } from 'react';
import { Label } from 'radix-ui';
import { cx } from '../lib/cx.js';

export interface FieldControlIds {
  labelId: string;
  /** Space-joined ids of the visible description and/or error nodes (or undefined). */
  describedBy: string | undefined;
  invalid: boolean;
}

export interface FieldProps {
  label: string;
  description?: string;
  error?: string;
  className?: string;
  /** Render-prop: receives the ids/flags to spread onto the control. */
  children: (ids: FieldControlIds) => ReactNode;
}

export function Field({
  label,
  description,
  error,
  className,
  children,
}: FieldProps): React.JSX.Element {
  const base = useId();
  const labelId = `${base}-label`;
  const descId = description !== undefined ? `${base}-desc` : undefined;
  const errId = error !== undefined ? `${base}-err` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(' ') || undefined;
  const invalid = error !== undefined;

  return (
    <div
      className={cx('flex flex-col gap-1', className)}
      data-invalid={invalid ? 'true' : undefined}
    >
      <Label.Root id={labelId} className="text-label font-medium text-fg">
        {label}
      </Label.Root>
      {description !== undefined && (
        <span id={descId} className="text-caption text-muted">
          {description}
        </span>
      )}
      {children({ labelId, describedBy, invalid })}
      {error !== undefined && (
        <span id={errId} role="alert" className="text-caption text-danger-text">
          {error}
        </span>
      )}
    </div>
  );
}
