import {
  Button,
  CapsLabel,
  MenuItem,
  PopoverCard,
  StatusDot,
  StepSlider,
  cx,
} from '@coa/console-kit';
import { useEffect, useRef, useState } from 'react';

export interface QueuedMessage {
  id: string;
  text: string;
}

/** A pending approval, docked to the composer — the gate visibly blocks the
 *  conversation's input, which is what it actually does. */
export interface PendingApproval {
  id: string;
  tool: string;
  summary: string;
  diffStat?: string | undefined;
}

export interface ComposerProps {
  /** True while a governed turn is in flight — flips the action cluster to
   *  Stop + the Queue / Barge-in steer split, and lights the running edge. */
  running: boolean;
  /** No session at all — the whole composer rests disabled. */
  disabled?: boolean;
  queued?: QueuedMessage[];
  /** The gate waiting on you. While set, the composer wears the amber shimmer,
   *  ⏎ on an empty field approves, and typing redirects instead. */
  approval?: PendingApproval | undefined;
  /** The real model seam (from the ChatVm): pre-labelled by the parent via
   *  `modelPickerLabel`. */
  models: { id: string; label: string }[];
  currentModelId?: string | undefined;
  onPickModel: (id: string) => void;
  /** The real reasoning-effort seam (console-viewmodel `effortOptions` /
   *  `reasoningValue` / `toReasoning`). Empty ⇒ the effort control hides
   *  (thinking-only models). */
  effortOptions: { value: string; label: string }[];
  effortValue: string;
  onPickEffort: (v: string) => void;
  onSend: (text: string) => void;
  onQueue?: (text: string) => void;
  onBarge?: (text: string) => void;
  onStop?: () => void;
  onRemoveQueued?: (id: string) => void;
  onApprove?: (id: string) => void;
  onDeny?: (id: string) => void;
  /** "Tell the agent to do something else": denies the request and sends the
   *  typed instruction in its place. */
  onRedirect?: (id: string, text: string) => void;
  /** Rendered above the whole composer stack (queued pins included) — the
   *  transcript's jump-to-latest pill anchors here so it always clears
   *  whatever the composer is showing. */
  above?: React.ReactNode;
}

/** The composer: a floating shell over the transcript's floor, and the
 *  session's attention port. One rect, two rows — the message field on the
 *  search-field skin (s3 · s5 hairline) and the control shelf under its
 *  hairline.
 *
 *  The session's state lives on the shell's own edge: a tinted border plus
 *  the status-outline shimmer — two soft comets traveling the whole border
 *  path in the status's color (run-blue while running, amber while a gate
 *  waits; reduced-motion drops the comets, the tint stays). Idle wears no
 *  state at all.
 *
 *  States: resting (send ↑, disabled until text) · running (Stop always; with
 *  text the send slot becomes the steer split — Queue waits for the turn's
 *  end, Barge-in redirects it now) · approval docked above the field (approve
 *  / deny / or type to redirect) · no-session (everything rests). Queued
 *  messages pin above the shell, removable, released FIFO.
 *
 *  Permission mode is a presentational placeholder only (local state) — a
 *  future M3 permission gate owns real enforcement (SC-1: surfacing only).
 *  The mic is a permanently-disabled coming-soon affordance. */
export function Composer({
  running,
  disabled = false,
  queued = [],
  approval,
  models,
  currentModelId,
  onPickModel,
  effortOptions,
  effortValue,
  onPickEffort,
  onSend,
  onQueue,
  onBarge,
  onStop,
  onRemoveQueued,
  onApprove,
  onDeny,
  onRedirect,
  above,
}: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [perm, setPerm] = useState<string>('ask edits');
  const [attachments, setAttachments] = useState<string[]>([]);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Multi-line growth: the field grows with its content to ~6 lines, then
  // scrolls. Measured, not guessed — height follows scrollHeight.
  const autoGrow = (): void => {
    const el = areaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };
  useEffect(autoGrow, [text]);

  const take = (): string | undefined => {
    const t = text.trim();
    if (t === '') return undefined;
    setText('');
    setAttachments([]);
    return t;
  };

  const send = (): void => {
    const t = take();
    if (t === undefined) return;
    if (approval !== undefined) onRedirect?.(approval.id, t);
    else onSend(t);
  };
  const queueMessage = (): void => {
    const t = take();
    if (t !== undefined) onQueue?.(t);
  };
  const barge = (): void => {
    const t = take();
    if (t !== undefined) onBarge?.(t);
  };

  const hasText = text.trim() !== '';
  const edge: 'running' | 'needs-you' | undefined =
    approval !== undefined ? 'needs-you' : running ? 'running' : undefined;

  return (
    <div className="absolute bottom-4 left-1/2 w-[calc(100%-64px)] max-w-[656px] -translate-x-1/2">
      {above}
      {/* queued messages pin above the shell — removable, released FIFO */}
      {queued.length > 0 && (
        <div className="mb-1.5 flex flex-col gap-1">
          {queued.map((q, i) => (
            <div
              key={q.id}
              className="slip-enter flex items-center gap-2 rounded-r2 border border-s4 bg-s2 px-2.5 py-1.5 shadow-[var(--shadow-composer)]"
            >
              <span aria-hidden className="font-mono text-meta text-s6">
                {i === 0 ? '⇥ next' : `⇥ ${i + 1}`}
              </span>
              <span className="min-w-0 flex-1 truncate text-sec text-s10">{q.text}</span>
              <button
                type="button"
                aria-label={`remove queued message: ${q.text}`}
                onClick={() => onRemoveQueued?.(q.id)}
                className="slip cursor-pointer font-mono text-caps text-s7 hover:text-s10"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* no overflow-hidden on the shell — the chip menus must escape its bounds */}
      <div
        className={cx(
          'relative rounded-r3 border bg-s3 shadow-[var(--shadow-composer)]',
          disabled
            ? 'border-s4'
            : edge === 'running'
              ? 'border-run/55'
              : edge === 'needs-you'
                ? 'border-warn/55'
                : 'border-s5 focus-within:border-s6',
        )}
      >
        {edge !== undefined && (
          // The shimmer: two soft comets traveling the whole border path at
          // constant speed, in the status's own color (see .status-outline).
          <svg
            aria-hidden
            className="status-outline"
            style={
              {
                '--outline-color': edge === 'running' ? 'var(--color-run)' : 'var(--color-warn)',
              } as React.CSSProperties
            }
          >
            <rect pathLength={100} className="comet-halo" />
            <rect pathLength={100} className="comet-core" />
          </svg>
        )}
        {/* the gate, MERGED into the shell: the request is the composer's top
            section, and the section's two halves ARE the buttons — the whole
            left half denies, the whole right half approves. The corner labels
            name the halves; hovering a half washes it with its verdict. */}
        {approval !== undefined && (
          <div className="slip-enter relative overflow-hidden rounded-t-r3 border-b border-s4">
            <div className="absolute inset-0 grid grid-cols-2">
              <button
                type="button"
                aria-label={`deny: ${approval.tool} ${approval.summary}`}
                onClick={() => onDeny?.(approval.id)}
                className="group/deny slip flex cursor-pointer items-end justify-start bg-crit/6 p-2 hover:bg-crit/12"
              >
                <span className="slip font-mono text-[9.5px] text-crit/60 group-hover/deny:text-crit">
                  ⌫ deny
                </span>
              </button>
              <button
                type="button"
                aria-label={`approve: ${approval.tool} ${approval.summary}`}
                onClick={() => onApprove?.(approval.id)}
                className="group/appr slip flex cursor-pointer items-end justify-end border-l border-s4/60 bg-ok/6 p-2 hover:bg-ok/12"
              >
                <span className="slip font-mono text-[9.5px] text-ok/60 group-hover/appr:text-ok">
                  approve ⏎
                </span>
              </button>
            </div>
            <div className="pointer-events-none relative px-3 pt-2.5 pb-7">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="motion-safe:animate-pulse">
                  <StatusDot status="needs-you" />
                </span>
                <span className="font-[550] text-s11">{approval.tool}</span>
                <span className="font-mono text-caps text-s6">wants to run</span>
                {approval.diffStat !== undefined && (
                  <span className="ml-auto font-mono text-meta text-s7">{approval.diffStat}</span>
                )}
              </div>
              <div className="mt-1.5 font-mono text-code break-all text-s11">
                {approval.summary}
              </div>
            </div>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachments.map((a) => (
              <span
                key={a}
                className="slip-enter flex items-center gap-1.5 rounded-r1 border border-s5 bg-s4 px-1.5 py-0.5 font-mono text-meta text-s9"
              >
                {a}
                <button
                  type="button"
                  aria-label={`remove ${a}`}
                  onClick={() => setAttachments((list) => list.filter((x) => x !== a))}
                  className="slip cursor-pointer text-caps text-s7 hover:text-s10"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // ⌫ on an empty field denies the merged gate (mirrors its label).
            if (approval !== undefined && e.key === 'Backspace' && text === '') {
              e.preventDefault();
              onDeny?.(approval.id);
              return;
            }
            if (e.key !== 'Enter' || e.shiftKey) return;
            e.preventDefault();
            if (approval !== undefined) {
              // Empty ⏎ approves the merged gate; typed text redirects instead.
              if (hasText) send();
              else onApprove?.(approval.id);
              return;
            }
            if (!running) send();
            else if (e.altKey) barge();
            else queueMessage();
          }}
          placeholder={
            disabled
              ? 'no session — start one to talk to an agent'
              : approval !== undefined
                ? 'approve or deny above — or tell the agent what to do instead…'
                : running
                  ? 'queue a message… (⌥⏎ barges in · esc stops)'
                  : 'Message builder…'
          }
          className={cx(
            'block w-full resize-none bg-transparent px-3.5 py-2.5 text-body leading-[1.5] outline-none',
            disabled
              ? 'cursor-default text-s6 placeholder:text-s5'
              : 'text-s11 placeholder:text-s7',
          )}
        />
        {/* the control shelf: same rect, its own hairline */}
        <div className="flex items-center gap-1 border-t border-s4 px-2 py-1.5">
          <AttachButton
            disabled={disabled}
            onAttach={(name) => setAttachments((a) => (a.includes(name) ? a : [...a, name]))}
          />
          <MicButton disabled={disabled} />
          <div className="flex-1" />
          <PermissionChip value={perm} onPick={setPerm} disabled={disabled} />
          <ModelChip
            models={models}
            currentModelId={currentModelId}
            onPickModel={onPickModel}
            effortOptions={effortOptions}
            effortValue={effortValue}
            onPickEffort={onPickEffort}
            disabled={disabled}
          />
          {!running ? (
            <Button
              variant="primary"
              icon
              aria-label={approval !== undefined && hasText ? 'redirect' : 'send'}
              disabled={disabled || !hasText}
              onClick={send}
            >
              ↑
            </Button>
          ) : (
            <>
              {hasText && (
                <>
                  <Button onClick={queueMessage} title="waits for the turn to end (⏎)">
                    queue
                  </Button>
                  <Button
                    variant="outline"
                    onClick={barge}
                    title="redirects the running turn now (⌥⏎)"
                  >
                    barge in
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                icon
                aria-label="stop the running turn"
                title="stop (esc)"
                onClick={() => onStop?.()}
                className="hover:border-crit/60 hover:text-crit"
              >
                ■
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* chips (search-field skin; disabled states included)                  */
/* ------------------------------------------------------------------ */

// The glyph is an autonomy meter — the circle fills as the agent's leash lengthens.
// Presentational only (SC-1): a future M3 permission gate owns real enforcement.
const PERMISSIONS = [
  { id: 'read only', glyph: '○', desc: 'nothing is written' },
  { id: 'ask edits', glyph: '◔', desc: 'writes wait for approval' },
  { id: 'auto edits', glyph: '◑', desc: 'writes land; commands still ask' },
  { id: 'full auto', glyph: '●', desc: 'only the cost cap says no' },
] as const;

function AttachButton({
  onAttach,
  disabled = false,
}: {
  onAttach: (name: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <PopoverCard
      open={open}
      onOpenChange={(o) => {
        if (!disabled) setOpen(o);
      }}
      side="top"
      align="start"
      className="w-48"
      trigger={
        <button
          type="button"
          aria-label="attach"
          disabled={disabled}
          className={cx(
            'flex h-7 w-7 items-center justify-center rounded-r2 border',
            disabled
              ? 'cursor-default border-s4 bg-s3 text-s6'
              : cx(
                  'slip slip-press cursor-pointer text-s10 active:scale-[0.95]',
                  open ? 'border-s6 bg-s5 text-s12' : 'border-s5 bg-s4 hover:bg-s5 hover:text-s12',
                ),
          )}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
      }
    >
      <MenuItem
        onClick={() => {
          onAttach('screenshot.png');
          setOpen(false);
        }}
      >
        <span className="w-4 text-center font-mono text-code text-s8">⇪</span>
        upload file…
      </MenuItem>
    </PopoverCard>
  );
}

/** Voice-to-text — a coming-soon affordance (maintainer ruling): it renders
 *  permanently disabled with no handler. Sits with the attach button so the
 *  shelf's final shape is already in place for whenever it lands. */
function MicButton({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label="voice input — coming soon"
      title="voice input — coming soon"
      disabled
      aria-disabled="true"
      className={cx(
        'flex h-7 w-7 cursor-default items-center justify-center rounded-r2 border border-s4 bg-s3 text-s6',
        disabled && 'opacity-70',
      )}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
    </button>
  );
}

/** A composer chip that grows a floating card above itself. */
function ChipMenu({
  chip,
  title,
  open,
  setOpen,
  disabled = false,
  children,
}: {
  chip: string;
  title: string;
  open: boolean;
  setOpen: (o: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <PopoverCard
      open={open}
      onOpenChange={(o) => {
        if (!disabled) setOpen(o);
      }}
      trigger={
        <button
          type="button"
          title={title}
          disabled={disabled}
          className={cx(
            'rounded-r2 px-2 py-1 font-mono text-meta',
            disabled
              ? 'cursor-default text-s6'
              : cx(
                  'slip cursor-pointer',
                  open ? 'bg-s4 text-s11' : 'text-s9 hover:bg-s4 hover:text-s11',
                ),
          )}
        >
          {chip}
        </button>
      }
    >
      {children}
    </PopoverCard>
  );
}

function PermissionChip({
  value,
  onPick,
  disabled = false,
}: {
  value: string;
  onPick: (v: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const current = PERMISSIONS.find((p) => p.id === value);
  return (
    <ChipMenu
      chip={`${current?.glyph ?? ''} ${value}`}
      title="permission mode"
      open={open}
      setOpen={setOpen}
      disabled={disabled}
    >
      <div className="w-60">
        {PERMISSIONS.map((p) => (
          <MenuItem
            key={p.id}
            selected={p.id === value}
            className="items-start"
            onClick={() => {
              onPick(p.id);
              setOpen(false);
            }}
          >
            <span
              className={cx(
                'w-4 pt-px text-center font-mono text-[12px]',
                p.id === value ? 'text-s11' : 'text-s8',
              )}
            >
              {p.glyph}
            </span>
            <span className="flex flex-col gap-px">
              <span className={cx('text-[12px]', p.id === value ? 'text-s12' : 'text-s10')}>
                {p.id}
              </span>
              <span className="text-meta text-s7">{p.desc}</span>
            </span>
          </MenuItem>
        ))}
      </div>
    </ChipMenu>
  );
}

function ModelChip({
  models,
  currentModelId,
  onPickModel,
  effortOptions,
  effortValue,
  onPickEffort,
  disabled = false,
}: {
  models: { id: string; label: string }[];
  currentModelId?: string | undefined;
  onPickModel: (id: string) => void;
  effortOptions: { value: string; label: string }[];
  effortValue: string;
  onPickEffort: (v: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const currentModel = models.find((m) => m.id === currentModelId);
  const currentEffort = effortOptions.find((e) => e.value === effortValue);
  const modelLabel = currentModel?.label ?? currentModelId ?? 'model';
  const chip = currentEffort !== undefined ? `${modelLabel} · ${currentEffort.label}` : modelLabel;
  return (
    <ChipMenu
      chip={chip}
      title="model · reasoning effort"
      open={open}
      setOpen={setOpen}
      disabled={disabled}
    >
      <div className="w-60">
        <CapsLabel>model</CapsLabel>
        <div className="pb-1">
          {models.map((m) => (
            <MenuItem
              key={m.id}
              selected={m.id === currentModelId}
              className="font-mono text-code"
              onClick={() => onPickModel(m.id)}
            >
              {m.label}
            </MenuItem>
          ))}
        </div>
        {effortOptions.length > 0 && (
          <div className="border-t border-s4 px-3 pt-2 pb-3">
            <div className="flex items-baseline pb-1.5">
              <span className="text-caps tracking-[0.07em] text-s6 uppercase">reasoning</span>
              <span className="ml-auto font-mono text-meta text-s9">
                {currentEffort?.label ?? effortValue}
              </span>
            </div>
            <StepSlider
              stops={effortOptions.map((e) => e.value)}
              value={effortValue}
              onChange={onPickEffort}
              aria-label="reasoning effort"
            />
          </div>
        )}
      </div>
    </ChipMenu>
  );
}
