import { z, type ZodRawShape } from 'zod';
import { AttachmentCapabilityError, type Attachment, type ClaudeReasoning } from '@coa/shared';
import type { CompleteFn, DriverMessage, ToolDef } from '@coa/loop-driver';
import { streamChunkSchema, type WireUsage } from './wire.js';
import { parseSseChunks } from './sse.js';
import { toRuntimeUsage } from './pricing.js';
import type { PriceTable, ProviderSpec } from './provider-spec.js';

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

export interface CompleteConfig {
  apiKey: string;
  model: string;
  /** Override the spec's chat host (tests / self-hosted gateways). */
  baseUrl?: string;
  /** coa's faithful reasoning selection; the spec maps it to the provider's request fields. */
  reasoning?: ClaudeReasoning;
  /**
   * Whether `model` reports vision support (from the model-metadata catalog) — gates
   * whether an `image` attachment on a message is mapped onto the wire as a real
   * multimodal content block or rejected with a typed {@link AttachmentCapabilityError}.
   * Absent ⇒ `false` (never silently send an image to a model that can't take it).
   * A `text` attachment is unaffected — it always inlines into the message's content.
   */
  visionSupported?: boolean;
  /** The config-overridable price table (zero-floor); absent ⇒ everything costs 0. */
  prices?: PriceTable;
  /** Injectable transport (defaults to global `fetch`). */
  fetchImpl?: FetchLike;
}

/** Build the {@link CompleteFn} primitive for the loop driver over the provider's HTTP API. */
export function makeOpenAiCompatComplete(spec: ProviderSpec, config: CompleteConfig): CompleteFn {
  const baseUrl = config.baseUrl ?? spec.baseUrl;
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const prices = config.prices ?? {};

  // Streaming form: SSE-parse the round-trip, yield each content/reasoning delta as it
  // arrives, and RETURN the assembled settled result (deltas are delivery-only and are
  // never persisted; only the settled result is). The
  // driver maps each delta to a delivery-only frame; the settled result is what persists.
  const visionSupported = config.visionSupported ?? false;
  return async function* (messages, tools, signal) {
    const body = {
      model: config.model,
      messages: messages.map((message) =>
        toWireMessage(message, { visionSupported, modelId: config.model }),
      ),
      ...(tools.length > 0 ? { tools: tools.map(toWireTool) } : {}),
      ...spec.reasoningBody(config.reasoning),
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
      throw new Error(`${spec.id} chat/completions failed: ${res.status} ${await res.text()}`);
    }
    if (res.body == null) throw new Error(`${spec.id}: streaming response had no body`);

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
      usage: toRuntimeUsage(spec, usage, config.model, prices),
    };
  };
}

/** Fold every `text`-kind attachment into the plain-text content — always safe, no
 *  capability gate (requirement: a text file inlines unconditionally). */
function inlineTextAttachments(content: string, attachments: readonly Attachment[]): string {
  const blocks = attachments
    .filter((a): a is Extract<Attachment, { kind: 'text' }> => a.kind === 'text')
    .map((a) => `\n\n[attached file${a.name !== undefined ? `: ${a.name}` : ''}]\n${a.text}`);
  return blocks.length === 0 ? content : content + blocks.join('');
}

/** The OpenAI-compatible multimodal content-part shape for an `image` attachment
 *  (`content` becomes an array of parts instead of a plain string) — the real wire
 *  format every OpenAI-compatible vision-capable model accepts. */
function toImagePart(attachment: Extract<Attachment, { kind: 'image' }>): Record<string, unknown> {
  return {
    type: 'image_url',
    image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
  };
}

/**
 * Map a neutral driver message to the OpenAI-compatible wire message. A message
 * with no attachments maps byte-identically to before. An `image` attachment is
 * mapped onto a real multimodal content block ONLY when `capability.visionSupported`
 * — otherwise this throws {@link AttachmentCapabilityError} (a typed reject, never a
 * silent drop and never a wire-format crash the model would see as malformed input).
 */
function toWireMessage(
  message: DriverMessage,
  capability: { visionSupported: boolean; modelId: string },
): Record<string, unknown> {
  const attachments = message.attachments ?? [];
  const images = attachments.filter(
    (a): a is Extract<Attachment, { kind: 'image' }> => a.kind === 'image',
  );
  if (images.length > 0 && !capability.visionSupported) {
    throw new AttachmentCapabilityError('image', capability.modelId);
  }
  const content = inlineTextAttachments(message.content, attachments);

  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId ?? '', content };
  }
  if (message.role === 'assistant' && message.toolCalls !== undefined) {
    return {
      role: 'assistant',
      content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  if (images.length > 0) {
    return {
      role: message.role,
      content: [{ type: 'text', text: content }, ...images.map(toImagePart)],
    };
  }
  return { role: message.role, content };
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

/** Convert the governed tool's Zod raw shape the driver carries to JSON schema; degrade to a permissive object. */
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
