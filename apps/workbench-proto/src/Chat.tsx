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
import { runScriptedTurn } from './mock.js';
import type { Frame } from './store.js';
import { useWorkbench } from './store.js';

/** The conversation canvas: transcript + composer. */
export function Chat(): React.JSX.Element {
  const activeId = useWorkbench((s) => s.activeId);
  const frames = useWorkbench((s) => s.sessions[s.activeId]?.frames ?? EMPTY);
  const running = useWorkbench((s) => s.running);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stick to bottom as frames arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [frames.length]);

  return (
    <div className="relative min-h-0 flex-1">
      {/* the transcript owns the full panel; it scrolls beneath the floating composer */}
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div className="flex flex-col gap-3.5 px-8 pt-6 pb-36">
          {frames.map((f) => (
            <FrameView key={f.id} frame={f} sessionId={activeId} />
          ))}
        </div>
      </div>
      <Composer sessionId={activeId} running={running} />
    </div>
  );
}

const EMPTY: Frame[] = [];

function FrameView({ frame, sessionId }: { frame: Frame; sessionId: string }): React.JSX.Element {
  switch (frame.kind) {
    case 'user':
      return (
        <div className="slip-enter max-w-[70%] self-end rounded-[6px_6px_2px_6px] bg-s3 px-3 py-2 text-[13px] text-s11">
          {frame.text}
        </div>
      );
    case 'think':
      return (
        <div className="text-[11.5px] text-s7 italic">
          {frame.text}
          {frame.streaming && <span className="not-italic">▎</span>}
        </div>
      );
    case 'tool':
      return (
        <div className="slip-enter flex items-center gap-2 py-[1px] font-mono text-[11.5px] text-s8">
          <span className="w-3 text-center text-s7">{frame.tk}</span>
          <span className="text-s9">{frame.label}</span>
        </div>
      );
    case 'toolx':
      return (
        <div className="slip-enter max-w-[88%] overflow-hidden rounded-r2 border border-s3 bg-s2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 font-mono text-[11.5px] text-s9">
            <span className="w-3 text-center text-s7">{frame.tk}</span>
            <span className="text-s11">{frame.file}</span>
            <span className="ml-auto">
              <span className="text-diff-add">+{frame.add}</span>{' '}
              <span className="text-diff-del">−{frame.del}</span>
            </span>
          </div>
          <div className="border-t border-s3 py-1 font-mono text-[11px] leading-[1.65]">
            {frame.diff.map((d, i) => (
              <div
                key={i}
                className={cx(
                  'px-3 whitespace-pre',
                  d.t === 'a' ? 'text-diff-add' : d.t === 'd' ? 'text-diff-del' : 'text-s7',
                )}
              >
                {d.line}
              </div>
            ))}
          </div>
        </div>
      );
    case 'text':
      return (
        <div className="slip-enter max-w-[88%] text-[13px] leading-[1.55] text-s11">
          <Bold text={frame.text} />
        </div>
      );
    case 'subagent':
      return (
        <div className="slip-enter group flex items-center gap-2 py-0.5 text-[12px] text-s8">
          <span className="font-mono text-s7">⎇</span>
          <b className="font-[550] text-s9">{frame.name}</b>
          <StatusDot status={frame.status} size={5} />
          <span className="font-mono text-[10.5px] text-s6">{frame.tick}</span>
          <span className="hidden gap-2 text-[10.5px] text-s8 group-hover:flex">
            <button type="button" className="cursor-pointer hover:text-s10">
              watch
            </button>
            <button type="button" className="cursor-pointer hover:text-s10">
              stop
            </button>
          </span>
        </div>
      );
    case 'approval':
      return <Approval frame={frame} sessionId={sessionId} />;
  }
}

function Bold({ text }: { text: string }): React.JSX.Element {
  const parts = text.split('**');
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold text-s12">
            {p}
          </b>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Approval({
  frame,
  sessionId,
}: {
  frame: Extract<Frame, { kind: 'approval' }>;
  sessionId: string;
}): React.JSX.Element {
  const resolveApproval = useWorkbench((s) => s.resolveApproval);
  const setStatus = useWorkbench((s) => s.setStatus);

  const resolve = (decision: 'approved' | 'denied'): void => {
    resolveApproval(sessionId, frame.id, decision);
    setStatus(sessionId, 'idle');
  };

  return (
    <div className="slip-enter max-w-[88%] rounded-r2 border border-s4 bg-s2 px-3 py-2.5">
      <div className="flex items-center gap-2 text-[12px] font-[550] text-s11">
        <StatusDot
          status={
            frame.resolved ? (frame.resolved === 'approved' ? 'done' : 'critical') : 'needs-you'
          }
        />
        {frame.tool}
        {frame.resolved && (
          <span className="ml-auto font-mono text-[10px] text-s7">{frame.resolved}</span>
        )}
      </div>
      <div className="mt-1.5 font-mono text-[11.5px] text-s10">{frame.cmd}</div>
      <div className="mt-1 text-[11px] text-s7">{frame.why}</div>
      {!frame.resolved && (
        <div className="mt-2.5 flex items-center gap-2.5">
          <Button onClick={() => resolve('approved')}>Approve</Button>
          <Button variant="outline" onClick={() => resolve('denied')}>
            Deny
          </Button>
          <span className="font-mono text-[9.5px] text-s6">⏎ ⌫</span>
        </div>
      )}
    </div>
  );
}

// The glyph is an autonomy meter — the circle fills as the agent's leash lengthens.
const PERMISSIONS = [
  { id: 'read only', glyph: '○', desc: 'nothing is written' },
  { id: 'ask edits', glyph: '◔', desc: 'writes wait for approval' },
  { id: 'auto edits', glyph: '◑', desc: 'writes land; commands still ask' },
  { id: 'full auto', glyph: '●', desc: 'only the cost cap says no' },
] as const;

const MODELS = ['fable-5', 'opus-4.8', 'sonnet-5', 'haiku-4.5'] as const;
const EFFORTS = ['low', 'medium', 'high', 'max'] as const;
type Effort = (typeof EFFORTS)[number];

function Composer({
  sessionId,
  running,
}: {
  sessionId: string;
  running: boolean;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [perm, setPerm] = useState<string>('ask edits');
  const [model, setModel] = useState<string>('fable-5');
  const [effort, setEffort] = useState<Effort>('high');
  const [attachments, setAttachments] = useState<string[]>([]);

  const attach = (name: string): void => {
    setAttachments((a) => (a.includes(name) ? a : [...a, name]));
  };

  const send = (): void => {
    const t = text.trim();
    if (!t || running) return;
    setText('');
    setAttachments([]);
    void runScriptedTurn(sessionId, t);
  };

  return (
    // no overflow-hidden on the shell — the chip menus must escape the composer's bounds
    <div className="absolute bottom-4 left-1/2 w-[calc(100%-64px)] max-w-[656px] -translate-x-1/2 rounded-r3 border border-s4 bg-s2 shadow-[0_8px_28px_rgba(0,0,0,0.45)] focus-within:border-s5">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          {attachments.map((a) => (
            <span
              key={a}
              className="slip-enter flex items-center gap-1.5 rounded-r1 border border-s4 bg-s3 px-1.5 py-0.5 font-mono text-[10.5px] text-s9"
            >
              {a}
              <button
                type="button"
                aria-label={`remove ${a}`}
                onClick={() => setAttachments((list) => list.filter((x) => x !== a))}
                className="slip cursor-pointer text-[10px] text-s7 hover:text-s10"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send();
        }}
        placeholder={running ? 'running… (esc to stop)' : 'Message builder…'}
        className="w-full bg-transparent px-3.5 py-2.5 text-[13px] text-s11 outline-none placeholder:text-s6"
      />
      {/* the control shelf: same rect, its own hairline */}
      <div className="flex items-center gap-1 border-t border-s3 px-2 py-1.5">
        <AttachButton onAttach={attach} />
        <div className="flex-1" />
        <PermissionChip value={perm} onPick={setPerm} />
        <ModelChip model={model} effort={effort} onPickModel={setModel} onPickEffort={setEffort} />
        <Button
          variant="primary"
          icon
          aria-label="send"
          disabled={running || text.trim() === ''}
          onClick={send}
        >
          ↑
        </Button>
      </div>
    </div>
  );
}

/** The attach menu — one option for now: upload a file from disk. */
function AttachButton({ onAttach }: { onAttach: (name: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <PopoverCard
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      className="w-48"
      trigger={
        <button
          type="button"
          aria-label="attach"
          className={cx(
            'slip slip-press flex h-7 w-7 cursor-pointer items-center justify-center rounded-r2 border text-s10 active:scale-[0.95]',
            open ? 'border-s6 bg-s5 text-s12' : 'border-s5 bg-s4 hover:bg-s5 hover:text-s12',
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

/** A composer chip that grows a floating card above itself. */
function ChipMenu({
  chip,
  title,
  open,
  setOpen,
  children,
}: {
  chip: string;
  title: string;
  open: boolean;
  setOpen: (o: boolean) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <PopoverCard
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          title={title}
          className={cx(
            'slip cursor-pointer rounded-r2 px-2 py-1 font-mono text-meta',
            open ? 'bg-s3 text-s11' : 'text-s9 hover:bg-s3 hover:text-s11',
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
}: {
  value: string;
  onPick: (v: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const current = PERMISSIONS.find((p) => p.id === value);
  return (
    <ChipMenu
      chip={`${current?.glyph ?? ''} ${value}`}
      title="permission mode"
      open={open}
      setOpen={setOpen}
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
  model,
  effort,
  onPickModel,
  onPickEffort,
}: {
  model: string;
  effort: Effort;
  onPickModel: (m: string) => void;
  onPickEffort: (e: Effort) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <ChipMenu
      chip={`${model} · ${effort}`}
      title="model · reasoning effort"
      open={open}
      setOpen={setOpen}
    >
      <div className="w-60">
        <CapsLabel>model</CapsLabel>
        <div className="pb-1">
          {MODELS.map((m) => (
            <MenuItem
              key={m}
              selected={m === model}
              className="font-mono text-code"
              onClick={() => onPickModel(m)}
            >
              {m}
            </MenuItem>
          ))}
        </div>
        <div className="border-t border-s4 px-3 pt-2 pb-3">
          <div className="flex items-baseline pb-1.5">
            <span className="text-caps tracking-[0.07em] text-s6 uppercase">reasoning</span>
            <span className="ml-auto font-mono text-meta text-s9">{effort}</span>
          </div>
          <StepSlider
            stops={EFFORTS}
            value={effort}
            onChange={onPickEffort}
            aria-label="reasoning effort"
          />
        </div>
      </div>
    </ChipMenu>
  );
}

/** The reasoning-effort step slider: four stops, click/drag/arrow keys. */
