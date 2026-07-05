import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const toolCardIntent: ComponentIntent = assertIntent({
  name: 'ToolCard',
  family: 'Dense/Viz',
  intent: 'A rich, self-contained rendering of one agent tool call.',
  useWhen: [
    'Showing a tool call in the transcript — a highlighted diff for edits, a read/search preview, or a command-output tail, with a clickable path and an estimated-token readout.',
  ],
  dontUseWhen: [
    'Rendering prose or a plan checklist — those are their own transcript kinds.',
    'A one-line activity summary is enough — that is a different tool-block direction.',
  ],
  anatomy:
    'A header (tool icon, verb, clickable file path, summary, estimated tokens, status glyph) over a body that leads with a byte-faithful highlighted diff / preview / output tail, clamped to a max line count with an Expand affordance that opens the full body in the pane overlay.',
  variantsStates: ['running', 'ok', 'failed', 'diff', 'preview', 'command-tail', 'truncated', 'expanded'],
  accessibility:
    'The path is a focusable button when actionable; Expand is a button; the status glyph carries an aria-label; payload bytes render verbatim.',
  related: ['ToolDiffView', 'PaneOverlay', 'Code', 'Transcript'],
});
