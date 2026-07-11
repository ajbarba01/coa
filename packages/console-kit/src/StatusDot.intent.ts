import { assertIntent, type ComponentIntent } from './lib/intent.js';

export const statusDotIntent: ComponentIntent = assertIntent({
  name: 'StatusDot',
  family: 'Foundations',
  intent: "The indicator law's state vocabulary: state is a dot, never a word.",
  useWhen: ['Any surface naming a session/agent/tool state (running, needs-you, critical, done, idle).'],
  dontUseWhen: [
    'Magnitude — that is a count (zero renders nothing).',
    'Decorating inactive chrome with accent color.',
  ],
  anatomy: 'One aria-hidden circle sized by prop, colored by the status token.',
  variantsStates: ['running (blue)', 'needs-you (amber)', 'critical (red)', 'done (green)', 'idle (ground)'],
  accessibility: 'aria-hidden; the accompanying text names the thing, proximity carries the state.',
  related: ['Kbd'],
});
