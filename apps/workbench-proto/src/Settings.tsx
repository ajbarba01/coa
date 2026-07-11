import { cx } from '@coa/console-kit';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KEYBINDS, Kbd } from './keys.js';
import { useClickAway, useDismissLayer } from './layers.js';
import { ZOOM } from './store.js';

/** The settings dialog: VS Code's shape (search → TOC rail → setting rows,
 *  every row name + description + inline control) spoken in the quiet register.
 *  All values are dialog-local mock state — the prototype proves the surface. */

interface RowSpec {
  id: string;
  name: string;
  desc: string;
  control: ControlSpec;
}

type ControlSpec =
  | { kind: 'toggle'; initial: boolean }
  | { kind: 'select'; options: readonly string[]; initial: string }
  | { kind: 'text'; initial: string; readonly?: boolean };

interface SectionSpec {
  id: string;
  title: string;
  rows: RowSpec[];
}

const SECTIONS: SectionSpec[] = [
  {
    id: 'appearance',
    title: 'appearance',
    rows: [
      {
        id: 'theme',
        name: 'Theme',
        desc: 'Palette scale for the whole console.',
        control: { kind: 'select', options: ['sand dark', 'sand light', 'system'], initial: 'sand dark' },
      },
      {
        id: 'density',
        name: 'Density',
        desc: 'Row spacing across lists and transcripts.',
        control: { kind: 'select', options: ['compact', 'cozy'], initial: 'compact' },
      },
      {
        id: 'motion',
        name: 'Reduce motion',
        desc: 'Collapse transitions to instant state changes.',
        control: { kind: 'toggle', initial: false },
      },
    ],
  },
  {
    id: 'composer',
    title: 'composer',
    rows: [
      {
        id: 'model',
        name: 'Default model',
        desc: 'New sessions start on this model.',
        control: { kind: 'select', options: ['fable-5', 'opus-4.8', 'sonnet-5', 'haiku-4.5'], initial: 'fable-5' },
      },
      {
        id: 'enter',
        name: 'Send on enter',
        desc: 'Off inserts a newline; send with ctrl+enter.',
        control: { kind: 'toggle', initial: true },
      },
    ],
  },
  {
    id: 'governance',
    title: 'governance',
    rows: [
      {
        id: 'cap',
        name: 'Session cost cap',
        desc: 'The hard cap — one of the two denies in the system.',
        control: { kind: 'text', initial: '$5.00' },
      },
      {
        id: 'advisory',
        name: 'Advisory flags',
        desc: 'How non-critical flags surface in the transcript.',
        control: { kind: 'select', options: ['inline', 'collapsed'], initial: 'collapsed' },
      },
      {
        id: 'confirm',
        name: 'Unverifiable relations',
        desc: 'Ask for an eyeball when a claim can’t be checked.',
        control: { kind: 'toggle', initial: true },
      },
    ],
  },
  {
    id: 'daemon',
    title: 'daemon',
    rows: [
      {
        id: 'autostart',
        name: 'Start with console',
        desc: 'Launch the daemon when the console opens.',
        control: { kind: 'toggle', initial: true },
      },
      {
        id: 'pipe',
        name: 'Pipe',
        desc: 'Where the console finds the daemon.',
        control: { kind: 'text', initial: '\\\\.\\pipe\\coa', readonly: true },
      },
      {
        id: 'loglevel',
        name: 'Log level',
        desc: 'Daemon-side verbosity.',
        control: { kind: 'select', options: ['warn', 'info', 'debug'], initial: 'info' },
      },
    ],
  },
];

export function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(SECTIONS[0]?.id ?? '');
  const contentRef = useRef<HTMLDivElement>(null);
  useDismissLayer(true, onClose);

  const query = q.trim().toLowerCase();
  const visible = SECTIONS.map((s) => ({
    ...s,
    rows: query
      ? s.rows.filter(
          (r) => r.name.toLowerCase().includes(query) || r.desc.toLowerCase().includes(query),
        )
      : s.rows,
  })).filter((s) => s.rows.length > 0);
  const bindHits = query
    ? KEYBINDS.filter(
        (k) => k.label.toLowerCase().includes(query) || k.keys.join(' ').includes(query),
      )
    : KEYBINDS;
  const railEntries = [
    ...visible.map((s) => ({ id: s.id, title: s.title })),
    ...(bindHits.length > 0 ? [{ id: 'keybinds', title: 'keybinds' }] : []),
  ];

  const jump = (id: string): void => {
    setActive(id);
    contentRef.current
      ?.querySelector(`[data-section="${id}"]`)
      ?.scrollIntoView({ block: 'start' });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="settings"
        className="slip-enter flex h-[70%] w-[70%] flex-col overflow-hidden rounded-r4 border border-s5 bg-s2 shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        {/* search owns the head, like VS Code — it filters rows across sections */}
        <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-2.5">
          <span className="text-[14px] text-s7">⌕</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search settings…"
            className="flex-1 bg-transparent text-[12.5px] text-s11 outline-none placeholder:text-s6"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="close settings"
            className="slip -mr-1 flex h-6 w-6 cursor-pointer items-center justify-center text-[13px] text-s7 hover:text-s10"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* the TOC rail — while searching it reflects only sections that still match */}
          <div className="w-[132px] flex-none border-r border-s3 py-2">
            {railEntries.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => jump(s.id)}
                className={cx(
                  'slip flex w-full cursor-pointer items-center px-4 py-[5px] text-left text-[12px]',
                  s.id === active && !query
                    ? 'bg-s3 text-s12'
                    : 'text-s10 hover:bg-s3 hover:text-s11',
                )}
              >
                {s.title}
              </button>
            ))}
          </div>

          <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {/* rows cap at a readable width even when the dialog runs wide */}
            <div className="max-w-[640px]">
              {visible.map((s) => (
                <div key={s.id} data-section={s.id} className="pt-4">
                  <div className="pb-1 text-[10px] tracking-[0.07em] text-s6 uppercase">
                    {s.title}
                  </div>
                  {s.rows.map((r) => (
                    <SettingRow key={r.id} row={r} />
                  ))}
                </div>
              ))}
              {bindHits.length > 0 && (
                <div data-section="keybinds" className="pt-4">
                  <div className="pb-1 text-[10px] tracking-[0.07em] text-s6 uppercase">
                    keybinds
                  </div>
                  {bindHits.map((k) => (
                    <div key={k.label} className="flex items-center gap-4 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] text-s11">{k.label}</div>
                        <div className="mt-0.5 text-[11px] leading-[1.4] text-s7">{k.group}</div>
                      </div>
                      <span className="flex flex-none gap-1">
                        {k.keys.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                  <div className="pt-1 text-[10.5px] text-s6">
                    rebinding arrives with the rebuild — these are the defaults
                  </div>
                </div>
              )}
              {visible.length === 0 && bindHits.length === 0 && (
                <div className="pt-10 text-center text-[12px] text-s7">
                  no settings match “{q.trim()}”
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ row }: { row: RowSpec }): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-s11">{row.name}</div>
        <div className="mt-0.5 text-[11px] leading-[1.4] text-s7">{row.desc}</div>
      </div>
      <Control spec={row.control} />
    </div>
  );
}

function Control({ spec }: { spec: ControlSpec }): React.JSX.Element {
  switch (spec.kind) {
    case 'toggle':
      return <Toggle initial={spec.initial} />;
    case 'select':
      return <Select options={spec.options} initial={spec.initial} />;
    case 'text':
      return <TextControl initial={spec.initial} readonly={spec.readonly} />;
  }
}

/** Boxy switch: neutral fill when on — accent blue stays reserved for running. */
function Toggle({ initial }: { initial: boolean }): React.JSX.Element {
  const [on, setOn] = useState(initial);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setOn((v) => !v)}
      className={cx(
        'slip relative h-[16px] w-[28px] flex-none cursor-pointer rounded-[3px] border',
        on ? 'border-s7 bg-s6' : 'border-s5 bg-s3',
      )}
    >
      <span
        className={cx(
          'slip-move absolute top-[2px] h-[10px] w-[10px] rounded-[2px]',
          on ? 'left-[14px] bg-s12' : 'left-[2px] bg-s8',
        )}
      />
    </button>
  );
}

function Select({
  options,
  initial,
}: {
  options: readonly string[];
  initial: string;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  // The dialog body scrolls and clips, so the menu escapes through a portal to
  // <body> — position:fixed alone isn't enough, because any transformed
  // ancestor (e.g. a mount animation) would become its containing block.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = anchor !== null;
  useClickAway([ref, menuRef], () => setAnchor(null));
  useDismissLayer(open, () => setAnchor(null));

  // A fixed menu can't follow its trigger — close it the moment anything scrolls.
  useEffect(() => {
    if (!open) return;
    const close = (): void => setAnchor(null);
    window.addEventListener('scroll', close, { capture: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent<HTMLButtonElement>): void => {
    if (open) {
      setAnchor(null);
      return;
    }
    // rect coords are visual px; the portaled menu's styles get re-zoomed, so
    // convert to layout px or it lands 20% off
    const r = e.currentTarget.getBoundingClientRect();
    setAnchor({ top: r.bottom / ZOOM + 4, right: (window.innerWidth - r.right) / ZOOM });
  };

  return (
    <div ref={ref} className="flex-none">
      <button
        type="button"
        onClick={toggle}
        className={cx(
          'slip cursor-pointer rounded-r1 border border-s4 px-2 py-[3px] font-mono text-[11px]',
          open ? 'border-s5 text-s11' : 'text-s9 hover:border-s5 hover:text-s11',
        )}
      >
        {value} ▾
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="slip-enter fixed z-[60] overflow-hidden rounded-r3 border border-s5 bg-s3 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
            style={{ top: anchor.top, right: anchor.right }}
          >
            {options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => {
                  setValue(o);
                  setAnchor(null);
                }}
                className={cx(
                  'slip flex w-full cursor-pointer items-center gap-4 px-3 py-1.5 text-left font-mono text-[11px] whitespace-nowrap',
                  o === value ? 'bg-s4 text-s12' : 'text-s9 hover:bg-s4 hover:text-s11',
                )}
              >
                {o}
                {o === value && <span className="ml-auto text-[10px] text-s7">current</span>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function TextControl({
  initial,
  readonly,
}: {
  initial: string;
  readonly?: boolean | undefined;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <input
      value={value}
      readOnly={readonly}
      onChange={(e) => setValue(e.target.value)}
      className={cx(
        'w-28 flex-none border-b bg-transparent px-1 py-[3px] text-right font-mono text-[11px] outline-none',
        readonly ? 'border-transparent text-s7' : 'border-s4 text-s10 focus:border-s6',
      )}
    />
  );
}
