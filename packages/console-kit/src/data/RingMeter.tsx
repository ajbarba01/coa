import { cx } from '../cx.js';
import { meterTone, type MeterTone } from './Meter.js';

/** Stroke color per earned tone — the same vocabulary as {@link Meter}'s fill, so
 *  the bar family and the ring family read as one system. */
const STROKE: Record<MeterTone, string> = {
  quiet: 'text-s8',
  'needs-you': 'text-warn',
  critical: 'text-crit',
};

export interface RingMeterProps {
  /** Utilization, 0–100, clamped. OMIT when the ceiling is unknown — the ring then
   *  renders as a dashed ground track (an honest unknown), never a fake fill. */
  percent?: number | undefined;
  /** Override the earned tone (callers with their own ramp thresholds pass it). */
  tone?: MeterTone;
  warnAt?: number;
  critAt?: number;
  /** Outer diameter in px. Compact by design — this is a shelf/chrome indicator. */
  size?: number;
  'aria-label'?: string;
  className?: string;
}

/**
 * The magnitude ring: {@link Meter}'s radial sibling, for the one place a bar
 * doesn't fit — a dense control shelf where utilization must stay visible at
 * glyph size. Same earned-color law (ground until worth looking at), same
 * square-ended fill, same rule that the caller renders the number beside/behind
 * it (a ring alone is a shape, not a reading — pair it with a Tooltip or text).
 */
export function RingMeter({
  percent,
  tone,
  warnAt,
  critAt,
  size = 14,
  className,
  ...aria
}: RingMeterProps): React.JSX.Element {
  const strokeWidth = 2;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const center = size / 2;
  const unknown = percent === undefined;
  const value = Math.max(0, Math.min(100, percent ?? 0));
  // A >0 reading draws at least a visible tick — "read, and nearly empty" must not
  // look like "not read at all" (the Meter's own 1%-hairline rule, radially).
  const arc = value > 0 ? Math.max(circumference * (value / 100), 1.5) : 0;
  const earned = tone ?? meterTone(value, warnAt, critAt);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      {...(unknown
        ? { role: 'img' }
        : {
            role: 'meter',
            'aria-valuenow': Math.round(value),
            'aria-valuemin': 0,
            'aria-valuemax': 100,
          })}
      {...aria}
      className={cx('shrink-0', className)}
    >
      {/* The ground track: solid when measuring, dashed when the ceiling is unknown. */}
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        {...(unknown ? { strokeDasharray: '2 2' } : {})}
        className="text-s4"
      />
      {!unknown && (
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arc} ${circumference}`}
          // Fill grows clockwise from 12 o'clock — the clock everyone already reads.
          transform={`rotate(-90 ${center} ${center})`}
          className={cx('slip-move', STROKE[earned])}
        />
      )}
    </svg>
  );
}
