import {
  CapsLabel,
  DialogSearchHead,
  filterKeybinds,
  Kbd,
  ModalShell,
  Select,
  SettingRow,
  Toggle,
  TocRail,
  cx,
} from '@coa/console-kit';
import { useRef, useState } from 'react';
import type { ConsoleSettings } from '../../shared/settings.js';
import { useConsoleState } from './consoleStore.js';
import { useKeybinds } from './keys.js';
import { useShell } from './store.js';

/** The settings dialog: VS Code's shape (search head → TOC rail → name +
 *  description + inline-control rows) in the quiet register. REAL rows only —
 *  every control reads `ui.settings` and writes through the persisted
 *  `setSettings` action; keybinds render from the registry so a bind cannot
 *  exist without being discoverable here. */

interface RowSpec {
  id: string;
  name: string;
  desc: string;
  render: (
    settings: ConsoleSettings,
    apply: (patch: Partial<ConsoleSettings>) => void,
  ) => React.ReactNode;
}

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
        desc: 'Palette scale for the whole console. Pinned to sand dark until the light scale lands.',
        // Maintainer ruling: theme is pinned dark for now — a read-only value is
        // more honest than a one-option select pretending to be a choice.
        render: () => <span className="flex-none font-mono text-code text-s7">sand dark</span>,
      },
      {
        id: 'density',
        name: 'Density',
        desc: 'Row spacing across lists and transcripts.',
        render: (settings, apply) => (
          <Select
            options={['compact', 'comfortable']}
            value={settings.density}
            onChange={(v) => apply({ density: v === 'comfortable' ? 'comfortable' : 'compact' })}
          />
        ),
      },
      {
        id: 'motion',
        name: 'Reduce motion',
        desc: 'Collapse transitions to instant state changes.',
        render: (settings, apply) => (
          <Toggle
            on={settings.motion === 'reduce'}
            onChange={(on) => apply({ motion: on ? 'reduce' : 'full' })}
          />
        ),
      },
    ],
  },
];

export function SettingsDialog(): React.JSX.Element {
  const open = useShell((s) => s.settingsOpen);
  const setOpen = useShell((s) => s.setSettingsOpen);
  const state = useConsoleState((s) => s);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(SECTIONS[0]?.id ?? '');
  const contentRef = useRef<HTMLDivElement>(null);
  const keybinds = useKeybinds();

  const settings = state?.ui.settings;
  const apply = (patch: Partial<ConsoleSettings>): void => state?.actions.setSettings(patch);

  const query = q.trim().toLowerCase();
  const visible = SECTIONS.map((s) => ({
    ...s,
    rows: query
      ? s.rows.filter(
          (r) => r.name.toLowerCase().includes(query) || r.desc.toLowerCase().includes(query),
        )
      : s.rows,
  })).filter((s) => s.rows.length > 0);
  const bindHits = filterKeybinds(keybinds, query);
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
      open={open}
      onClose={() => setOpen(false)}
      aria-label="settings"
      className="flex h-[70%] w-[70%] flex-col"
    >
      <DialogSearchHead
        value={q}
        onChange={setQ}
        onClose={() => setOpen(false)}
        placeholder="search settings…"
      />

      <div className="flex min-h-0 flex-1">
        <TocRail entries={railEntries} activeId={query ? null : active} onJump={jump} />

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {/* rows cap at a readable width even when the dialog runs wide */}
          <div className="max-w-160">
            {settings !== undefined &&
              visible.map((s) => (
                <div key={s.id} data-section={s.id} className="pt-4">
                  <CapsLabel className="p-0 pb-1">{s.title}</CapsLabel>
                  {s.rows.map((r) => (
                    <SettingRow key={r.id} name={r.name} desc={r.desc}>
                      {r.render(settings, apply)}
                    </SettingRow>
                  ))}
                </div>
              ))}
            {bindHits.length > 0 && (
              <div data-section="keybinds" className="pt-4">
                <CapsLabel className="p-0 pb-1">keybinds</CapsLabel>
                {bindHits.map((k) => (
                  <SettingRow key={k.id} name={k.label} desc={k.group}>
                    <span className="flex flex-none gap-1">
                      {k.keys.length > 0 ? (
                        k.keys.map((key) => <Kbd key={key}>{key}</Kbd>)
                      ) : (
                        <span className="font-mono text-caps text-warn">unbound</span>
                      )}
                    </span>
                  </SettingRow>
                ))}
                <button
                  type="button"
                  onClick={() => useShell.getState().setShortcutsOpen(true)}
                  className={cx('slip cursor-pointer pt-1 text-meta text-s6 hover:text-s9')}
                >
                  rebind them in the shortcuts card (ctrl /)
                </button>
              </div>
            )}
            {visible.length === 0 && bindHits.length === 0 && (
              <div className="pt-10 text-center text-sec text-s7">
                no settings match “{q.trim()}”
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
