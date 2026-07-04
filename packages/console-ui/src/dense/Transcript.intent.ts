import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const transcriptIntent: ComponentIntent = assertIntent({
  name: 'Transcript',
  family: 'Dense/Viz',
  intent: 'A non-virtualized turn stream of role-tagged conversation frames.',
  useWhen: [
    'Showing the agent conversation — text, tool calls, thinking, plans, approvals, denies, errors, subagent activity, a switched-model note, or the raw loop.',
  ],
  dontUseWhen: [
    'Showing one long document — use Longform/PromptView.',
    'Showing tabular records — use Table.',
  ],
  anatomy:
    'A labelled log region rendering every frame to the DOM (no windowing) as per-kind rows (text as markdown, tool-use, tool-result, thinking, plan, approval, deny, error, subagent, note, raw), with content-visibility keeping off-screen rows out of layout/paint; native scroll drives stick-to-bottom with a jump-to-latest/jump-to-prompt control, and an internal Ctrl/Cmd+F find bar searches the full transcript.',
  variantsStates: [
    'user-turn',
    'text',
    'tool-use',
    'tool-result',
    'thinking',
    'plan',
    'approval',
    'approval-resolved',
    'deny',
    'error',
    'subagent',
    'note',
    'nested',
    'raw',
    'find-open',
    'empty',
  ],
  accessibility:
    'role=log with an aria-label; approval actions are native focusable buttons; the find bar is a labelled search region; payloads render byte-faithfully.',
  related: ['DenyNotice', 'Code', 'Markdown', 'Table'],
});
