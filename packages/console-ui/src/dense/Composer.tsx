import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Mic, Square } from 'lucide-react';
import { Button } from '../actions/Button.js';
import { IconButton } from '../actions/IconButton.js';
import { Divider } from '../layout/Divider.js';
import { cx } from '../lib/cx.js';

/** How a message typed while the agent is running should be delivered. `barge-in` interrupts the
 *  in-flight turn and redirects it now (the Enter default); `queue` holds it to run after the
 *  current turn. */
export type SteerMode = 'queue' | 'barge-in';

export interface ComposerProps {
  onSend: (text: string) => void;
  /** Send a message while a turn is running — as a mid-turn redirect (`barge-in`) or a follow-up
   *  (`queue`). When absent, the running state falls back to the bare Stop affordance. */
  onSteer?: (text: string, mode: SteerMode) => void;
  onInterrupt?: () => void;
  running?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Leading attach-file control — inert (disabled) until a host wires a handler. */
  onAttach?: () => void;
  /** Trailing voice-input control — inert (disabled) until a host wires a handler. */
  onMic?: () => void;
  /** Host-provided controls rendered inline before the voice/send buttons
   *  (model/effort/permission selects). */
  slotStart?: React.ReactNode;
  /** Host-provided controls rendered inline after slotStart, before the voice/send buttons. */
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
  onSteer,
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

  /** Deliver the typed message to a running turn (queue = follow-up, barge-in = redirect now). */
  const steer = (mode: SteerMode): void => {
    const body = text.trim();
    if (body === '' || onSteer === undefined) return;
    onSteer(body, mode);
    setText('');
  };


  return (
    <div className="mx-auto w-full max-w-3xl p-2.5">
      <div
        className={cx(
          'flex flex-col gap-2 rounded-surface border border-hairline-lighter bg-raised p-2 shadow-md',
          'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus',
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
              // While running, Enter steers (barge-in) with the typed message; an empty box is
              // a no-op (steer() self-guards) — the dedicated Stop control / Esc bare-stops.
              if (running === true) steer('barge-in');
              else send();
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
            'max-h-40 min-h-control-md w-full resize-none rounded-control bg-transparent px-1.5 py-1.5 text-body text-fg placeholder:text-faint outline-none',
            overflowing ? 'overflow-y-auto' : 'overflow-hidden',
          )}
        />
        {disabled === true && (
          <p className="px-1.5 text-label text-faint">Select or start a session to chat.</p>
        )}
        <Divider className="bg-hairline-lighter" />
        <div className="flex items-center gap-1.5">
          <IconButton
            icon={Paperclip}
            label="Attach file"
            variant="tertiary"
            size="sm"
            onClick={onAttach}
            disabled={onAttach === undefined}
          />
          {slotStart}
          {slotEnd}
          <div className="ml-auto" />
          <IconButton
            icon={Mic}
            label="Voice input"
            variant="tertiary"
            size="sm"
            onClick={onMic}
            disabled={onMic === undefined}
          />
          {running === true ? (
            // Three actions while a turn runs: Queue (hold to run after) and Steer (redirect
            // now, the Enter default) — both disabled with an empty box so neither sends a
            // blank turn — plus a dedicated, always-on Stop that cleanly interrupts (SC-1: a
            // user stop, never a block).
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => steer('queue')}
                disabled={onSteer === undefined || text.trim() === ''}
              >
                Queue
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => steer('barge-in')}
                disabled={onSteer === undefined || text.trim() === ''}
              >
                Steer
              </Button>
              <IconButton
                icon={Square}
                label="Stop"
                variant="secondary"
                size="sm"
                onClick={() => onInterrupt?.()}
              />
            </>
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
  );
}
