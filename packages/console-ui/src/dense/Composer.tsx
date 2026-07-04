import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../actions/Button.js';
import { cx } from '../lib/cx.js';

export interface ComposerProps {
  onSend: (text: string) => void;
  onInterrupt?: () => void;
  running?: boolean;
  disabled?: boolean;
  /** Host-provided controls anchored to the leading edge of the toolbar row
   *  (model/effort selects). */
  slotStart?: React.ReactNode;
  /** Host-provided controls anchored just before the send/stop toggle. */
  slotEnd?: React.ReactNode;
}

/** A multiline auto-growing message composer with a send/stop toggle.
 *
 *  Keymap seam: the textarea's `onKeyDown` is the single interception point
 *  for Enter/Shift+Enter/Esc. These three are kept intrinsic (inline) —
 *  a future rebindable global keymap would wrap this handler, not replace it. */
export function Composer({
  onSend,
  onInterrupt,
  running,
  disabled,
  slotStart,
  slotEnd,
}: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow to fit the prompt: reset to `auto` (so it can shrink when text is
  // deleted), then grow to the content height. `max-h-40` caps the growth and
  // `overflow-y-auto` turns the box scrollable past that cap — the industry-standard
  // composer behaviour, no manual resize handle. Runs after every value change.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const send = (): void => {
    const body = text.trim();
    if (body === '' || disabled === true) return;
    onSend(body);
    setText('');
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border-default bg-raised p-2.5">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          } else if (e.key === 'Escape' && running === true) {
            e.preventDefault();
            onInterrupt?.();
          }
        }}
        rows={1}
        disabled={disabled}
        placeholder="Message the agent…"
        aria-label="Message the agent"
        className={cx(
          'max-h-40 min-h-control-md w-full resize-none overflow-y-auto rounded-control border border-border-default bg-element px-2.5 py-2 text-body text-fg placeholder:text-faint',
          'disabled:opacity-50',
        )}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">{slotStart}</div>
        <div className="flex shrink-0 items-center gap-2">
          {slotEnd}
          {running === true ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onInterrupt?.()}
              disabled={onInterrupt === undefined}
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={send}
              disabled={disabled === true || text.trim() === ''}
            >
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
