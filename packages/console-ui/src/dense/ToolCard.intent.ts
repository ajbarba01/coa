import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const toolCardIntent: ComponentIntent = assertIntent({
  name: 'ToolCard',
  family: 'Dense/Viz',
  intent: 'A rich, self-contained rendering of one agent tool call.',
  useWhen: [
    'Showing a tool call in the transcript — a highlighted diff for edits and symbol edits, a read/symbol-source preview, clickable search-match rows, run_checks status chips, or a command-output tail, with a clickable path/line and an estimated-token readout.',
  ],
  dontUseWhen: [
    'Rendering prose or a plan checklist — those are their own transcript kinds.',
    'A one-line activity summary is enough — that is a different tool-block direction.',
  ],
  anatomy:
    'A header (a leading status dot in one fixed slot — blue running, green succeeded, red failed — tool icon, verb, clickable file path with an optional line — or a WebFetch source URL that opens in the browser, a summary that carries the symbol/patch detail past the file, estimated tokens) over a body that leads with a byte-faithful highlighted diff (edits + symbol edits), a highlighted preview (reads + symbol source), clickable search-match rows, clickable WebSearch result links, run_checks status chips, or a command-output tail with red-marked error tokens. A failure (ok:false) takes priority: its output is always shown as a red error body, never collapsed to header-only. An empty search result renders no body — the 0-count shows in the header. Read/search/fetch tools otherwise collapse to the header + an Expand control by default; other bodies clamp to a max line count. Expand opens the full body in the pane overlay.',
  variantsStates: [
    'running',
    'ok',
    'failed',
    'diff',
    'preview',
    'matches',
    'web-links',
    'empty',
    'checks',
    'command-tail',
    'truncated',
    'expanded',
  ],
  accessibility:
    'The path, each search-match row, and each web link are focusable buttons when actionable; Expand is a labelled button; the status glyph carries an aria-label; payload bytes render verbatim.',
  related: ['ToolDiffView', 'PaneOverlay', 'Code', 'Transcript'],
});
