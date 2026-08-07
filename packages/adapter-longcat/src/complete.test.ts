import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CompletionDelta, CompletionResult, DriverMessage, ToolDef } from '@coa/loop-driver';
import { makeLongCatComplete, type FetchLike } from './complete.js';

/**
 * Drain a non-streaming `complete()` (the pass-through degrade: yields nothing, returns the settled
 * result) to its return value, so these tests can assert on the result the way they did
 * before `complete()` became a generator.
 */
async function drain(
  gen: AsyncGenerator<CompletionDelta, CompletionResult>,
): Promise<CompletionResult> {
  let step = await gen.next();
  while (step.done !== true) step = await gen.next();
  return step.value;
}

interface Captured {
  url?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** An async-iterable body of raw SSE event strings (what `Response.body` yields as bytes). */
function sseBody(...events: string[]): AsyncIterable<Uint8Array> {
  const enc = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield enc.encode(e);
    },
  };
}

/** Serialize a non-streaming chat-completion fixture into the equivalent SSE stream, so the
 *  request/result assertions below stay meaningful now that `complete()` reads `res.body`. */
function toSseBody(response: unknown): AsyncIterable<Uint8Array> {
  const msg =
    (response as { choices?: Array<{ message?: Record<string, unknown> }> }).choices?.[0]
      ?.message ?? {};
  const usage = (response as { usage?: unknown }).usage;
  const events: string[] = [];
  const push = (obj: unknown): number => events.push(`data: ${JSON.stringify(obj)}\n\n`);
  if (typeof msg['reasoning_content'] === 'string')
    push({ choices: [{ delta: { reasoning_content: msg['reasoning_content'] } }] });
  if (typeof msg['content'] === 'string')
    push({ choices: [{ delta: { content: msg['content'] } }] });
  const toolCalls =
    (msg['tool_calls'] as Array<{ id: string; function: { name: string; arguments: string } }>) ??
    [];
  toolCalls.forEach((tc, index) =>
    push({ choices: [{ delta: { tool_calls: [{ index, id: tc.id, function: tc.function }] } }] }),
  );
  if (usage != null) push({ choices: [{ delta: {} }], usage });
  events.push('data: [DONE]\n\n');
  return sseBody(...events);
}

/** A fake transport that captures the request and streams a canned response as SSE. */
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
      body: toSseBody(response),
    };
  };
}

const textResponse = {
  choices: [{ message: { content: 'hello' } }],
  usage: { prompt_tokens: 10, completion_tokens: 4 },
};

describe('makeLongCatComplete', () => {
  it('builds the request: model, mapped messages, JSON-schema tools, and auth header', async () => {
    const captured: Captured = {};
    const complete = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'LongCat-2.0',
      fetchImpl: fakeFetch(textResponse, captured),
    });
    const messages: DriverMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
    ];
    const tools: ToolDef[] = [
      { name: 'get_symbol', description: 'd', parameters: { name: z.string() } },
    ];

    await drain(complete(messages, tools));

    expect(captured.url).toBe('https://api.longcat.chat/openai/v1/chat/completions');
    expect(captured.headers?.['authorization']).toBe('Bearer sk-1');
    expect(captured.body?.['model']).toBe('LongCat-2.0');
    expect(captured.body?.['messages']).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
    ]);
    const wireTool = (captured.body?.['tools'] as Array<{ function: { parameters: unknown } }>)[0]!;
    expect(wireTool.function.parameters).toMatchObject({ type: 'object' });
  });

  it('maps the response to text, parsed tool calls, and priced usage', async () => {
    const captured: Captured = {};
    const complete = makeLongCatComplete({
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

    const result = await drain(complete([{ role: 'user', content: 'go' }], []));

    expect(result.text).toBe('looking');
    expect(result.toolCalls).toEqual([
      { id: 't1', name: 'get_symbol', arguments: { name: 'pay' } },
    ]);
    expect(result.usage).toMatchObject({ tokensIn: 2, tokensOut: 1, costUsd: 2 });
  });

  it('enables thinking when reasoning is enabled, and maps tool + assistant messages', async () => {
    const captured: Captured = {};
    const complete = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'm',
      reasoning: { kind: 'enabled' },
      fetchImpl: fakeFetch(textResponse, captured),
    });
    const messages: DriverMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'x', arguments: { a: 1 } }] },
      { role: 'tool', toolCallId: 't1', content: 'ok' },
    ];

    await drain(complete(messages, []));

    expect(captured.body?.['thinking']).toEqual({ type: 'enabled' });
    const wireMessages = captured.body?.['messages'] as Array<Record<string, unknown>>;
    expect(wireMessages[0]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{"a":1}' } }],
    });
    expect(wireMessages[1]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'ok' });
  });

  it('disables thinking for the disabled reasoning kind', async () => {
    const captured: Captured = {};
    const complete = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'm',
      reasoning: { kind: 'disabled' },
      fetchImpl: fakeFetch(textResponse, captured),
    });

    await drain(complete([{ role: 'user', content: 'go' }], []));

    expect(captured.body?.['thinking']).toEqual({ type: 'disabled' });
  });

  it('sends no thinking field when reasoning is absent', async () => {
    const captured: Captured = {};
    const complete = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'm',
      fetchImpl: fakeFetch(textResponse, captured),
    });

    await drain(complete([{ role: 'user', content: 'go' }], []));

    expect(captured.body?.['thinking']).toBeUndefined();
  });

  it('captures reasoning_content as the completion reasoning, undefined when absent', async () => {
    const withReasoning = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'LongCat-2.0',
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
    const r1 = await drain(withReasoning([{ role: 'user', content: 'go' }], []));
    expect(r1.reasoning).toBe('because 2+2=4');
    expect(r1.text).toBe('the answer is 4');

    const noReasoning = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'LongCat-2.0',
      fetchImpl: fakeFetch(textResponse, {}),
    });
    const r2 = await drain(noReasoning([{ role: 'user', content: 'go' }], []));
    expect(r2.reasoning).toBeUndefined();
  });

  it('throws with the status on a non-ok response', async () => {
    const complete = makeLongCatComplete({
      apiKey: 'sk-1',
      model: 'm',
      fetchImpl: fakeFetch({}, {}, false, 429),
    });
    await expect(drain(complete([{ role: 'user', content: 'go' }], []))).rejects.toThrow('429');
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
        body: toSseBody(textResponse),
      };
    };
    const complete = makeLongCatComplete({ apiKey: 'sk-1', model: 'm', fetchImpl });
    const controller = new AbortController();

    await drain(complete([{ role: 'user', content: 'go' }], [], controller.signal));

    expect(seenInit?.signal).toBe(controller.signal);
  });

  it('streams content and reasoning deltas, returning the assembled result', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({}),
      // Every streaming chunk carries `usage: null` until the final one (the real
      // OpenAI-compatible shape — the regression a null-blind schema silently drops).
      body: sseBody(
        'data: {"choices":[{"delta":{"reasoning_content":"th"}}],"usage":null}\n\n',
        'data: {"choices":[{"delta":{"content":"Hel"}}],"usage":null}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}],"usage":null}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ),
    });
    const complete = makeLongCatComplete({
      apiKey: 'k',
      model: 'LongCat-2.0',
      fetchImpl,
      prices: {},
    });
    const deltas: CompletionDelta[] = [];
    const it = complete([{ role: 'user', content: 'hi' }], [], undefined);
    let step = await it.next();
    while (step.done !== true) {
      deltas.push(step.value);
      step = await it.next();
    }
    expect(deltas).toEqual([
      { kind: 'reasoning', text: 'th' },
      { kind: 'text', text: 'Hel' },
      { kind: 'text', text: 'lo' },
    ]);
    expect(step.value.text).toBe('Hello');
    expect(step.value.reasoning).toBe('th');
    expect(step.value.usage).toMatchObject({ tokensIn: 3, tokensOut: 2 });
  });

  it('reassembles a streamed tool call from argument fragments', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({}),
      body: sseBody(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"Read","arguments":"{\\"pa"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a\\"}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ),
    });
    const complete = makeLongCatComplete({ apiKey: 'k', model: 'm', fetchImpl, prices: {} });
    const it = complete([{ role: 'user', content: 'hi' }], [], undefined);
    let step = await it.next();
    while (step.done !== true) step = await it.next();
    expect(step.value.toolCalls).toEqual([{ id: 'c1', name: 'Read', arguments: { path: 'a' } }]);
  });

  // VERBATIM from a live LongCat-2.0 stream. LongCat sends `id: null` and `name: null` on
  // the argument-continuation fragments rather than omitting them — and Zod's `.optional()`
  // accepts `undefined`, NOT `null`, so a null-blind schema fails the whole chunk's parse
  // and the `safeParse` guard drops it. Only the first fragment (real id, real name, EMPTY
  // arguments) survives, so the call arrives NAMED but with EMPTY arguments, which the
  // governed tool then rejects as `invalid-args` ("expected string, received undefined").
  // The identical null-vs-undefined trap is already documented for `usage` in wire.ts.
  it('reassembles a tool call whose continuation fragments carry null id/name (live LongCat shape)', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({}),
      body: sseBody(
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","index":0,"type":"function","function":{"name":"Bash","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"id":null,"index":0,"type":"function","function":{"name":null,"arguments":"{\\"command\\": \\"ls -la"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"id":null,"index":0,"type":"function","function":{"name":null,"arguments":"\\"}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ),
    });
    const complete = makeLongCatComplete({ apiKey: 'k', model: 'm', fetchImpl, prices: {} });
    const it = complete([{ role: 'user', content: 'hi' }], [], undefined);
    let step = await it.next();
    while (step.done !== true) step = await it.next();
    expect(step.value.toolCalls).toEqual([
      { id: 'call_1', name: 'Bash', arguments: { command: 'ls -la' } },
    ]);
  });
});
