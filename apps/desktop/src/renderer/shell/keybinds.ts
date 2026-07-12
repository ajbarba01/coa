import type { Keybind } from '@coa/console-kit';

/**
 * The keybinding model: a command's identity, its default chord, and the pure functions
 * that turn a keyboard event into a command.
 *
 * A binding is keyed by `id`, never by label — the label is prose that can be reworded,
 * the id is what dispatch, the persisted override, and every tooltip agree on.
 *
 * `fixed` binds are structural rather than commands (Escape belongs to the dismiss-layer
 * stack; Enter to the composer; the tab-jump row stands for nine positional keys) — they
 * appear in the reference so they're discoverable, but they cannot be rebound.
 */

/**
 * A command's scope — WHERE its chord answers, VS Code's `when` in the small.
 *
 * The tab commands are the reason this exists: ctrl+w on the agents surface must not
 * reach into the chat surface and close a session there. A chord out of scope does
 * NOTHING (and, being a no-op, needs no feedback) — it never acts at a distance.
 *
 * `chat` — only while the chat surface is the one you're looking at, in work mode, with
 * no dialog over it. Undefined scope = everywhere.
 */
export type Scope = 'chat';

/** Every command the shell dispatches. `keys` here is the DEFAULT — the user's override wins. */
export const DEFAULT_KEYBINDS: Keybind[] = [
  { id: 'palette', keys: ['ctrl', 'k'], label: 'command palette', group: 'global' },
  { id: 'search-sessions', keys: ['ctrl', 'p'], label: 'search sessions', group: 'global' },
  { id: 'settings', keys: ['ctrl', ','], label: 'settings', group: 'global' },
  { id: 'shortcuts', keys: ['ctrl', '/'], label: 'keyboard shortcuts', group: 'global' },
  { id: 'new-session', keys: ['ctrl', 't'], label: 'new session', group: 'sessions' },
  {
    id: 'reopen-tab',
    keys: ['ctrl', 'shift', 't'],
    label: 'reopen closed tab',
    group: 'sessions',
    scope: 'chat',
  },
  { id: 'close-tab', keys: ['ctrl', 'w'], label: 'close tab', group: 'sessions', scope: 'chat' },
  { id: 'next-tab', keys: ['ctrl', 'tab'], label: 'next tab', group: 'sessions', scope: 'chat' },
  {
    id: 'prev-tab',
    keys: ['ctrl', 'shift', 'tab'],
    label: 'previous tab',
    group: 'sessions',
    scope: 'chat',
  },
  {
    id: 'jump-tab',
    keys: ['ctrl', '1…9'],
    label: 'go to tab (9 = last)',
    group: 'sessions',
    fixed: true,
    scope: 'chat',
  },
  { id: 'toggle-dock', keys: ['ctrl', 'b'], label: 'toggle the session panel', group: 'workbench' },
  {
    id: 'find',
    keys: ['ctrl', 'f'],
    label: 'find in conversation',
    group: 'workbench',
    scope: 'chat',
  },
  {
    id: 'toggle-raw',
    keys: ['alt', 'r'],
    label: 'raw mode — the unfiltered loop',
    group: 'workbench',
    scope: 'chat',
  },
  {
    id: 'dismiss',
    keys: ['esc'],
    label: 'dismiss the topmost layer · stop a running turn',
    group: 'workbench',
    fixed: true,
  },
  { id: 'send', keys: ['enter'], label: 'send message', group: 'composer', fixed: true },
  {
    id: 'focus-composer',
    keys: ['enter'],
    label: 'focus the composer',
    group: 'composer',
    fixed: true,
    scope: 'chat',
  },
];

/** The user's rebindings: command id → chord. Persisted with the rest of the settings. */
export type KeybindOverrides = Record<string, string[]>;

/** Keys that name themselves differently in `KeyboardEvent.key` than on the keycap. */
const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  escape: 'esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

const MODIFIERS = new Set(['ctrl', 'alt', 'shift']);

/** Pure: the chord a keyboard event names, or `undefined` if it names none (a bare
 *  modifier press). Cmd folds into `ctrl` — one chord vocabulary across platforms. */
export function chordFromEvent(e: KeyboardEvent): string[] | undefined {
  const raw = e.key.toLowerCase();
  if (raw === 'control' || raw === 'meta' || raw === 'alt' || raw === 'shift') return undefined;
  const chord: string[] = [];
  if (e.ctrlKey || e.metaKey) chord.push('ctrl');
  if (e.altKey) chord.push('alt');
  if (e.shiftKey) chord.push('shift');
  chord.push(KEY_ALIASES[raw] ?? raw);
  return chord;
}

/** Pure: the canonical form of a chord — modifiers in a fixed order, then the key. Two
 *  chords are the same binding exactly when their canonical forms match. */
export function canonical(keys: string[]): string {
  const lower = keys.map((k) => k.toLowerCase());
  const mods = ['ctrl', 'alt', 'shift'].filter((m) => lower.includes(m));
  const rest = lower.filter((k) => !MODIFIERS.has(k));
  return [...mods, ...rest].join('+');
}

/** Pure: a chord is bindable only if a modifier carries it — a bare letter would swallow
 *  typing, and shift alone isn't a modifier for this purpose (shift+a is just `A`). */
export function isBindable(keys: string[]): boolean {
  const lower = keys.map((k) => k.toLowerCase());
  const hasCarrier = lower.includes('ctrl') || lower.includes('alt');
  return hasCarrier && lower.some((k) => !MODIFIERS.has(k));
}

/** Pure: the registry as it actually dispatches — defaults with the user's overrides laid
 *  over them. An override of an unknown id is ignored (a stale settings file can't
 *  invent commands); `fixed` binds ignore overrides too. */
export function effectiveKeybinds(defaults: Keybind[], overrides: KeybindOverrides): Keybind[] {
  return defaults.map((bind) => {
    const override = overrides[bind.id];
    if (bind.fixed === true || override === undefined) return bind;
    return { ...bind, keys: override };
  });
}

/** Pure: the command a chord would steal — the bind (other than `id`'s own) that already
 *  answers to it. Rebinding is allowed over it, but never silently (the capture warns
 *  and the loser is left unbound). */
export function conflictFor(binds: Keybind[], keys: string[], id: string): Keybind | undefined {
  const target = canonical(keys);
  return binds.find(
    (b) => b.id !== id && b.fixed !== true && b.keys.length > 0 && canonical(b.keys) === target,
  );
}

/** Pure: apply a rebinding — the chord moves to `id`, and whoever held it is left unbound
 *  (an empty chord) rather than fighting over the key. Returns the next override map. */
export function rebind(
  binds: Keybind[],
  overrides: KeybindOverrides,
  id: string,
  keys: string[],
): KeybindOverrides {
  const loser = conflictFor(binds, keys, id);
  const next: KeybindOverrides = { ...overrides, [id]: keys };
  if (loser !== undefined) next[loser.id] = [];
  return next;
}

/** Pure: the command a chord dispatches, if any. An unbound command (empty chord) answers
 *  to nothing — and neither does one whose scope isn't the one in force: the chord simply
 *  isn't a command HERE, so it can never reach across surfaces (see `Scope`). */
export function commandFor(
  binds: Keybind[],
  keys: string[],
  scope?: Scope | undefined,
): string | undefined {
  const target = canonical(keys);
  return binds.find(
    (b) =>
      b.keys.length > 0 &&
      canonical(b.keys) === target &&
      (b.scope === undefined || b.scope === scope),
  )?.id;
}

/** Pure: the scope in force, from the shell's own chrome state. The chat surface has to be
 *  the thing you're LOOKING at — not merely the thing that was last active — so a dialog
 *  over it, or the session browser in front of it, puts its commands out of reach. */
export function scopeOf(shell: {
  surface: string;
  mode: 'work' | 'search';
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  paletteOpen: boolean;
  projectOpen: boolean;
  newSessionOpen: boolean;
}): Scope | undefined {
  const dialogOpen =
    shell.settingsOpen ||
    shell.shortcutsOpen ||
    shell.paletteOpen ||
    shell.projectOpen ||
    shell.newSessionOpen;
  if (dialogOpen) return undefined;
  return shell.surface === 'chat' && shell.mode === 'work' ? 'chat' : undefined;
}

/** Pure: `ctrl+<n>` names a tab by POSITION — 1-indexed, and 9 means "the last one"
 *  however many are open (the editor convention). Returns the index into the tab list,
 *  or `undefined` if the chord isn't a jump or the position is past the end. */
export function jumpTarget(keys: string[], tabCount: number): number | undefined {
  const lower = keys.map((k) => k.toLowerCase());
  if (!lower.includes('ctrl') || lower.includes('alt') || lower.includes('shift')) return undefined;
  const digit = lower.find((k) => /^[1-9]$/.test(k));
  if (digit === undefined || tabCount === 0) return undefined;
  const n = Number(digit);
  if (n === 9) return tabCount - 1;
  return n <= tabCount ? n - 1 : undefined;
}
