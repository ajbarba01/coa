import { useState } from 'react';
import { Button } from '../actions/Button.js';
import { cx } from '../cx.js';
import { ModalShell } from '../overlay/ModalShell.js';
import { Kbd, type Keybind } from './Kbd.js';

/**
 * The editing seam. The kit renders and captures; the APP owns the vocabulary (what a
 * chord is), the policy (what may be bound, what a collision costs) and the persistence —
 * so this card never has to know what a command means.
 */
export interface KeybindEditing {
  /** The chord an event names, or undefined while only a modifier is down. */
  chordFromEvent: (e: KeyboardEvent) => string[] | undefined;
  /** May this chord carry a binding at all? (A bare letter would swallow typing.) */
  isBindable: (keys: string[]) => boolean;
  /** The command this chord would steal, if any — its label, for the warning. */
  conflictLabel: (id: string, keys: string[]) => string | undefined;
  onRebind: (id: string, keys: string[]) => void;
  onReset: (id: string) => void;
  onResetAll: () => void;
  /** Whether this bind is the user's rather than the default (shows its reset). */
  isCustom: (id: string) => boolean;
}

/** Pure: the binds a query names — matched on the label AND the chord, so "close" and
 *  "ctrl w" both find the same row. */
export function filterKeybinds(keybinds: Keybind[], query: string): Keybind[] {
  const q = query.trim().toLowerCase();
  if (q === '') return keybinds;
  const terms = q.split(/\s+/);
  return keybinds.filter((k) => {
    const hay = `${k.label} ${k.group} ${k.keys.join(' ')}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** The shortcuts card: the keybind registry rendered as a grouped modal, searchable, and
 *  editable when the caller passes an `editing` seam (without it, the same read-only
 *  reference as before). One registry drives dispatch AND this UI — a bind can't exist
 *  without being discoverable, and rebinding it here is rebinding it everywhere. */
export function ShortcutsOverlay({
  keybinds,
  onClose,
  editing,
}: {
  keybinds: Keybind[];
  onClose: () => void;
  editing?: KeybindEditing | undefined;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  /** The row being recorded, plus the chord it has heard so far — a captured chord is
   *  SHOWN, never applied, until Enter confirms it (that's what makes a collision
   *  something the user agrees to rather than something that happens to them). */
  const [capture, setCapture] = useState<{ id: string; keys?: string[]; error?: string }>();

  const hits = filterKeybinds(keybinds, query);
  const groups = [...new Set(hits.map((k) => k.group))];

  const onCaptureKey = (e: React.KeyboardEvent): void => {
    if (capture === undefined) return;
    // The capture owns every key while it runs: Escape must cancel the RECORDING, not
    // close the card, and no chord may reach global dispatch on its way past.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setCapture(undefined);
      return;
    }
    if (e.key === 'Enter' && capture.keys !== undefined) {
      editing?.onRebind(capture.id, capture.keys);
      setCapture(undefined);
      return;
    }
    const keys = editing?.chordFromEvent(e.nativeEvent);
    if (keys === undefined) return; // a modifier alone: keep listening
    if (editing !== undefined && !editing.isBindable(keys)) {
      setCapture({ id: capture.id, error: 'needs ctrl or alt' });
      return;
    }
    setCapture({ id: capture.id, keys });
  };

  return (
    // Capped and scrolled: the registry grows with every command, and a card that outgrows
    // the window would push its rows off the bottom edge. Header and filter stay put; the
    // rows are what scroll.
    <ModalShell
      open
      onClose={onClose}
      aria-label="keyboard shortcuts"
      className="flex max-h-[75vh] w-120 flex-col pb-0"
    >
      <div className="flex items-center border-b border-s3 px-4 py-2.5 text-caps tracking-[0.07em] text-s7 uppercase">
        keyboard shortcuts
        {editing !== undefined && (
          <Button
            variant="text"
            onClick={editing.onResetAll}
            className="ml-auto tracking-normal normal-case"
          >
            reset all
          </Button>
        )}
        <Button
          variant="ghost"
          icon
          aria-label="close shortcuts"
          onClick={onClose}
          className={cx('h-6 w-6 text-body tracking-normal', editing === undefined && 'ml-auto')}
        >
          ✕
        </Button>
      </div>

      <div className="border-b border-s3 px-4 py-2">
        <input
          // the card opens ready to be typed into — finding a shortcut is why you came
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter shortcuts…"
          aria-label="filter shortcuts"
          className="w-full min-w-0 bg-transparent text-sec text-s11 outline-none placeholder:text-s7"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.map((g) => (
          <div key={g} className="pt-2.5">
            <div className="px-4 pb-0.5 text-caps tracking-[0.07em] text-s6 uppercase">{g}</div>
            {hits
              .filter((k) => k.group === g)
              .map((k) => {
                const recording = capture?.id === k.id;
                const conflict =
                  recording && capture?.keys !== undefined
                    ? editing?.conflictLabel(k.id, capture.keys)
                    : undefined;
                return (
                  <div key={k.id} className="px-4 py-[5px]">
                    <div className="flex items-center gap-2 text-sec text-s10">
                      {k.label}
                      {/* a chord that only answers somewhere has to admit it on its own row */}
                      {k.scope !== undefined && (
                        <span className="font-mono text-meta text-s6">in {k.scope}</span>
                      )}
                      <span className="ml-auto flex items-center gap-1">
                        {/* The chord IS the control: click it and you are typing into it.
                            A separate record button asked the user to learn a second thing
                            in order to change the first one. */}
                        {editing !== undefined && k.fixed !== true ? (
                          <button
                            type="button"
                            aria-label={
                              recording ? `stop recording ${k.label}` : `rebind ${k.label}`
                            }
                            onClick={() => setCapture(recording ? undefined : { id: k.id })}
                            onKeyDown={onCaptureKey}
                            onBlur={() => setCapture(undefined)}
                            className={cx(
                              'slip flex min-w-24 cursor-pointer items-center justify-center gap-1 rounded-r2 border px-2 py-1',
                              recording
                                ? 'border-run bg-s3'
                                : 'border-transparent hover:border-s5 hover:bg-s3',
                            )}
                          >
                            <ChordFace
                              keys={recording ? capture?.keys : k.keys}
                              recording={recording}
                              error={recording ? capture?.error : undefined}
                            />
                          </button>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-1">
                            <ChordFace keys={k.keys} recording={false} />
                          </span>
                        )}
                        {editing !== undefined &&
                          k.fixed !== true &&
                          editing.isCustom(k.id) &&
                          !recording && (
                            <Button
                              variant="ghost"
                              icon
                              aria-label={`reset ${k.label}`}
                              onClick={() => editing.onReset(k.id)}
                              className="h-5 w-5 text-code"
                            >
                              ⟲
                            </Button>
                          )}
                      </span>
                    </div>
                    {recording && (
                      <div className="pt-0.5 text-right font-mono text-meta text-s7">
                        {capture?.keys === undefined
                          ? 'press a chord · esc to cancel'
                          : conflict !== undefined
                            ? `${conflict} holds this — enter to reassign it`
                            : 'enter to apply · esc to cancel'}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        ))}

        {hits.length === 0 && (
          <div className="px-4 py-6 text-center text-sec text-s7">no shortcut matches</div>
        )}
      </div>
    </ModalShell>
  );
}

/** What the chord field shows: the bind's chips at rest, and while recording, the chord
 *  heard so far — or, if the key can't carry a binding, why it was refused. */
function ChordFace({
  keys,
  recording,
  error,
}: {
  keys?: string[] | undefined;
  recording: boolean;
  error?: string | undefined;
}): React.JSX.Element {
  if (error !== undefined) return <span className="font-mono text-caps text-crit">{error}</span>;
  if (recording && keys === undefined) {
    return <span className="font-mono text-caps text-run">listening…</span>;
  }
  if (keys === undefined || keys.length === 0) {
    return <span className="font-mono text-caps text-warn">unbound</span>;
  }
  return (
    <>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </>
  );
}
