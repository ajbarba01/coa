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
    'A floating rounded control surface (not a full-width bordered panel): an auto-growing textarea over a toolbar row — a leading attach control, host-provided slotStart (model/effort/permission selects), host-provided slotEnd, a mic control, and a trailing glyph Send/Stop toggle. Attach and mic render disabled (inert) until a host wires a handler.',
  variantsStates: ['idle', 'running', 'disabled', 'multiline', 'attach-inert', 'mic-inert'],
  accessibility:
    'The textarea carries an aria-label; Enter sends (unless Shift or IME-composing), Shift+Enter inserts a newline, Esc calls onInterrupt while running; Send/Stop are native focusable buttons.',
  related: ['Transcript', 'Button', 'Select'],
});
