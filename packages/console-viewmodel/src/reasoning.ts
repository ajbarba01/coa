import type { ClaudeReasoning, ModelDescriptor } from '@coa/shared';
import { claudeEffortSchema } from '@coa/shared';

const EFFORTS = claudeEffortSchema.options;

export function effortOptions(model?: ModelDescriptor): { value: string; label: string }[] {
  if (model?.supportsEffort !== true) return [];
  const levels = model.supportedEffortLevels ?? [];
  return [{ value: 'off', label: 'No thinking' }, ...levels.map((e) => ({ value: e, label: e }))];
}

export function toReasoning(value: string): ClaudeReasoning {
  if (value === 'off') return { mode: 'off' };
  const effort = EFFORTS.find((e) => e === value);
  return effort ? { mode: 'effort', effort } : { mode: 'off' };
}

export function reasoningValue(reasoning?: ClaudeReasoning): string {
  return reasoning?.mode === 'effort' ? reasoning.effort : 'off';
}
