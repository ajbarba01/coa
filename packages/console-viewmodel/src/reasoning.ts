import type { ClaudeReasoning, ModelDescriptor } from '@coa/shared';
import { claudeEffortSchema } from '@coa/shared';

const EFFORTS = claudeEffortSchema.options;

/**
 * The sentinel effort a binary thinking toggle stores for its "On" state. The reasoning
 * union has no `on` mode, and every pure-API backend that exposes a thinking toggle reads
 * any `mode:'effort'` as thinking-enabled — so "On" round-trips as an effort value, keeping
 * the value-based `toReasoning`/`reasoningValue` mapping model-blind.
 */
const THINKING_ON: (typeof EFFORTS)[number] = 'high';

export function effortOptions(model?: ModelDescriptor): { value: string; label: string }[] {
  if (model?.supportsEffort === true) {
    const levels = model.supportedEffortLevels ?? [];
    return [{ value: 'off', label: 'No thinking' }, ...levels.map((e) => ({ value: e, label: e }))];
  }
  // A model with a binary thinking toggle (no graded ladder) surfaces as On/Off.
  if (model?.supportsThinking === true) {
    return [
      { value: 'off', label: 'Off' },
      { value: THINKING_ON, label: 'On' },
    ];
  }
  return [];
}

export function toReasoning(value: string): ClaudeReasoning {
  if (value === 'off') return { mode: 'off' };
  const effort = EFFORTS.find((e) => e === value);
  return effort ? { mode: 'effort', effort } : { mode: 'off' };
}

export function reasoningValue(reasoning?: ClaudeReasoning): string {
  return reasoning?.mode === 'effort' ? reasoning.effort : 'off';
}
