import { Button, Icon, StatusDot, Tooltip, cx, menuSurface } from '@coa/console-kit';
import { estimateTokens } from '@coa/console-transcript';
import { useEffect, useRef, useState } from 'react';
import type {
  Attachment,
  AttachControlVm,
  InvocableSkill,
  ModelDescriptor,
  ModelMetadata,
  PermissionMode,
  SessionUsage,
} from '@coa/console-viewmodel';
import { reportFailure } from '../shell/failures.js';
import { useShell } from '../shell/store.js';
import type { ChatNotice } from './banners.js';
import { ContextRing } from './ContextRing.js';
import { ModelPicker } from './ModelPicker.js';
import { NoticeLine } from './NoticeLine.js';
import { PermissionModeChip } from './PermissionModeChip.js';
import { ReasoningChip } from './ReasoningPicker.js';
import type { Remote } from './state.js';
import { SurfaceError } from './surfaceStates.js';

export interface QueuedMessage {
  id: string;
  text: string;
}

/** A staged attachment: the wire shape plus the local facts the chips row shows. */
export interface DraftAttachment {
  id: number;
  attachment: Attachment;
  sizeBytes: number;
}

/** The image types every wired vision backend accepts. */
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Extensions read as text when the OS reports no usable MIME type. */
const TEXT_EXT =
  /\.(md|txt|json|ts|tsx|js|jsx|py|rs|go|java|c|h|cpp|cs|rb|sh|ps1|yaml|yml|toml|xml|html|css|sql|log|csv)$/i;

/** A hard intake ceiling — providers reject far smaller payloads anyway, and a
 *  base64 body this size would stall the RPC pipe. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function isTextLike(file: File): boolean {
  return (
    file.type.startsWith('text/') || file.type === 'application/json' || TEXT_EXT.test(file.name)
  );
}

/** Base64 payload only — the wire shape carries no `data:` prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** FileReader rather than `file.text()` — same mechanism as the image path, and
 *  implemented everywhere the app (and its jsdom tests) run. */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });
}

/** Compact size for the chips row: `812 B`, `24.1 KB`, `3.2 MB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A pending approval, docked to the composer — the gate visibly blocks the
 *  conversation's input, which is what it actually does. */
export interface PendingApproval {
  id: string;
  tool: string;
  summary: string;
  diffStat?: string | undefined;
}

/** The slash state a draft is in: the query while the whole draft is `/`+partial
 *  name (no whitespace yet — a space commits to it being prose), else nothing. */
export function slashQueryOf(text: string): string | undefined {
  const match = /^\/(\S*)$/.exec(text);
  return match === undefined || match === null ? undefined : match[1];
}

/** Pure: the invocable rows a slash query names — name match, case-insensitive,
 *  already-attached names excluded (invoking twice is one load). */
export function filterSkills(
  skills: readonly InvocableSkill[],
  query: string,
  attached: readonly string[],
): InvocableSkill[] {
  const q = query.trim().toLowerCase();
  const taken = new Set(attached.map((n) => n.toLowerCase()));
  return skills.filter(
    (s) => !taken.has(s.name.toLowerCase()) && (q === '' || s.name.toLowerCase().includes(q)),
  );
}

export interface ComposerProps {
  /** True while a governed turn is in flight — flips the action cluster to
   *  Stop + the Queue / Steer split, and lights the running edge. */
  running: boolean;
  /** No session at all — the whole composer rests disabled. */
  disabled?: boolean;
  /** The active session's id, undefined with no session. Used ONLY to detect a
   *  session switch: the drafted text and staged attachments below are local,
   *  unscoped React state, so without this they'd otherwise survive a switch and
   *  ride out under the WRONG session's `onSend` — see the reset-during-render
   *  check beside `text`/`attachments`. Not read for anything else. */
  activeSessionId?: string | undefined;
  queued?: QueuedMessage[];
  /** The gate waiting on you. While set, the composer wears the amber shimmer,
   *  ⏎ on an empty field approves, and typing redirects instead. */
  approval?: PendingApproval | undefined;
  /** F2 — the active session's CONFIGURED permission mode (what was picked/the
   *  agent's default). */
  mode: PermissionMode;
  /** F2 — the mode actually enforced right now; the chip renders off THIS, never
   *  `mode` (SC-1: never claim an enforcement the backend can't deliver). */
  effectiveMode: PermissionMode;
  /** F2 — present only when `effectiveMode !== mode` — the honest reason why. */
  modeDegraded?: string | undefined;
  /** F2 — live-switch the active session's permission mode. No confirmation gate:
   *  visibility IS the guardrail. */
  onSetMode: (mode: PermissionMode) => void;
  /** The real model seam (from the ChatVm), passed WHOLE. Flattening it to id+label here
   *  dropped each model's `provider`, which is what the picker groups and marks by — so
   *  every backend resolved to the Claude default and the shelf's list said so. */
  models: ModelDescriptor[];
  currentModelId?: string | undefined;
  onPickModel: (id: string) => void;
  /** The real reasoning-effort seam (console-viewmodel `effortOptions` /
   *  `reasoningValue` / `toReasoning`). Empty ⇒ the effort control hides
   *  (thinking-only models). */
  effortOptions: { value: string; label: string }[];
  effortValue: string;
  onPickEffort: (v: string) => void;
  /** Per-model catalog rows, for the picker's hover overview card. */
  modelMetadata?: ModelMetadata[];
  /** The ACTIVE model's catalog row — the context ring's window denominator. */
  activeModelMetadata?: ModelMetadata | undefined;
  /** The last settled turn's usage (the daemon's `usage` push); absent ⇒ unmeasured. */
  ringUsage?: SessionUsage | undefined;
  /** The attach control's capability matrix for the active model/backend. Absent ⇒
   *  attachments unavailable (the control explains itself, never vanishes). */
  attach?: AttachControlVm | undefined;
  /** The invocable library skills the slash popover offers (`/name` — an explicit
   *  one-turn load the daemon composes above the message), states-first: the popover
   *  says "reading" while it loads and shows the reason when the read failed, rather
   *  than claiming emptiness for either. */
  skills: Remote<InvocableSkill[]>;
  /** `attachments`/`invokeSkills` ride only a direct send — a queue/steer/redirect
   *  keeps staged attachments and attached invocations pinned in the composer rather
   *  than silently dropping them. */
  onSend: (text: string, attachments?: Attachment[], invokeSkills?: string[]) => void;
  onQueue?: (text: string) => void;
  onSteer?: (text: string) => void;
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
  /** Predictive prompt notices (drift/cache), rendered as sections INSIDE the
   *  shell above the gate. A standing fact about the prompt outranks one request
   *  inside it, and the gate keeps its adjacency to the field it blocks. */
  notices?: ChatNotice[];
  onNoticeAction?: (id: string, actionId: string) => void;
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
 *  end, Steer reaches it at its next step) · approval docked above the field (approve
 *  / deny / or type to redirect) · no-session (everything rests). Queued
 *  messages pin above the shell, removable, released FIFO.
 *
 *  The mic and attach buttons are permanently-disabled coming-soon affordances. */
export function Composer({
  running,
  disabled = false,
  activeSessionId,
  queued = [],
  approval,
  mode,
  effectiveMode,
  modeDegraded,
  onSetMode,
  models,
  currentModelId,
  onPickModel,
  effortOptions,
  effortValue,
  onPickEffort,
  modelMetadata,
  activeModelMetadata,
  ringUsage,
  attach,
  skills,
  onSend,
  onQueue,
  onSteer,
  onStop,
  onRemoveQueued,
  onApprove,
  onDeny,
  onRedirect,
  above,
  notices = [],
  onNoticeAction,
}: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Staged attachments: added by picker/paste/drop, removable, and released ONLY by a
  // direct send (queue/steer/redirect leave them pinned — visible, never dropped).
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);

  // Attached skill invocations (`/name`): staged like attachments — removable chips,
  // released only by a direct send. The slash popover below is how they get here.
  const [invoked, setInvoked] = useState<string[]>([]);
  // Escape closed the popover for THIS draft; any edit reopens the offer.
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashCursor, setSlashCursor] = useState(0);

  // A session switch must drop any staged-but-unsent draft rather than let it ride
  // out under the newly active session's `onSend` (or, worse, survive into a
  // session whose backend can't carry attachments at all). This is React's
  // "adjust state during render" pattern rather than a `key`-remount: remounting
  // the whole composer would also tear down/recreate its DOM node, which reruns
  // the focus-on-ask effect below against whatever `composerFocus` nonce the app
  // has already reached — stealing focus on a plain tab switch, not just a
  // deliberate ask. Comparing during render instead clears the draft before it
  // ever paints, with no such side effect.
  const [renderedSessionId, setRenderedSessionId] = useState(activeSessionId);
  if (activeSessionId !== renderedSessionId) {
    setRenderedSessionId(activeSessionId);
    setText('');
    setAttachments([]);
    setInvoked([]);
    setSlashDismissed(false);
  }
  const attachIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Drag state for the drop affordance — a quiet border step-up, no overlay.
  const [dragging, setDragging] = useState(false);

  /** The ONE intake funnel (picker, paste, drop): capability-gate per kind, refuse
   *  loudly (a toast with the reason), never accept something a send would fail. */
  const addFile = async (file: File): Promise<void> => {
    const name = file.name === '' ? 'that file' : file.name;
    if (attach === undefined) {
      reportFailure('attach a file', 'Attachments are unavailable here.');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reportFailure('attach a file', `${name} is over 10 MB.`);
      return;
    }
    if (IMAGE_MIME.has(file.type)) {
      if (!attach.image.enabled) {
        reportFailure('attach that image', `${attach.image.reason ?? 'Images are unavailable'}.`);
        return;
      }
      const data = await readBase64(file);
      append(
        {
          kind: 'image',
          mimeType: file.type,
          data,
          ...(file.name !== '' ? { name: file.name } : {}),
        },
        file.size,
      );
      return;
    }
    if (isTextLike(file)) {
      if (!attach.text.enabled) {
        reportFailure(
          'attach that file',
          `${attach.text.reason ?? 'Attachments are unavailable'}.`,
        );
        return;
      }
      const body = await readText(file);
      append(
        { kind: 'text', text: body, ...(file.name !== '' ? { name: file.name } : {}) },
        file.size,
      );
      return;
    }
    reportFailure('attach a file', `${name} is not an image or a text file.`);
  };

  const append = (attachment: Attachment, sizeBytes: number): void => {
    setAttachments((prev) => [...prev, { id: attachIdRef.current++, attachment, sizeBytes }]);
  };

  const addFiles = (files: Iterable<File>): void => {
    for (const file of files) {
      void addFile(file).catch(() => reportFailure('attach a file', 'The file could not be read.'));
    }
  };

  // Multi-line growth: the field grows with its content to ~6 lines, then
  // scrolls. Measured, not guessed — height follows scrollHeight.
  const autoGrow = (): void => {
    const el = areaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };
  useEffect(autoGrow, [text]);

  // The shell asks for the caret (a session opened, or Enter was pressed in the
  // conversation) — a nonce, so two consecutive asks are two events. The first render's
  // 0 is not an ask: the app doesn't steal focus on boot.
  const composerFocus = useShell((s) => s.composerFocus);
  useEffect(() => {
    if (composerFocus > 0) areaRef.current?.focus();
  }, [composerFocus]);

  const take = (): string | undefined => {
    const t = text.trim();
    if (t === '') return undefined;
    setText('');
    return t;
  };

  // The slash popover: offered while the WHOLE draft is `/`+partial-name (a space
  // commits the draft to being prose), never over the approval gate. An unsettled
  // `skills` read has no rows to offer — the popover states WHICH unsettled state it
  // is in rather than claiming there are no skills.
  const slashQuery = disabled || approval !== undefined ? undefined : slashQueryOf(text);
  const slashOpen = slashQuery !== undefined && !slashDismissed;
  const slashRows =
    slashOpen && skills.status === 'ok' ? filterSkills(skills.value, slashQuery, invoked) : [];
  const slashAt = Math.min(slashCursor, Math.max(slashRows.length - 1, 0));

  /** Attach one invocation and clear the query — the draft WAS the query. */
  const invokeSkill = (name: string): void => {
    setInvoked((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setText('');
    setSlashCursor(0);
  };

  const send = (): void => {
    const t = take();
    if (t === undefined) return;
    // A redirect answers the gate — staged attachments/invocations stay pinned for
    // the next send.
    if (approval !== undefined) {
      onRedirect?.(approval.id, t);
      return;
    }
    const files = attachments.length > 0 ? attachments.map((a) => a.attachment) : undefined;
    const invokes = invoked.length > 0 ? [...invoked] : undefined;
    // Arity mirrors what is staged, so a plain text send stays a one-argument call.
    if (invokes !== undefined) onSend(t, files, invokes);
    else if (files !== undefined) onSend(t, files);
    else onSend(t);
    if (files !== undefined) setAttachments([]);
    if (invokes !== undefined) setInvoked([]);
  };
  const queueMessage = (): void => {
    const t = take();
    if (t !== undefined) onQueue?.(t);
  };
  const steer = (): void => {
    const t = take();
    if (t !== undefined) onSteer?.(t);
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
              <Tooltip label={q.text} side="top">
                <span tabIndex={0} className="min-w-0 flex-1 truncate text-sec text-s10">
                  {q.text}
                </span>
              </Tooltip>
              <button
                type="button"
                aria-label={`remove queued message: ${q.text}`}
                onClick={() => onRemoveQueued?.(q.id)}
                className="slip slip-press cursor-pointer rounded-r1 p-0.5 text-s7 hover:bg-s4 hover:text-s10 focus-visible:outline-focus active:scale-[0.97]"
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* no overflow-hidden on the shell — the chip menus must escape its bounds */}
      <div
        data-composer-shell
        onDragOver={(e) => {
          if (disabled || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          setDragging(false);
          if (disabled || e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        className={cx(
          'relative rounded-r4 border bg-s3 shadow-[var(--shadow-composer)]',
          disabled
            ? 'border-s4'
            : // A file held over the shell steps the border up — the drop affordance,
              // outranking even session state for the moment the gesture lasts.
              dragging
              ? 'border-s7'
              : edge === 'running'
                ? 'border-run/55'
                : edge === 'needs-you'
                  ? 'border-warn/55'
                  : // A notice tints the edge ONLY while no real session state owns it.
                    // Session state always wins, and `edge` is untouched either way, so a
                    // passive notice can never start the shimmer — animating the composer's
                    // outline for a cold cache would be a straight indicator-law breach.
                    notices.length > 0
                    ? 'border-warn/55'
                    : 'border-s5 focus-within:border-s6',
        )}
      >
        {/* The slash popover floats over the transcript above the shell — the HUD
            picker's construction (absolute bottom-full on the relative shell). It is
            derived from the draft, so there is no open/close state to desync: it shows
            while the draft is a slash query and Escape has not waved THIS draft off. */}
        {slashOpen && (
          <div
            data-slash-popover
            className={cx(
              'absolute right-0 bottom-full left-0 z-(--z-dropdown) mb-1.5',
              menuSurface,
              'slip-enter py-1',
            )}
          >
            {skills.status === 'loading' ? (
              <div className="px-3.5 py-1.5 text-code text-s7">Reading the library…</div>
            ) : skills.status === 'error' ? (
              <SurfaceError message={`Couldn't read the library — ${skills.message}`} />
            ) : slashRows.length === 0 ? (
              <div className="px-3.5 py-1.5 text-code text-s7">
                {skills.value.length === 0 ? 'No skills in the library' : 'No matching skill'}
              </div>
            ) : (
              <div role="listbox" aria-label="Invoke a skill" className="max-h-64 overflow-y-auto">
                {slashRows.map((s, i) => (
                  <button
                    key={s.name}
                    type="button"
                    role="option"
                    aria-selected={i === slashAt}
                    onMouseEnter={() => setSlashCursor(i)}
                    onClick={() => invokeSkill(s.name)}
                    className={cx(
                      'flex w-full cursor-pointer items-baseline gap-2 px-3.5 py-1.5 text-left',
                      i === slashAt ? 'bg-s4 text-s12' : 'text-s10 hover:bg-s3',
                    )}
                  >
                    <span className="flex-none font-mono text-code">/{s.name}</span>
                    {s.description !== '' && (
                      <span className="min-w-0 flex-1 truncate text-meta text-s7">
                        {s.description}
                      </span>
                    )}
                    <span className="ml-auto flex-none font-mono text-meta text-s6">{s.scope}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
        {/* The notices rank above the gate: a standing fact about the prompt outranks
            one request inside it. First child, so they wear the shell's top radius. */}
        <NoticeLine notices={notices} onAction={(id, action) => onNoticeAction?.(id, action)} />
        {/* the gate, MERGED into the shell: the request is the composer's top
            section, and the section's two halves ARE the buttons — the whole
            left half denies, the whole right half approves. The corner labels
            name the halves; hovering a half washes it with its verdict. */}
        {approval !== undefined && (
          <div className="slip-enter relative overflow-hidden rounded-t-r4 border-b border-s4">
            <div className="absolute inset-0 grid grid-cols-2">
              <button
                type="button"
                aria-label={`Deny: ${approval.tool} ${approval.summary}`}
                onClick={() => onDeny?.(approval.id)}
                className="slip flex cursor-pointer items-end justify-start bg-crit/6 p-2 hover:bg-crit/12"
              >
                {/* Solid at rest, not washed: the 60%-alpha label on this fill computed to
                    ~2.1:1, well under WCAG AA's 4.5:1 floor, on the composer's one
                    safety-critical control. Full-strength crit/ok is the ceiling this fill
                    can offer by alpha alone — DEVIATION from the ~4.5:1 target: crit's hue
                    tops out near ~3.7:1 here even at 100%, so real 4.5:1 would need a
                    dedicated brighter text tint (a token-level change, out of scope for a
                    polish pass) — but this is the largest legibility gain available without
                    one, and hover keeps its distinction through the bg wash (bg-crit/6 ->
                    /12) alone, so the label itself no longer needs a step. */}
                <span className="font-mono text-[9.5px] text-crit">⌫ Deny</span>
              </button>
              <button
                type="button"
                aria-label={`approve: ${approval.tool} ${approval.summary}`}
                onClick={() => onApprove?.(approval.id)}
                className="slip flex cursor-pointer items-end justify-end border-l border-s4 bg-ok/6 p-2 hover:bg-ok/12"
              >
                <span className="font-mono text-[9.5px] text-ok">Approve ⏎</span>
              </button>
            </div>
            <div className="pointer-events-none relative px-3 pt-2.5 pb-7">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="motion-safe:animate-pulse">
                  <StatusDot status="needs-you" />
                </span>
                <span className="font-[550] text-s11">{approval.tool}</span>
                <span className="font-mono text-caps text-s6">Needs approval</span>
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
        {/* Attached invocations pin INSIDE the shell like attachments: removable
            chips, released only by a direct send (their bodies ride above the message). */}
        {invoked.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-s4 px-2.5 py-1.5">
            {invoked.map((name) => (
              <span
                key={name}
                className="slip-enter flex items-center gap-1.5 rounded-r2 border border-s4 bg-s2 py-0.5 pr-0.5 pl-1.5"
              >
                <span className="max-w-40 truncate font-mono text-meta text-s10">/{name}</span>
                <button
                  type="button"
                  aria-label={`Remove invocation: ${name}`}
                  onClick={() => setInvoked((prev) => prev.filter((n) => n !== name))}
                  className="slip slip-press cursor-pointer rounded-r1 p-0.5 text-s7 hover:bg-s4 hover:text-s10 focus-visible:outline-focus active:scale-[0.97]"
                >
                  <Icon name="close" />
                </button>
              </span>
            ))}
          </div>
        )}
        {/* Staged attachments pin INSIDE the shell, above the field they will ride out
            with — removable chips, an image wearing its own thumbnail. */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-s4 px-2.5 py-1.5">
            {attachments.map((a) => {
              const name =
                a.attachment.name ?? (a.attachment.kind === 'image' ? 'image' : 'text file');
              return (
                <span
                  key={a.id}
                  className="slip-enter flex items-center gap-1.5 rounded-r2 border border-s4 bg-s2 py-0.5 pr-0.5 pl-1.5"
                >
                  {a.attachment.kind === 'image' ? (
                    <img
                      src={`data:${a.attachment.mimeType};base64,${a.attachment.data}`}
                      alt=""
                      className="h-4 w-4 rounded-r1 object-cover"
                    />
                  ) : (
                    <Icon name="attach" />
                  )}
                  <span className="max-w-40 truncate font-mono text-meta text-s10">{name}</span>
                  <span className="font-mono text-fine text-s6">{formatBytes(a.sizeBytes)}</span>
                  <button
                    type="button"
                    aria-label={`Remove attachment: ${name}`}
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    className="slip slip-press cursor-pointer rounded-r1 p-0.5 text-s7 hover:bg-s4 hover:text-s10 focus-visible:outline-focus active:scale-[0.97]"
                  >
                    <Icon name="close" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            // Any edit re-lands the cursor on the first hit and lifts an Escape
            // dismissal — the wave-off was about the draft as it stood.
            setSlashCursor(0);
            setSlashDismissed(false);
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length === 0) return;
            // A pasted screenshot/file goes through the same gated intake as the
            // picker — including the loud, reasoned refusal when it can't ride.
            e.preventDefault();
            addFiles(files);
          }}
          onKeyDown={(e) => {
            // The slash popover claims its keys first: arrows navigate, Enter/Tab
            // attach the row under the cursor, Escape waves this draft's offer off
            // (stopPropagation: the popover's Escape must not double as the
            // chat-level stop). Enter with NO matching row falls through — a message
            // that merely starts with `/` is still a message, never caged.
            if (slashOpen) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const max = Math.max(slashRows.length - 1, 0);
                setSlashCursor(
                  e.key === 'ArrowDown' ? Math.min(slashAt + 1, max) : Math.max(slashAt - 1, 0),
                );
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setSlashDismissed(true);
                return;
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                const row = slashRows[slashAt];
                if (row !== undefined) {
                  e.preventDefault();
                  invokeSkill(row.name);
                  return;
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  return;
                }
              }
            }
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
            else if (e.altKey) steer();
            else queueMessage();
          }}
          placeholder={
            disabled
              ? 'No session. Start one to talk to an agent.'
              : approval !== undefined
                ? 'Approve or deny above, or tell the agent what to do instead…'
                : running
                  ? 'Queue a message… (⌥⏎ steers now · esc stops)'
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
            state={disabled ? undefined : attach}
            disabled={disabled}
            onPick={() => fileInputRef.current?.click()}
          />
          {/* The picker's real input — hidden; the button above is its face. `accept`
              names only what the ACTIVE model can take, but intake re-gates anyway
              (accept is a hint, not an enforcement). */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            aria-hidden
            tabIndex={-1}
            data-attach-input
            accept={[
              ...(attach?.image.enabled ? [...IMAGE_MIME] : []),
              ...(attach?.text.enabled ? ['text/*', 'application/json'] : []),
            ].join(',')}
            onChange={(e) => {
              if (e.target.files !== null) addFiles(e.target.files);
              // Allow re-picking the same file: a controlled reset, not a browser quirk.
              e.target.value = '';
            }}
          />
          <MicButton disabled={disabled} />
          {/* The slash affordance — the discoverable way into the same popover typing
              `/` opens. It can only act on an empty draft (inserting `/` mid-message
              would corrupt what was typed), so with text present it rests disabled and
              its hover says the typed path instead — the tooltip rides a wrapper, as a
              disabled control dispatches no pointer events (the MicButton note). */}
          <Tooltip
            label={
              disabled
                ? 'Invoke a skill'
                : hasText
                  ? 'Type / at the start of a message to invoke a skill'
                  : 'Invoke a skill'
            }
            side="top"
          >
            <span className="flex">
              <button
                type="button"
                aria-label="Invoke a skill"
                disabled={disabled || hasText}
                aria-disabled={disabled || hasText}
                onClick={() => {
                  setText('/');
                  setSlashCursor(0);
                  setSlashDismissed(false);
                  areaRef.current?.focus();
                }}
                className={cx(
                  'flex h-7 w-7 items-center justify-center rounded-r2 border border-s4 bg-s3 font-mono text-code',
                  !disabled && !hasText
                    ? 'slip slip-press cursor-pointer text-s8 hover:bg-s4 hover:text-s10 focus-visible:outline-focus active:scale-[0.97]'
                    : 'cursor-default text-s6',
                  disabled && 'opacity-70',
                )}
              >
                /
              </button>
            </span>
          </Tooltip>
          <div className="flex-1" />
          {/* F2: how autonomous the session runs — leads the cluster, since it governs
              every other control here (a plan-mode session's model/effort picks still
              can't reach a write). */}
          <PermissionModeChip
            mode={mode}
            effectiveMode={effectiveMode}
            degraded={modeDegraded}
            onChange={onSetMode}
            disabled={disabled}
          />
          {/* The context gauge rides beside the model it measures: how full THIS model's
              window is, exact numbers on hover (an indicator, not a control). */}
          <ContextRing
            usage={ringUsage}
            draftTokens={text.trim() === '' ? 0 : estimateTokens(text)}
            metadata={activeModelMetadata}
            disabled={disabled}
          />
          {/* The two axes of a turn, side by side and each its own control: WHICH model,
              then how hard it thinks. Burying the second inside the first's popup made the
              more frequent of the two the harder to reach. */}
          <ModelPicker
            variant="chip"
            models={models}
            value={currentModelId}
            onChange={onPickModel}
            disabled={disabled}
            {...(modelMetadata !== undefined ? { metadata: modelMetadata } : {})}
          />
          <ReasoningChip
            options={effortOptions}
            value={effortValue}
            onChange={onPickEffort}
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
                  <Tooltip label="Sends when the turn ends" keys={['⏎']} side="top">
                    <Button onClick={queueMessage}>Queue</Button>
                  </Tooltip>
                  <Tooltip
                    label="Reaches the agent at its next step, without discarding its work"
                    keys={['⌥⏎']}
                    side="top"
                  >
                    <Button variant="outline" onClick={steer}>
                      Steer
                    </Button>
                  </Tooltip>
                </>
              )}
              <Tooltip label="Stop the running turn" keys={['esc']} side="top">
                <Button
                  variant="outline"
                  icon
                  aria-label="Stop the running turn"
                  onClick={() => onStop?.()}
                  className="hover:border-crit/60 hover:text-crit"
                >
                  ■
                </Button>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* shelf controls (search-field skin; disabled states included)         */
/* ------------------------------------------------------------------ */

/** The attach control's hover copy: what CAN ride right now, or exactly why
 *  nothing can — never a silent absence. Exported for direct testing. */
export function attachTooltip(state: AttachControlVm | undefined): string {
  if (state === undefined) return 'Attachments are unavailable here';
  if (state.image.enabled && state.text.enabled) return 'Attach an image or a text file';
  if (state.text.enabled) {
    // Text still rides; the image gate's own reason explains the narrowing.
    return `Attach a text file (${state.image.reason ?? 'images unavailable'})`;
  }
  return state.text.reason ?? state.image.reason ?? 'Attachments are unavailable here';
}

/**
 * File attachment — capability-gated by the active model/backend (the viewmodel's
 * `attachControlState` matrix). Enabled when at least one attachment kind can
 * genuinely ride the next send; otherwise it stays visible, disabled, with the
 * honest reason on hover (the tooltip rides a wrapper — a disabled control
 * dispatches no pointer events, so a trigger on it would never open).
 */
function AttachButton({
  state,
  disabled = false,
  onPick,
}: {
  state: AttachControlVm | undefined;
  disabled?: boolean;
  onPick: () => void;
}): React.JSX.Element {
  const enabled = !disabled && state !== undefined && (state.image.enabled || state.text.enabled);
  return (
    <Tooltip label={attachTooltip(disabled ? undefined : state)} side="top">
      <span className="flex">
        <button
          type="button"
          aria-label="Attach a file"
          disabled={!enabled}
          aria-disabled={!enabled}
          onClick={onPick}
          className={cx(
            'flex h-7 w-7 items-center justify-center rounded-r2 border border-s4 bg-s3',
            enabled
              ? 'slip slip-press cursor-pointer text-s8 hover:bg-s4 hover:text-s10 focus-visible:outline-focus active:scale-[0.97]'
              : 'cursor-default text-s6',
            disabled && 'opacity-70',
          )}
        >
          <Icon name="attach" />
        </button>
      </span>
    </Tooltip>
  );
}

/** Voice-to-text — a coming-soon affordance (maintainer ruling): it renders
 *  permanently disabled with no handler. Sits with the attach button so the
 *  shelf's final shape is already in place for whenever it lands. */
function MicButton({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  return (
    // The tooltip rides a WRAPPER, not the button: a disabled control dispatches no
    // pointer events, so a trigger on it would never open — and this control's entire
    // job is to explain why it is disabled. (A native `title` did work here, which is
    // exactly how easy it is to not notice the difference.)
    <Tooltip label="Voice input (unavailable)" side="top">
      <span className="flex">
        <button
          type="button"
          aria-label="Voice input"
          disabled
          aria-disabled="true"
          className={cx(
            'flex h-7 w-7 cursor-default items-center justify-center rounded-r2 border border-s4 bg-s3 text-s6',
            disabled && 'opacity-70',
          )}
        >
          <Icon name="mic" />
        </button>
      </span>
    </Tooltip>
  );
}
