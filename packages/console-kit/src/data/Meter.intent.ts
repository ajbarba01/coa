import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const meterIntent: ComponentIntent = assertIntent({
  name: 'Meter',
  family: 'Data',
  intent: 'Utilization against a known ceiling, as a bar that earns its color.',
  useWhen: [
    'A backend gave us both a value and its ceiling (a rate-limit window, a quota).',
    'Several of them stack, so the bars line up and comparison is a glance.',
  ],
  dontUseWhen: [
    'The ceiling is unknown — render the number alone, or say "unknown"; never fake a denominator.',
    'Progress of a task (that is a Spinner) or a count (that is text).',
  ],
  anatomy:
    'A square-ended ground track with a fill sized by percent, toned by the value it earns. Boxy on purpose — a rounded pill reads as a control, not a measurement.',
  variantsStates: [
    'quiet (< warnAt — ground, the default)',
    'needs-you (>= warnAt — amber)',
    'critical (>= critAt — red)',
    'zero (a 1% hairline: read-and-empty must not read as never-read)',
  ],
  accessibility:
    'role="meter" with aria-valuenow/min/max; the caller renders the number in text beside it, so the reading never depends on the bar.',
  related: ['StatusDot', 'BrandMark'],
});
