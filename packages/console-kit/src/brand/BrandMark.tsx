import { cx } from '../cx.js';

/** One filled shape of a mark, in the mark's own coordinate space. */
export interface BrandPath {
  d: string;
  /** The path's own colour. Absent ⇒ the spec's brand colour. */
  fill?: string;
  rule?: 'evenodd' | 'nonzero';
}

/** A third party's identity, as data. The hex is the OUTSIDE world's brand colour — it is not a
 *  token and never will be, which is exactly why it arrives as a value on a spec rather than as
 *  a class inside a component (see docs/adr/0015). */
export interface BrandMarkSpec {
  /** Accessible name — the provider as a human says it ("Claude", "Tavily"). */
  name: string;
  /** Brand hex. Fills a single-colour mark, and grounds the monogram tile. */
  color: string;
  /** The mark's own viewBox. Defaults to the 24×24 the icon sets use. */
  viewBox?: string;
  /** The mark itself. Absent ⇒ the monogram tile is drawn instead. */
  paths?: BrandPath[];
  /** The logo was drawn for LIGHT backgrounds (its fill is near-black). On the sand-dark ground
   *  it is drawn in ink instead — which is what these vendors' own dark lockups do. */
  invert?: boolean;
  /** 1–2 characters. Used when no official mark is bundled for this provider. */
  monogram?: string;
}

export interface BrandMarkProps {
  spec: BrandMarkSpec;
  /** Edge length in px. */
  size?: number;
  /** A benched provider is still itself — desaturated and dimmed, never recoloured. */
  muted?: boolean;
  className?: string;
}

/** The provider's own mark, in the provider's own colour — the one place the console spends
 *  colour on inactive chrome. A logo IS the identity on a credentials surface; reading it should
 *  cost no thought. Providers we ship no official mark for degrade to a monogram tile, so a new
 *  provider stays a registry row and zero new UI. */
export function BrandMark({
  spec,
  size = 16,
  muted = false,
  className,
}: BrandMarkProps): React.JSX.Element {
  const box = { width: size, height: size };
  const face = cx('slip block flex-none', muted && 'opacity-40 grayscale', className);

  if (spec.paths === undefined || spec.paths.length === 0) {
    return (
      <span
        role="img"
        aria-label={spec.name}
        className={cx(
          face,
          'flex items-center justify-center rounded-r1 font-mono font-bold text-s1',
        )}
        // The tile's ground is the brand colour; the glyph sits on it in the darkest step, so it
        // reads on any hue we are handed. Font size tracks the tile.
        style={{ ...box, background: spec.color, fontSize: Math.round(size * 0.55) }}
      >
        {spec.monogram ?? spec.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  // A monochrome mark drawn for light grounds is re-inked, not re-hued: identity survives, the
  // contrast problem doesn't. `currentColor` lets the caller's text colour carry it.
  const base = spec.invert === true ? 'currentColor' : spec.color;

  return (
    <svg
      role="img"
      aria-label={spec.name}
      viewBox={spec.viewBox ?? '0 0 24 24'}
      className={cx(face, spec.invert === true && 'text-s11')}
      style={box}
    >
      {spec.paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ?? base} fillRule={p.rule ?? 'nonzero'} />
      ))}
    </svg>
  );
}
