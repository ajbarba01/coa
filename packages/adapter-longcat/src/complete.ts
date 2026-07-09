import { z, type ZodRawShape } from 'zod';
import type { CompleteFn, DriverMessage, ToolDef } from '@coa/loop-driver';
import { streamChunkSchema, type WireUsage } from './wire.js';
import { parseSseChunks } from './sse.js';
import { toRuntimeUsage, type PriceTable } from './pricing.js';

/** LongCat's default OpenAI-compatible API host + model. */
export const DEFAULT_BASE_URL = 'https://api.longcat.chat/openai/v1';
export const DEFAULT_MODEL = 'LongCat-2.0';

/**
 * LongCat's reasoning surface is a thinking on/off toggle (`thinking: {type}`), not a
 * graded `reasoning_effort`. coa maps `off` -> disabled, any effort -> enabled, and
 * sends nothing when reasoning is absent (the model default).
 */
export type LongCatReasoning = { kind: 'enabled' } | { kind: 'disabled' };

/** A minimal `fetch` surface (injectable so `complete()` is unit-testable with no network). */
export type FetchLike = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  /** The streaming response body (SSE). `Response.body` is an async-iterable of bytes on Node 18+. */
  body?: AsyncIterable<Uint8Array> | null;
}>;

export interface LongCatCompleteConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  reasoning?: LongCatReasoning;
  /** The config-overridable price table; absent ⇒ the shipped LongCat-2.0 defaults are used upstream. */
  prices?: PriceTable;
  /** Injectable transport (defaults to global `fetch`). */
  fetchImpl?: FetchLike;
}

/** The request fields for a reasoning selection: thinking enabled/disabled, or nothing. */
function reasoningBody(reasoning: LongCatReasoning | undefined): Record<string, unknown> {
  if (reasoning === undefined) return {};
  return { thinking: { type: reasoning.kind === 'disabled' ? 'disabled' : 'enabled' } };
}

/** Build the {@link CompleteFn} primitive for the loop driver over LongCat's HTTP API. */
export function makeLongCatComplete(config: LongCatCompleteConfig): CompleteFn {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const prices = config.prices ?? {};

  // Streaming form (Piece B / G7): SSE-parse the round-trip, yield each content/reasoning
  // delta as it arrives, and RETURN the assembled settled result (docs/adr/0013). The
  // driver maps each delta to a delivery-only frame; the settled result is what persists.
  return async function* (messages, tools, signal) {
    const body = {
      model: config.model,
      messages: messages.map(toWireMessage),
      ...(tools.length > 0 ? { tools: tools.map(toWireTool) } : {}),
      ...reasoningBody(config.reasoning),
      stream: true,
      stream_options: { include_usage: true },
    };
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
    });
    if (!res.ok) {
      throw new Error(`longcat chat/completions failed: ${res.status} ${await res.text()}`);
    }
    if (res.body == null) throw new Error('longcat: streaming response had no body');

    let text = '';
    let reasoning = '';
    // Tool calls stream as fragments keyed by `index`: the id + name arrive first, the
    // JSON `arguments` string in pieces to concatenate, then parse once at the end.
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let usage: WireUsage | undefined;

    for await (const raw of parseSseChunks(res.body)) {
      const chunk = streamChunkSchema.safeParse(raw);
      if (!chunk.success) continue;
      const delta = chunk.data.choices[0]?.delta;
      if (delta?.content != null && delta.content !== '') {
        text += delta.content;
        yield { kind: 'text', text: delta.content };
      }
      if (delta?.reasoning_content != null && delta.reasoning_content !== '') {
        reasoning += delta.reasoning_content;
        yield { kind: 'reasoning', text: delta.reasoning_content };
      }
      for (const tc of delta?.tool_calls ?? []) {
        const acc = toolAcc.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id != null) acc.id = tc.id;
        if (tc.function?.name != null) acc.name = tc.function.name;
        if (tc.function?.arguments != null) acc.args += tc.function.arguments;
        toolAcc.set(tc.index, acc);
      }
      if (chunk.data.usage != null) usage = chunk.data.usage;
    }

    return {
      text,
      // Reasoning is display-only (the driver emits it as a thinking frame, never resends it).
      reasoning: reasoning !== '' ? reasoning : undefined,
      toolCalls: [...toolAcc.values()].map((t) => ({
        id: t.id,
        name: t.name,
        arguments: parseArguments(t.args),
      })),
      usage: toRuntimeUsage(usage, config.model, prices),
    };
  };
}

/** Map a neutral driver message to the OpenAI-compatible wire message. */
function toWireMessage(message: DriverMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
  }
  if (message.role === 'assistant' && message.toolCalls !== undefined) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

/** Map a governed tool to the OpenAI-compatible function tool (Zod raw shape → JSON schema). */
function toWireTool(tool: ToolDef): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchema(tool.parameters),
    },
  };
}

/** Convert the M6 Zod raw shape the driver carries to JSON schema; degrade to a permissive object. */
function toJsonSchema(parameters: unknown): unknown {
  try {
    return z.toJSONSchema(z.object(parameters as ZodRawShape));
  } catch {
    return { type: 'object', additionalProperties: true };
  }
}

/** Parse a tool call's JSON-string arguments; a malformed string degrades to empty args. */
function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
