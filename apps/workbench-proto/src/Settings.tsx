import {
  DialogSearchHead,
  Kbd,
  ModalShell,
  Select,
  SettingRow,
  TocRail,
  Toggle,
  cx,
} from '@coa/console-kit';
import { useRef, useState } from 'react';
import { KEYBINDS } from './keys.js';

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
        control: {
          kind: 'select',
          options: ['sand dark', 'sand light', 'system'],
          initial: 'sand dark',
        },
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
        control: {
          kind: 'select',
          options: ['fable-5', 'opus-4.8', 'sonnet-5', 'haiku-4.5'],
          initial: 'fable-5',
        },
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
    contentRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ block: 'start' });
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      aria-label="settings"
      className="flex h-[70%] w-[70%] flex-col"
    >
      <DialogSearchHead
        value={q}
        onChange={setQ}
        onClose={onClose}
        placeholder="search settings…"
      />

      <div className="flex min-h-0 flex-1">
        <TocRail entries={railEntries} activeId={query ? null : active} onJump={jump} />

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {/* rows cap at a readable width even when the dialog runs wide */}
          <div className="max-w-160">
            {visible.map((s) => (
              <div key={s.id} data-section={s.id} className="pt-4">
                <div className="pb-1 text-caps tracking-[0.07em] text-s6 uppercase">{s.title}</div>
                {s.rows.map((r) => (
                  <SettingRow key={r.id} name={r.name} desc={r.desc}>
                    <Control spec={r.control} />
                  </SettingRow>
                ))}
              </div>
            ))}
            {bindHits.length > 0 && (
              <div data-section="keybinds" className="pt-4">
                <div className="pb-1 text-caps tracking-[0.07em] text-s6 uppercase">keybinds</div>
                {bindHits.map((k) => (
                  <SettingRow key={k.label} name={k.label} desc={k.group}>
                    <span className="flex flex-none gap-1">
                      {k.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  </SettingRow>
                ))}
                <div className="pt-1 text-meta text-s6">
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
    </ModalShell>
  );
}

function Control({ spec }: { spec: ControlSpec }): React.JSX.Element {
  switch (spec.kind) {
    case 'toggle':
      return <ToggleControl initial={spec.initial} />;
    case 'select':
      return <SelectControl options={spec.options} initial={spec.initial} />;
    case 'text':
      return <TextControl initial={spec.initial} readonly={spec.readonly} />;
  }
}

function ToggleControl({ initial }: { initial: boolean }): React.JSX.Element {
  const [on, setOn] = useState(initial);
  return <Toggle on={on} onChange={setOn} />;
}

function SelectControl({
  options,
  initial,
}: {
  options: readonly string[];
  initial: string;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return <Select options={options} value={value} onChange={setValue} />;
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
