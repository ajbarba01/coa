import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { DriverMessage, ToolDef } from '@coa/loop-driver';
import { makeDeepSeekComplete, type FetchLike } from './complete.js';

interface Captured {
  url?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** A fake transport that captures the request and returns a canned JSON response. */
function fakeFetch(response: unknown, captured: Captured, ok = true, status = 200): FetchLike {
  return async (url, init) => {
    captured.url = url;
    captured.headers = init.headers;
    captured.body = init.body !== undefined ? JSON.parse(init.body) : undefined;
    return {
      ok,
      status,
      text: async () => 'error body',
      json: async () => response,
    };
  };
}

const textResponse = {
  choices: [{ message: { content: 'hello' } }],
  usage: { prompt_tokens: 10, completion_tokens: 4 },
};

describe('makeDeepSeekComplete', () => {
  it('builds the request: model, mapped messages, JSON-schema tools, and auth header', async () => {
    const captured: Captured = {};
    const complete = makeDeepSeekComplete({
      apiKey: 'sk-1',
      model: 'deepseek-chat',
      fetchImpl: fakeFetch(textResponse, captured),
    });
    const messages: DriverMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
    ];
    const tools: ToolDef[] = [
      { name: 'get_symbol', description: 'd', parameters: { name: z.string() } },
    ];

    await complete(messages, tools);

    expect(captured.url).toBe('https://api.deepseek.com/chat/completions');
    expect(captured.headers?.['authorization']).toBe('Bearer sk-1');
    expect(captured.body?.['model']).toBe('deepseek-chat');
    expect(captured.body?.['messages']).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
    ]);
    const wireTool = (captured.body?.['tools'] as Array<{ function: { parameters: unknown } }>)[0]!;
    expect(wireTool.function.parameters).toMatchObject({ type: 'object' });
  });

  it('maps the response to text, parsed tool calls, and priced usage', async () => {
    const captured: Captured = {};
    const complete = makeDeepSeekComplete({
      apiKey: 'sk-1',
      model: 'm',
      prices: { m: { inPerMillion: 1_000_000, outPerMillion: 0 } },
      fetchImpl: fakeFetch(
        {
          choices: [
            {
              message: {
                content: 'looking',
                tool_calls: [
                  {
                    id: 't1',
                    type: 'function',
                    function: { name: 'get_symbol', arguments: '{"name":"pay"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        },
        captured,
      ),
    });

    const result = await complete([{ role: 'user', content: 'go' }], []);

    expect(result.text).toBe('looking');
    expect(result.toolCalls).toEqual([
      { id: 't1', name: 'get_symbol', arguments: { name: 'pay' } },
    ]);
    expect(result.usage).toMatchObject({ tokensIn: 2, tokensOut: 1, costUsd: 2 });
  });

  it('sends reasoning_effort when configured, and maps tool + assistant messages', async () => {
    const captured: Captured = {};
    const complete = makeDeepSeekComplete({
      apiKey: 'sk-1',
      model: 'm',
      reasoning: { kind: 'effort', effort: 'max' },
      fetchImpl: fakeFetch(textResponse, captured),
    });
    const messages: DriverMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'x', arguments: { a: 1 } }] },
      { role: 'tool', toolCallId: 't1', content: 'ok' },
    ];

    await complete(messages, []);

    expect(captured.body?.['reasoning_effort']).toBe('max');
    const wireMessages = captured.body?.['messages'] as Array<Record<string, unknown>>;
    expect(wireMessages[0]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{"a":1}' } }],
    });
    expect(wireMessages[1]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'ok' });
  });

  it('disables thinking (non-thinking mode) for the disabled reasoning kind', async () => {
    const captured: Captured = {};
    const complete = makeDeepSeekComplete({
      apiKey: 'sk-1',
      model: 'm',
      reasoning: { kind: 'disabled' },
      fetchImpl: fakeFetch(textResponse, captured),
    });

    await complete([{ role: 'user', content: 'go' }], []);

    expect(captured.body?.['thinking']).toEqual({ type: 'disabled' });
    expect(captured.body?.['reasoning_effort']).toBeUndefined();
  });

  it('captures reasoning_content as the completion reasoning, undefined when absent', async () => {
    const withReasoning = makeDeepSeekComplete({
      apiKey: 'sk-1',
      model: 'm',
      fetchImpl: fakeFetch(
        {
          choices: [
            { message: { content: 'the answer is 4', reasoning_content: 'because 2+2=4' } },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
        {},
      ),
    });
    const r1 = await withReasoning([{ role: 'user', content: 'go' }], []);
    expect(r1.reasoning).toBe('because 2+2=4');
    expect(r1.text).toBe('the answer is 4');

    const noReasoning = makeDeepSeekComplete({
      apiKey: 'sk-1',
      model: 'm',
      fetchImpl: fakeFetch(textResponse, {}),
    });
    expect((await noReasoning([{ role: 'user', content: 'go' }], [])).reasoning).toBeUndefined();
  });

  it('throws with the status on a non-ok response', async () => {
    const complete = makeDeepSeekComplete({
      apiKey: 'sk-1',
      model: 'm',
      fetchImpl: fakeFetch({}, {}, false, 429),
    });
    await expect(complete([{ role: 'user', content: 'go' }], [])).rejects.toThrow('429');
  });

  it('forwards the abort signal into the fetch call', async () => {
    let seenInit: { signal?: AbortSignal } | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      seenInit = init;
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => textResponse,
      };
    };
    const complete = makeDeepSeekComplete({ apiKey: 'sk-1', model: 'm', fetchImpl });
    const controller = new AbortController();

    await complete([{ role: 'user', content: 'go' }], [], controller.signal);

    expect(seenInit?.signal).toBe(controller.signal);
  });
});
