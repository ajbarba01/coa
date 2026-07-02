import { describe, expect, it } from 'vitest';
import type { BackendMessage } from '@coa/shared';
import { formatHistoryPreamble, withHistoryPreamble } from './history-preamble.js';

const history: BackendMessage[] = [
  { role: 'user', content: 'find the pay code' },
  {
    role: 'assistant',
    content: 'looking',
    toolCalls: [{ id: 'c1', name: 'Grep', arguments: { q: 'pay' } }],
  },
  { role: 'tool', toolCallId: 'c1', content: 'src/pay.ts:12' },
  { role: 'assistant', content: 'it is in pay.ts' },
];

describe('formatHistoryPreamble', () => {
  it('renders each role and the tool calls, wrapped in a delimiter block', () => {
    const out = formatHistoryPreamble(history);
    expect(out.startsWith('<prior_conversation>')).toBe(true);
    expect(out.endsWith('</prior_conversation>')).toBe(true);
    expect(out).toContain('User: find the pay code');
    expect(out).toContain('Assistant: looking');
    expect(out).toContain('called Grep({"q":"pay"})');
    expect(out).toContain('Tool result: src/pay.ts:12');
    expect(out).toContain('Assistant: it is in pay.ts');
  });
});

describe('withHistoryPreamble', () => {
  it('prepends the preamble to the input when there is prior memory', () => {
    const out = withHistoryPreamble('now fix it', history);
    expect(out).toContain('<prior_conversation>');
    expect(out.endsWith('now fix it')).toBe(true);
  });

  it('returns the input unchanged when there is no history', () => {
    expect(withHistoryPreamble('hello', [])).toBe('hello');
  });
});
