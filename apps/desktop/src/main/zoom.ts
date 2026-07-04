/**
 * Pure helpers for the Ctrl+/- window zoom (VSCode-style). The whole DOM — including
 * the custom AppShell title bar and its window controls — scales with the Electron
 * zoom level, so this is a content-zoom concern, not a chrome one. Kept free of any
 * Electron import so the clamp + key mapping are unit-testable in isolation; the wiring
 * (`before-input-event` → `setZoomLevel`) lives in `index.ts`.
 */

/** The zoom level bounds, matching VSCode's window-zoom feel: ≈51% (−3) … ≈249% (+5). */
export const MIN_ZOOM_LEVEL = -3;
export const MAX_ZOOM_LEVEL = 5;

/** A single zoom intent decoded from a keystroke. */
export type ZoomAction = 'in' | 'out' | 'reset';

/** Clamp a level into the supported range. */
export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, Math.round(level)));
}

/** Apply a zoom action to the current level, clamped. `reset` returns to 100% (0). */
export function nextLevel(current: number, action: ZoomAction): number {
  if (action === 'reset') return 0;
  return clampLevel(clampLevel(current) + (action === 'in' ? 1 : -1));
}

/** The subset of an Electron `before-input-event` Input this decoder reads. */
export interface ZoomInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
}

/**
 * Decode a keystroke into a zoom action, or `undefined` if it isn't one. Fires on the
 * accelerator modifier (Ctrl on Windows/Linux, ⌘ on macOS via `meta`): `=`/`+` zoom in,
 * `-` zoom out, `0` reset. `key` normalizes numpad keys to their character, so the
 * numeric-keypad +/-/0 are covered without a separate `code` check.
 */
export function keyToZoomAction(input: ZoomInput): ZoomAction | undefined {
  if (input.type !== 'keyDown') return undefined;
  if (!input.control && !input.meta) return undefined;
  switch (input.key) {
    case '=':
    case '+':
      return 'in';
    case '-':
      return 'out';
    case '0':
      return 'reset';
    default:
      return undefined;
  }
}
