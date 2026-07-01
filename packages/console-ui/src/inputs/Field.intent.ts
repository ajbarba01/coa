import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const fieldIntent: ComponentIntent = assertIntent({
  name: 'Field',
  family: 'Inputs',
  intent: 'Wraps a control with an associated label, description, and error.',
  useWhen: ['Building a custom control that needs label/description/error wiring.'],
  dontUseWhen: ['You want a ready-made text input — use TextField.'],
  anatomy: 'Label, optional description, the control (render-prop), optional error alert.',
  variantsStates: ['rest', 'invalid (error present)'],
  accessibility:
    'Associates label via id and description/error via aria-describedby; error uses role=alert.',
  related: ['TextField', 'Select', 'Combobox'],
});
