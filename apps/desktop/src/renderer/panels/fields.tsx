import { cx } from '@coa/console-kit';

/** The panels' one text-input skin, exported so a raw `<input>` that needs the same
 *  look but not the rest of `TextInput`'s contract (`AgentsStrip`'s `type="search"`
 *  filter, which is a differently-shaped control: no commit/cancel, a search role)
 *  can share it by construction rather than by copy-paste. */
export const TEXT_INPUT_CLASS =
  'slip min-w-0 rounded-r2 border border-s5 bg-s1 px-2.5 py-1 font-mono text-code text-s11 outline-none placeholder:text-s7 focus:border-s7';

/**
 * The panels' one text input — the third consumer (LoginFlow) is what earned the
 * extraction (AuthPanel and ModelEditor each carried a private copy before). One
 * vocabulary: mono text on the s1 well, border step-up on focus (inputs opt out of the
 * focus ring — the container border IS the cue), Enter commits, Escape cancels only
 * when there is a cancel to run (swallowing it otherwise strands the key — a focused
 * dialog field would eat the dialog's own Escape), and blur commits too — the retired
 * console-ui `InlineEdit`'s behavior: clicking away from an edit must save it, not
 * silently discard it.
 */
export function TextInput({
  value,
  onChange,
  onCommit,
  onCancel,
  onBlur,
  placeholder,
  type = 'text',
  autoFocus = false,
  className,
  skin,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  /** Fires on blur — the click-away commit an inline-edit field needs (Enter/Escape
   *  alone leave "clicked elsewhere" with no save). Additive: existing callers that
   *  don't pass it keep behaving exactly as before. */
  onBlur?: () => void;
  placeholder: string;
  /** `password` masks a secret; `email` invites the OS keyboard/autofill shape. */
  type?: 'text' | 'password' | 'email';
  autoFocus?: boolean;
  className?: string;
  /** REPLACES the shared skin outright, rather than layering on top of it. A field that
   *  has to match a non-input face (the agent name's inline edit, which must not move or
   *  change family when it opens) cannot get there by appending — a later class does not
   *  reliably win on font-family — so it swaps the whole skin instead. */
  skin?: string;
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
      {...(onBlur !== undefined ? { onBlur } : {})}
      className={cx(skin ?? TEXT_INPUT_CLASS, className)}
    />
  );
}
