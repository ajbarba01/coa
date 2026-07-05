import { z, type ZodRawShape } from 'zod';
import type { CompleteFn, DriverMessage, ToolDef } from '@coa/loop-driver';
import { chatCompletionResponseSchema } from './wire.js';
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
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
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

  return async (messages, tools) => {
    const body = {
      model: config.model,
      messages: messages.map(toWireMessage),
      ...(tools.length > 0 ? { tools: tools.map(toWireTool) } : {}),
      ...reasoningBody(config.reasoning),
    };
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`longcat chat/completions failed: ${res.status} ${await res.text()}`);
    }
    const parsed = chatCompletionResponseSchema.parse(await res.json());
    const choice = parsed.choices[0]!;
    return {
      text: choice.message.content ?? '',
      toolCalls: (choice.message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      })),
      usage: toRuntimeUsage(parsed.usage, config.model, prices),
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
