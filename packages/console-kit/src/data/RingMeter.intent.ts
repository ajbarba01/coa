import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const ringMeterIntent: ComponentIntent = assertIntent({
  name: 'RingMeter',
  family: 'Data',
  intent: "Meter's radial sibling: utilization at glyph size, for dense chrome a bar cannot fit.",
  useWhen: [
    'A control shelf or title-bar slot needs always-visible utilization beside other glyph-sized controls (the composer context ring).',
    'The value AND its ceiling are real; the exact numbers ride proximity (a Tooltip), never the ring alone.',
  ],
  dontUseWhen: [
    'There is room for a bar — Meter aligns and compares better; the ring is the constrained-space fallback.',
    'The ceiling is unknown and you are tempted to guess one — pass no percent; the ring renders its dashed unknown track instead.',
  ],
  anatomy:
    'An SVG ground-track circle with a square-ended arc fill growing clockwise from 12 o’clock, stroke-toned by the value it earns. No percent at all ⇒ a dashed track and no fill (an honest unknown).',
  variantsStates: [
    'quiet (< warnAt — ground)',
    'needs-you (>= warnAt — amber)',
    'critical (>= critAt — red)',
    'near-zero (a minimum visible tick: read-and-empty must not read as never-read)',
    'unknown (dashed track, no fill, role=img)',
  ],
  accessibility:
    'role="meter" with aria-valuenow/min/max when measuring; role="img" with the caller’s aria-label when unknown. The caller pairs it with text/tooltip for the actual numbers.',
  related: ['Meter', 'StatusDot', 'Tooltip'],
});
