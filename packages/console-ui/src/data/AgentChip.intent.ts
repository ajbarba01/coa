import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const agentChipIntent: ComponentIntent = assertIntent({
  name: 'AgentChip',
  family: 'Data-display',
  intent: "An agent's identity mark — its glyph on its categorical color ground.",
  useWhen: [
    'Identifying an agent in a picker row, rail, session list, or the agent editor header.',
  ],
  dontUseWhen: [
    'Conveying status or severity — use Badge.',
    'A generic decorative icon — use Icon.',
    'As the only encoding of identity — always pair with the agent name nearby.',
  ],
  anatomy:
    'A rounded square ground tinted with the agent color holding one glyph from the curated 16-glyph vocabulary; sizes sm/md/lg.',
  variantsStates: ['sm', 'md', 'lg', 'each of 8 categorical colors', 'decorative or labelled'],
  accessibility:
    'Decorative (aria-hidden) unless label is passed (role=img); identity is never color alone — the glyph differs per agent and the name renders beside it.',
  related: ['Icon', 'Badge', 'AgentRail', 'IdentityPicker'],
});
