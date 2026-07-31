import { Check, Copy, Mic, Paperclip } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The kit's drawn glyph — a Lucide mark at the house convention.
 *
 * Lucide is a real dependency rather than pasted paths on purpose: the app was ALREADY
 * drawing Lucide art (the composer's attach + mic were its paths, hand-copied with no
 * version and no attribution), so this makes honest what was already true and stops the
 * copy-paste drift. The kit already takes @base-ui/react for mechanics on the same
 * reasoning; see docs/adr/0014 and constitution P8.
 *
 * Every visual default (stroke width, caps, joins, viewBox, currentColor) comes from
 * Lucide's own attributes, which is precisely the convention the hand-copied SVGs used —
 * so this pins the house look in ONE place and call sites cannot drift from it.
 */

/** The seeded glyph set. Add a member when a surface needs it — not in bulk. */
const GLYPHS = {
  copy: Copy,
  check: Check,
  attach: Paperclip,
  mic: Mic,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof GLYPHS;

/** Size rides a token, never a literal (UI.md: no raw values). */
const SIZES = {
  sm: 'var(--icon-sm)',
  md: 'var(--icon-md)',
} as const;

export interface IconProps {
  name: IconName;
  /** sm (default) is the house size; md is for a glyph carrying a row on its own. */
  size?: keyof typeof SIZES;
  /**
   * An accessible name. Provide it ONLY when the icon is the sole content of a control —
   * an icon beside a text label must stay decorative or screen readers announce twice.
   */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 'sm', label, className }: IconProps): React.JSX.Element {
  const Glyph = GLYPHS[name];
  const dimension = SIZES[size];
  return (
    <Glyph
      // Sizing rides CSS, NOT the svg width/height attributes: those are presentation
      // attributes and do not resolve var() — handing them a token silently discards it
      // and the glyph falls back to lucide's 24px default. (jsdom stores the bad string
      // without complaint, so an attribute assertion cannot catch this; the sizing test
      // reads the resolved style instead.)
      style={{ width: dimension, height: dimension }}
      // Never a color prop: the icon inherits its parent's palette step so it cannot
      // drift from the text it sits beside.
      className={className}
      {...(label !== undefined
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': true, focusable: false })}
    />
  );
}
