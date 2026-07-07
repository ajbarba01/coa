import { z, type ZodRawShape } from 'zod';
import type { CompleteFn, DriverMessage, ToolDef } from '@coa/loop-driver';
import { chatCompletionResponseSchema } from './wire.js';
import { toRuntimeUsage, type PriceTable } from './pricing.js';

/** DeepSeek's default API host + model (OpenAI-compatible chat/completions). */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
// `deepseek-chat` is universally available today and routes to v4-flash; it retires
// 2026-07-24, after which pick a v4 model explicitly (the console lists live models).
export const DEFAULT_MODEL = 'deepseek-chat';

/**
 * DeepSeek's real reasoning surface (per the official V4 docs): `reasoning_effort`
 * accepts only `high` and `max` (thinking on); non-thinking is requested with
 * `thinking: { type: 'disabled' }`. Thinking-high is the V4 default, so an absent
 * reasoning selection sends neither field.
 */
export type DeepSeekReasoning = { kind: 'effort'; effort: 'high' | 'max' } | { kind: 'disabled' };

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
}>;

export interface DeepSeekCompleteConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  reasoning?: DeepSeekReasoning;
  /** The config-overridable price table (zero-floor); absent ⇒ everything costs 0. */
  prices?: PriceTable;
  /** Injectable transport (defaults to global `fetch`). */
  fetchImpl?: FetchLike;
}

/** The request fields for a reasoning selection: `reasoning_effort`, or thinking disabled, or nothing. */
function reasoningBody(reasoning: DeepSeekReasoning | undefined): Record<string, unknown> {
  if (reasoning === undefined) return {};
  if (reasoning.kind === 'disabled') return { thinking: { type: 'disabled' } };
  return { reasoning_effort: reasoning.effort };
}

/** Build the {@link CompleteFn} primitive for the loop driver over DeepSeek's HTTP API. */
export function makeDeepSeekComplete(config: DeepSeekCompleteConfig): CompleteFn {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const prices = config.prices ?? {};

  return async (messages, tools, signal) => {
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
      ...(signal !== undefined ? { signal } : {}),
    });
    if (!res.ok) {
      throw new Error(`deepseek chat/completions failed: ${res.status} ${await res.text()}`);
    }
    const parsed = chatCompletionResponseSchema.parse(await res.json());
    const choice = parsed.choices[0]!;
    return {
      text: choice.message.content ?? '',
      // Reasoning is display-only (the driver emits it as a thinking frame, never resends it);
      // `?? undefined` maps DeepSeek's null (thinking off) to "no thinking".
      reasoning: choice.message.reasoning_content ?? undefined,
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
