import { cx } from '@coa/console-kit';

/**
 * The panels' one text input — the third consumer (LoginFlow) is what earned the
 * extraction (AuthPanel and ModelEditor each carried a private copy before). One
 * vocabulary: mono text on the s1 well, border step-up on focus (inputs opt out of the
 * focus ring — the container border IS the cue), Enter commits, Escape cancels only
 * when there is a cancel to run (swallowing it otherwise strands the key — a focused
 * dialog field would eat the dialog's own Escape).
 */
export function TextInput({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  type = 'text',
  autoFocus = false,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  placeholder: string;
  /** `password` masks a secret; `email` invites the OS keyboard/autofill shape. */
  type?: 'text' | 'password' | 'email';
  autoFocus?: boolean;
  className?: string;
  /** Defaults to the placeholder — override when the placeholder is an example value. */
  'aria-label'?: string;
}): React.JSX.Element {
  return (
    <input
      // The row IS the interaction — it opened because the user asked for it, so the
      // caret belongs in it. (Not a page-load autofocus.)
      autoFocus={autoFocus}
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit?.();
        if (e.key === 'Escape' && onCancel !== undefined) {
          e.stopPropagation();
          onCancel();
        }
      }}
      className={cx(
        'slip min-w-0 rounded-r2 border border-s5 bg-s1 px-2.5 py-1 font-mono text-code text-s11 outline-none placeholder:text-s7 focus:border-s7',
        className,
      )}
    />
  );
}
