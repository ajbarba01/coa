export interface CollapseSpec {
  min: number;
  max: number;
  /** Dragging tighter than this collapses the panel… */
  collapseBelow: number;
  /** …and it stays collapsed until the drag comes back out past this.
   *  The gap between the two kills boundary flapping mid-gesture. */
  reopenAt: number;
}

export interface CollapseResult {
  open: boolean;
  /** The width to store, or null to leave the stored width untouched. */
  width: number | null;
}

export function resolveCollapse(
  desired: number,
  spec: CollapseSpec,
  open: boolean,
): CollapseResult {
  if (desired < spec.collapseBelow) return { open: false, width: null };
  if (desired < spec.reopenAt) return { open, width: null };
  return { open: true, width: Math.min(spec.max, Math.max(spec.min, desired)) };
}
