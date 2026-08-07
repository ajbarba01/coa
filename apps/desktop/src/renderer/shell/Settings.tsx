import {
  CapsLabel,
  DialogSearchHead,
  filterKeybinds,
  Kbd,
  ModalShell,
  SettingRow,
  Toggle,
  TocRail,
  cx,
} from '@coa/console-kit';
import { useEffect, useRef, useState } from 'react';
import type { ConsoleSettings } from '../../shared/settings.js';
import { TextInput } from '../panels/fields.js';
import { useMockAuth } from '../panels/mockAuth.js';
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

/** The isolation toggle. Daemon-owned (the login spawn reads it, not the renderer), so it
 *  renders from the auth view rather than from `ConsoleSettings` — and it is never
 *  disabled: with no browser found it still says what it found and stays flippable, and
 *  the login just takes the copy-link path (advisory; profile cleanup is user-initiated only). The hydrate that fills
 *  `browserSession` lives on {@link SettingsDialog}, not here — a search query can filter
 *  this row out of the mounted tree while `BrowserPathRow` survives, and that row must not
 *  be left reading an unhydrated store. */
export function IsolatedBrowserRow(): React.JSX.Element {
  const session = useMockAuth((s) => s.browserSession);
  const setOn = useMockAuth((s) => s.setIsolatedBrowserLogins);
  return (
    <span className="flex flex-none items-center gap-2.5">
      {!session.available && <span className="font-mono text-meta text-s7">No browser found</span>}
      <Toggle
        on={session.enabled}
        onChange={(on) => void setOn(on).catch(() => {})}
        aria-label="Dedicated browser profile"
      />
    </span>
  );
}

/** The binary override, prefilled from detection — an override is a correction, never a
 *  required setup step. Blank clears it back to auto-detection. */
export function BrowserPathRow(): React.JSX.Element {
  const session = useMockAuth((s) => s.browserSession);
  const setPath = useMockAuth((s) => s.setBrowserPath);
  const resolved = session.path ?? session.detectedPath ?? '';
  const [value, setValue] = useState(resolved);
  // Re-seed when detection or the stored override changes underneath the field.
  useEffect(() => setValue(resolved), [resolved]);
  const commit = (): void => {
    const trimmed = value.trim();
    // With no override stored, a value byte-identical to what the field was seeded with
    // (detection, or blank when the store hasn't hydrated yet) is not an edit — committing
    // it anyway would either pin auto-detection as an explicit override that goes stale
    // the moment the browser moves, or — for a row that mounted alone against an
    // unhydrated store (profile cleanup only ever happens at the user's explicit request) — silently clear a real override the daemon still
    // has that this render never got to see.
    if (session.path === undefined && trimmed === resolved) return;
    void setPath(trimmed).catch(() => {});
  };
  return (
    <TextInput
      value={value}
      onChange={setValue}
      onCommit={commit}
      placeholder="Auto-detect"
      aria-label="Browser"
      className="w-64 flex-none"
    />
  );
}

/**
 * Browser profiles no account resolves to, and the one door that deletes them.
 *
 * The standing rule still binds: coa never deletes a profile on its own initiative, so nothing here
 * happens without a click. Names only — no sizes, no dates — because under identity keying
 * this list is normally empty, and when it is not, the name already says whose jar it is
 * (profiles share one user-data-dir; orphaned jars are reclaimed only on request).
 *
 * Lives here rather than on the auth surface because an orphan has no account row to hang
 * off, and the auth panel is organized by account row (AUTH-1).
 */
export function ReclaimProfilesRow(): React.JSX.Element {
  const reclaimable = useMockAuth((s) => s.browserSession.reclaimable);
  const reclaim = useMockAuth((s) => s.reclaimBrowserProfiles);
  const [open, setOpen] = useState(false);
  const run = (names: string[]): void => void reclaim(names).catch(() => {});

  if (reclaimable.length === 0) {
    return <span className="flex-none font-mono text-code text-s7">None</span>;
  }
  return (
    <span className="flex flex-none flex-col items-end gap-1.5">
      <button
        type="button"
        className="font-mono text-code text-s8 underline-offset-2 hover:underline"
        onClick={() => setOpen((was) => !was)}
      >
        {open ? 'Hide' : `Review ${reclaimable.length}`}
      </button>
      {open && (
        <span className="flex flex-col items-stretch gap-1">
          {reclaimable.map((name) => (
            <span key={name} className="flex items-center justify-between gap-3">
              <span className="font-mono text-meta text-s7">{name}</span>
              <button
                type="button"
                className="font-mono text-meta text-s7 hover:text-s9"
                aria-label={`Remove browser profile ${name}`}
                onClick={() => run([name])}
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button"
            className="self-end font-mono text-meta text-s7 underline-offset-2 hover:underline"
            onClick={() => run([...reclaimable])}
          >
            Remove All
          </button>
        </span>
      )}
    </span>
  );
}

const SECTIONS: SectionSpec[] = [
  {
    id: 'appearance',
    title: 'Appearance',
    rows: [
      {
        id: 'theme',
        name: 'Theme',
        desc: 'Controls the palette used across the whole console. Pinned to sand dark.',
        // Maintainer ruling: theme is pinned dark for now — a read-only value is
        // more honest than a one-option select pretending to be a choice.
        render: () => <span className="flex-none font-mono text-code text-s7">Sand dark</span>,
      },
      {
        id: 'motion',
        name: 'Reduce motion',
        desc: 'Collapses transitions to instant state changes.',
        render: (settings, apply) => (
          <Toggle
            on={settings.motion === 'reduce'}
            onChange={(on) => apply({ motion: on ? 'reduce' : 'full' })}
            aria-label="Reduce motion"
          />
        ),
      },
    ],
  },
  {
    id: 'logins',
    title: 'Logins',
    rows: [
      {
        id: 'isolated-browser',
        name: 'Dedicated browser profile',
        desc: 'Signs each account in through its own browser profile, so the account you name is the account that lands. When off, logins use the default browser.',
        render: () => <IsolatedBrowserRow />,
      },
      {
        id: 'browser-binary',
        name: 'Browser',
        desc: 'Controls which browser those profiles open in. Set a path only to correct what was detected.',
        render: () => <BrowserPathRow />,
      },
      {
        id: 'reclaim-profiles',
        name: 'Unused browser profiles',
        desc: 'Browser profiles no login uses any more. Nothing is deleted until you choose it.',
        render: () => <ReclaimProfilesRow />,
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

  // The login rows' `browserSession` read lives here, not on either row: a search query
  // can leave only one of the two mounted, and the dialog is the one thing guaranteed
  // present whenever a row could be — the read must not depend on which row survives.
  useEffect(() => {
    if (!open) return;
    void useMockAuth
      .getState()
      .hydrate()
      .catch(() => {});
  }, [open]);

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
    ...(bindHits.length > 0 ? [{ id: 'keybinds', title: 'Keybinds' }] : []),
  ];

  const jump = (id: string): void => {
    setActive(id);
    contentRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ block: 'start' });
  };

  return (
    <ModalShell
      open={open}
      onClose={() => setOpen(false)}
      aria-label="Settings"
      className="flex h-[70%] w-[70%] flex-col"
    >
      <DialogSearchHead
        value={q}
        onChange={setQ}
        onClose={() => setOpen(false)}
        placeholder="Search settings…"
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
                <CapsLabel className="p-0 pb-1">Keybinds</CapsLabel>
                {bindHits.map((k) => (
                  <SettingRow key={k.id} name={k.label} desc={k.group}>
                    <span className="flex flex-none gap-1">
                      {k.keys.length > 0 ? (
                        k.keys.map((key) => <Kbd key={key}>{key}</Kbd>)
                      ) : (
                        <span className="font-mono text-caps text-warn">Unbound</span>
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
