import type { LucideIcon } from 'lucide-react';

export interface IconProps {
  /** A Lucide icon component. */
  name: LucideIcon;
  /** Pixel size (default 16, snapped to the icon grid). */
  size?: number;
  /** If provided, the icon is meaningful and announced; otherwise it is decorative. */
  label?: string;
  className?: string;
}

/** The one wrapped icon. Consistent stroke + size; decorative unless labelled. */
export function Icon({ name: Glyph, size = 16, label, className }: IconProps): React.JSX.Element {
  return label !== undefined ? (
    <Glyph size={size} strokeWidth={2} role="img" aria-label={label} className={className} />
  ) : (
    <Glyph size={size} strokeWidth={2} aria-hidden className={className} focusable={false} />
  );
}
