import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const switcherMenuIntent: ComponentIntent = assertIntent({
  name: 'SwitcherMenu',
  family: 'Actions',
  intent: 'A grouped dropdown for switching the current entity (agent, session) with rich rows.',
  useWhen: [
    'Switching among named entities organized in groups (pinned/project/personal agents; per-agent then all-agent sessions), optionally with create-new action rows.',
  ],
  dontUseWhen: [
    'Picking a plain form value — use Select.',
    'A list of commands — use Menu.',
    'Editing/renaming the entity — that happens on its surface, never inside the picker.',
  ],
  anatomy:
    'A trigger and a portalled menu of eyebrow-labelled groups; each row = leading visual + label + quiet meta + selected check; groups may end in action rows.',
  variantsStates: [
    'closed',
    'open',
    'row highlighted',
    'row selected',
    'action row',
    'empty group (hidden)',
  ],
  accessibility:
    'Radix menu semantics (roving focus, arrows, type-ahead, Escape); groups labelled; selection is marked with a check icon, not color alone.',
  related: ['Menu', 'Select', 'AgentChip'],
});
