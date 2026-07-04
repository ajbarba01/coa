import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Mic, Square } from 'lucide-react';
import { IconButton } from '../actions/IconButton.js';
import { cx } from '../lib/cx.js';

export interface ComposerProps {
  onSend: (text: string) => void;
  onInterrupt?: () => void;
  running?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Leading attach-file control — inert (disabled) until a host wires a handler. */
  onAttach?: () => void;
  /** Trailing voice-input control — inert (disabled) until a host wires a handler. */
  onMic?: () => void;
  /** Host-provided controls anchored to the leading edge of the toolbar row
   *  (model/effort/permission selects). */
  slotStart?: React.ReactNode;
  /** Host-provided controls anchored just before the send/stop toggle. */
  slotEnd?: React.ReactNode;
}

/** A multiline auto-growing message composer with a send/stop toggle, rendered as a
 *  floating rounded control surface (not a full-width bordered panel).
 *
 *  Keymap seam: the textarea's `onKeyDown` is the single interception point
 *  for Enter/Shift+Enter/Esc. These three are kept intrinsic (inline) —
 *  a future rebindable global keymap would wrap this handler, not replace it. */
export function Composer({
  onSend,
  onInterrupt,
  running,
  disabled,
  placeholder,
  onAttach,
  onMic,
  slotStart,
  slotEnd,
}: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [overflowing, setOverflowing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow to fit the prompt: reset to `auto` (so it can shrink when text is
  // deleted), then grow to the content height. `max-h-40` caps the growth.
  // Only allow a scrollbar once content actually exceeds the max height — the
  // always-on scrollbar bug: auto-grow makes scrollHeight >= clientHeight by ~1px
  // even for a single short line, so `overflow-y-auto` shows a phantom scrollbar.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    setOverflowing(el.scrollHeight > 160);
  }, [text]);

  const send = (): void => {
    const body = text.trim();
    if (body === '' || disabled === true) return;
    onSend(body);
    setText('');
  };

  return (
    <div className="p-2.5">
      <div
        className={cx(
          'flex flex-col gap-2 rounded-surface border border-border-default bg-raised p-2 shadow-md',
          disabled === true && 'opacity-60',
        )}
      >
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
          placeholder={placeholder ?? 'Message the agent…'}
          aria-label="Message the agent"
          className={cx(
            'max-h-40 min-h-control-md w-full resize-none rounded-control bg-transparent px-1.5 py-1.5 text-body text-fg placeholder:text-faint',
            overflowing ? 'overflow-y-auto' : 'overflow-hidden',
          )}
        />
        {disabled === true && (
          <p className="px-1.5 text-label text-faint">Select or start a session to chat.</p>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <IconButton
              icon={Paperclip}
              label="Attach file"
              variant="tertiary"
              size="sm"
              onClick={onAttach}
              disabled={onAttach === undefined}
            />
            {slotStart}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {slotEnd}
            <IconButton
              icon={Mic}
              label="Voice input"
              variant="tertiary"
              size="sm"
              onClick={onMic}
              disabled={onMic === undefined}
            />
            {running === true ? (
              <IconButton
                icon={Square}
                label="Stop"
                variant="secondary"
                size="sm"
                onClick={() => onInterrupt?.()}
                disabled={onInterrupt === undefined}
              />
            ) : (
              <IconButton
                icon={ArrowUp}
                label="Send"
                variant="primary"
                size="sm"
                onClick={send}
                disabled={disabled === true || text.trim() === ''}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
