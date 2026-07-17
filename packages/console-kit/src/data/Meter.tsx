import { cx } from '../cx.js';

/** Color is earned, not decorative (the indicator law). A meter is ground until it
 *  is worth looking at, amber when it wants attention, red when it is nearly spent. */
export type MeterTone = 'quiet' | 'needs-you' | 'critical';

const FILL: Record<MeterTone, string> = {
  quiet: 'bg-s8',
  'needs-you': 'bg-warn',
  critical: 'bg-crit',
};

/** Pure: the tone a utilization earns. Below `warnAt` a meter stays ground —
 *  a bar that is colored from 1% teaches nothing. */
export function meterTone(percent: number, warnAt = 50, critAt = 75): MeterTone {
  if (percent >= critAt) return 'critical';
  if (percent >= warnAt) return 'needs-you';
  return 'quiet';
}

export interface MeterProps {
  /** Utilization, 0–100. Clamped; a value the backend never gave us is not a meter — omit it. */
  percent: number;
  /** Override the earned tone (e.g. an unknown/degraded read rendered as ground). */
  tone?: MeterTone;
  warnAt?: number;
  critAt?: number;
  'aria-label'?: string;
  className?: string;
}

/** The magnitude bar: a track and a fill, nothing else. Always paired with its own
 *  number in the caller — a bar alone is a shape, not a reading. */
export function Meter({
  percent,
  tone,
  warnAt,
  critAt,
  className,
  ...aria
}: MeterProps): React.JSX.Element {
  const value = Math.max(0, Math.min(100, percent));
  const earned = tone ?? meterTone(value, warnAt, critAt);
  return (
    // Square ends, not rounded: this is a measured quantity against a scale, and the
    // terminal register reads a rounded pill as a control. The rest of the console is
    // near-boxy (r1–r4); a meter is the one thing that should be exactly boxy.
    <div
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      // h-1 matches the per-model spend bars on the usage dashboard — the two bar
      // families read as one system at one weight.
      className={cx('h-1 w-full overflow-hidden bg-s4', className)}
      {...aria}
    >
      {/* A 0% meter still draws a hairline of fill: "read, and empty" must not look
          like "not read at all" (which renders no meter at all). */}
      <div
        className={cx('slip-move h-full', FILL[earned])}
        style={{ width: `${Math.max(value, 1)}%` }}
      />
    </div>
  );
}
