import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const transcriptIntent: ComponentIntent = assertIntent({
  name: 'Transcript',
  family: 'Dense/Viz',
  intent: 'A virtualized turn stream of role-tagged conversation frames.',
  useWhen: [
    'Showing the agent conversation — text, tool calls, approvals, denies, or the raw loop.',
  ],
  dontUseWhen: [
    'Showing one long document — use Longform/PromptView.',
    'Showing tabular records — use Table.',
  ],
  anatomy:
    'A labelled log region virtualizing per-kind rows (text, tool-use, tool-result, approval, deny, raw).',
  variantsStates: [
    'text',
    'tool-use',
    'tool-result',
    'approval',
    'approval-resolved',
    'deny',
    'raw',
    'empty',
  ],
  accessibility:
    'role=log with an aria-label; approval actions are native focusable buttons; payloads render byte-faithfully.',
  related: ['DenyNotice', 'Code', 'Table'],
});
