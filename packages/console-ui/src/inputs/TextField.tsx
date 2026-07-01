import type { InputHTMLAttributes } from 'react';
import { cx, focusRing } from '../lib/cx.js';
import { Field } from './Field.js';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'aria-invalid'
> {
  label: string;
  description?: string;
  error?: string;
}

const inputClass =
  'h-control-md rounded-control border border-border-default bg-element px-2.5 text-body text-fg ' +
  'placeholder:text-faint disabled:opacity-50 disabled:pointer-events-none ' +
  'data-[invalid=true]:border-danger';

export function TextField({
  label,
  description,
  error,
  className,
  ...rest
}: TextFieldProps): React.JSX.Element {
  return (
    <Field
      label={label}
      {...(description !== undefined ? { description } : {})}
      {...(error !== undefined ? { error } : {})}
    >
      {(ids) => (
        <input
          type="text"
          aria-labelledby={ids.labelId}
          aria-describedby={ids.describedBy}
          aria-invalid={ids.invalid || undefined}
          data-invalid={ids.invalid ? 'true' : undefined}
          className={cx(inputClass, focusRing, className)}
          {...rest}
        />
      )}
    </Field>
  );
}
