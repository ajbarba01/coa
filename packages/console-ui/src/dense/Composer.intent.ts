import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const composerIntent: ComponentIntent = assertIntent({
  name: 'Composer',
  family: 'Dense/Viz',
  intent: 'A multiline auto-growing message composer with a send/stop toggle.',
  useWhen: [
    'Sending a message into a live governed session — chat input with model/effort controls and a running-turn stop action.',
  ],
  dontUseWhen: [
    'A single-line filter or search field — use TextField.',
    'A structured form input — use Field/TextField/Select.',
  ],
  anatomy:
    'A resizable textarea over a toolbar row: host-provided slotStart (model/effort selects), slotEnd (e.g. expand), and a trailing Send/Stop toggle.',
  variantsStates: ['idle', 'running', 'disabled', 'multiline'],
  accessibility:
    'The textarea carries an aria-label; Enter sends (unless Shift or IME-composing), Shift+Enter inserts a newline, Esc calls onInterrupt while running; Send/Stop are native focusable buttons.',
  related: ['Transcript', 'Button', 'Select'],
});
