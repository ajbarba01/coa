import type { ClaudeReasoning } from '@coa/shared';
import type { EffortLevel, Options } from '@anthropic-ai/claude-agent-sdk';

/**
 * Map coa's faithful {@link ClaudeReasoning} onto the SDK's real reasoning options
 * — the 1:1 backend translation that lives only here (M9). `off` disables extended
 * thinking; `effort` runs adaptive thinking at the API's effort level; `budget`
 * pins a fixed thinking-token budget. The effort string is coa's mirror of the
 * SDK `EffortLevel`, so the cast is sound (the schemas share the same members).
 */
export function reasoningToOptions(reasoning: ClaudeReasoning): Pick<Options, 'thinking' | 'effort'> {
  switch (reasoning.mode) {
    case 'off':
      return { thinking: { type: 'disabled' } };
    case 'effort':
      return { thinking: { type: 'adaptive' }, effort: reasoning.effort as EffortLevel };
    case 'budget':
      return { thinking: { type: 'enabled', budgetTokens: reasoning.budgetTokens } };
  }
}
