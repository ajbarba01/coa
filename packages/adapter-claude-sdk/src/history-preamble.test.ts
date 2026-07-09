import { describe, expect, it } from 'vitest';
import type { BackendMessage } from '@coa/shared';
import {
  formatHistoryPreamble,
  withHistoryPreamble,
  withHistoryPreambleStreaming,
} from './history-preamble.js';

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

describe('withHistoryPreambleStreaming', () => {
  it('prepends the preamble to only the first streamed turn, passing later turns through unchanged', async () => {
    async function* turns(): AsyncGenerator<string> {
      yield 'now fix it';
      yield 'also do this';
    }
    const seen: string[] = [];
    for await (const text of withHistoryPreambleStreaming(turns(), history)) seen.push(text);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(withHistoryPreamble('now fix it', history));
    expect(seen[1]).toBe('also do this');
  });

  it('degrades to a pure pass-through when there is no history (D85)', async () => {
    async function* turns(): AsyncGenerator<string> {
      yield 'hello';
      yield 'world';
    }
    const seen: string[] = [];
    for await (const text of withHistoryPreambleStreaming(turns(), [])) seen.push(text);

    expect(seen).toEqual(['hello', 'world']);
  });
});
