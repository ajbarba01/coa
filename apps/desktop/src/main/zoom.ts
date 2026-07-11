/**
 * Pure helpers for the Ctrl+/- window zoom (VSCode-style). The whole DOM — including
 * the custom DOM title bar and its window controls — scales with the Electron
 * zoom level, so this is a content-zoom concern, not a chrome one. Kept free of any
 * Electron import so the clamp + key mapping are unit-testable in isolation; the wiring
 * (`before-input-event` → `setZoomLevel`) lives in `index.ts`.
 *
 * The persisted user level and the *applied* Electron zoom level are distinct: the
 * workbench renders at a 120% base scale (Electron level 1), so `appliedLevel` shifts
 * the user's 0-centered offset onto that base before it reaches `setZoomLevel`.
 */

/** The zoom level bounds, matching VSCode's window-zoom feel: ≈51% (−3) … ≈249% (+5)
 *  relative to the user's own 100% (0) — these bound the persisted offset, not the
 *  applied Electron level (see {@link appliedLevel}). */
export const MIN_ZOOM_LEVEL = -3;
export const MAX_ZOOM_LEVEL = 5;

/** The workbench's base Electron zoom level: level 1 = factor 1.2 (120%) exactly.
 *  The persisted `settings.zoomLevel` stays the user's 0-centered offset from this
 *  base (reset → offset 0 → applied level {@link BASE_ZOOM_LEVEL} → 120%). */
export const BASE_ZOOM_LEVEL = 1;

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

/** Translate a persisted user offset into the Electron zoom level actually applied,
 *  by shifting it onto the workbench's 120% base ({@link BASE_ZOOM_LEVEL}). */
export function appliedLevel(userLevel: number): number {
  return BASE_ZOOM_LEVEL + clampLevel(userLevel);
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
