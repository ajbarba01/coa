import { modelImageInputSupport, type CapabilitySupport, type ModelMetadata } from '@coa/shared';

/**
 * The pure selectors behind the composer's context ring, its attach control, and
 * the model picker's hover card — every number they show is derived HERE, from
 * the real inputs (the daemon's `usage` push, the metadata catalog's rows), so
 * the math is testable without rendering anything. Absent data stays absent:
 * nothing in this module invents a value the backend never reported.
 */

/**
 * The last settled turn's usage, as the daemon's `usage` push carries it.
 * `tokensIn` MUST be fresh (non-cached) input only — `cacheReadTokens` is additive,
 * never a subset of it. Every `RuntimeUsage` producer normalizes to this contract
 * at its own boundary (see packages/adapter-openai-compat/src/pricing.ts, which
 * subtracts the cache hit out of the OpenAI-wire `prompt_tokens` that otherwise
 * double-counts it) so `usedContextTokens` below can sum the three fields blind.
 */
export interface SessionUsage {
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens?: number | undefined;
}

/**
 * Context occupied after a settled turn: what the model was handed (fresh input
 * plus prompt-cache reads, which are context even though they bill differently)
 * plus what it wrote. An approximation on multi-round-trip turns (the pure-API
 * loop sums its round trips), which is why every surface rendering it wears `≈`.
 */
export function usedContextTokens(usage: SessionUsage): number {
  return usage.tokensIn + (usage.cacheReadTokens ?? 0) + usage.tokensOut;
}

/** The ring reuses the kit meter's earned-color vocabulary (the indicator law):
 *  ground until worth looking at, amber when attention is due, red near the edge. */
export type RingTone = 'quiet' | 'needs-you' | 'critical';

/** Context risk ramps late — most of a window is calm headroom. */
export const RING_WARN_AT = 0.7;
export const RING_CRIT_AT = 0.9;

/** Pure: the tone a context fraction earns. */
export function ringTone(fraction: number): RingTone {
  if (fraction >= RING_CRIT_AT) return 'critical';
  if (fraction >= RING_WARN_AT) return 'needs-you';
  return 'quiet';
}

export interface ContextRingInputs {
  /** The last settled turn's usage; absent ⇒ nothing measured yet this session. */
  usage?: SessionUsage | undefined;
  /** A live-typing estimate for the drafted message (≈ chars/4); 0 when empty. */
  draftTokens?: number;
  /** The active model's context window, from the metadata catalog; absent ⇒ unknown. */
  contextWindow?: number | undefined;
}

export type ContextRingVm =
  /** The catalog knows no window for this model — an honest unknown, never a
   *  fabricated denominator. `usedTokens` still carries what WAS measured. */
  | { kind: 'no-window'; usedTokens: number | undefined; draftTokens: number }
  | {
      kind: 'measured';
      /** Settled context tokens (0 before the first settle — see `measured`). */
      usedTokens: number;
      /** False ⇒ `usedTokens` is the pre-first-turn floor, not a reading. */
      measured: boolean;
      draftTokens: number;
      contextWindow: number;
      /** (used + draft) / window, clamped to [0, 1]. */
      fraction: number;
      /** The fraction as a whole percent, for copy. */
      percent: number;
      tone: RingTone;
    };

/** Pure: everything the context ring renders, from the real inputs. */
export function contextRingState(inputs: ContextRingInputs): ContextRingVm {
  const draftTokens = inputs.draftTokens ?? 0;
  const measured = inputs.usage !== undefined;
  const usedTokens = inputs.usage !== undefined ? usedContextTokens(inputs.usage) : undefined;
  const window = inputs.contextWindow;
  if (window === undefined || window <= 0) {
    return { kind: 'no-window', usedTokens, draftTokens };
  }
  const total = (usedTokens ?? 0) + draftTokens;
  const fraction = Math.min(1, Math.max(0, total / window));
  return {
    kind: 'measured',
    usedTokens: usedTokens ?? 0,
    measured,
    draftTokens,
    contextWindow: window,
    fraction,
    percent: Math.round(fraction * 100),
    tone: ringTone(fraction),
  };
}

/* ------------------------------------------------------------------ */
/* attach-control capability gating                                    */
/* ------------------------------------------------------------------ */

/** One attachment kind's control state: enabled, or disabled with the honest,
 *  tooltip-ready reason (never silently missing). */
export interface AttachKindState {
  enabled: boolean;
  reason?: string;
}

export interface AttachControlVm {
  image: AttachKindState;
  text: AttachKindState;
  /** The tri-state vision verdict driving `image` — surfaced so a caller (or a
   *  test) can tell "verified no" from "cannot verify". */
  imageSupport: CapabilitySupport;
}

/**
 * Mirror of the daemon's provider→attachment-seam fact (`supportsAttachments`
 * beside the adapter factory): the Claude SDK adapter has no seam an attachment
 * could ride yet (docs/adr/0036), so the claude default reports false and the
 * control explains itself instead of collecting files a send would then refuse.
 */
export function providerCarriesAttachments(provider: string | undefined): boolean {
  return (provider ?? 'claude') !== 'claude';
}

/**
 * Pure: the attach control's state matrix. `image` opens only on a VERIFIED
 * 'supported' — 'unsupported' and 'unknown' both disable it, each with its own
 * reason (a model the catalog can't vouch for must not read as confidently
 * non-vision, nor silently accept an image the adapter will reject). `text`
 * needs no model capability (every adapter inlines it) — only a backend seam.
 */
export function attachControlState(
  metadata: ModelMetadata | undefined,
  opts: { backendCarriesAttachments: boolean },
): AttachControlVm {
  const imageSupport = modelImageInputSupport(metadata);
  if (!opts.backendCarriesAttachments) {
    const reason = 'This backend cannot carry attachments yet';
    return {
      image: { enabled: false, reason },
      text: { enabled: false, reason },
      imageSupport,
    };
  }
  const image: AttachKindState =
    imageSupport === 'supported'
      ? { enabled: true }
      : imageSupport === 'unsupported'
        ? { enabled: false, reason: 'This model does not accept image input' }
        : { enabled: false, reason: 'Image support is unverified for this model' };
  return { image, text: { enabled: true }, imageSupport };
}

/* ------------------------------------------------------------------ */
/* metadata lookup + formatting (the hover card's vocabulary)          */
/* ------------------------------------------------------------------ */

/** The active model's catalog row. An unset provider resolves to claude — the
 *  same `?? 'claude'` default the daemon applies at every other seam. */
export function findModelMetadata(
  entries: readonly ModelMetadata[],
  provider: string | undefined,
  modelId: string | undefined,
): ModelMetadata | undefined {
  if (modelId === undefined) return undefined;
  const resolved = provider ?? 'claude';
  return entries.find((m) => m.provider === resolved && m.id === modelId);
}

/** Compact window/limit formatting: `8k`, `200k`, `1M`, `1.5M`. Sizes are round
 *  numbers by nature, so a clean multiple drops its decimals. */
export function formatTokenLimit(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(n);
}

/** Exact count formatting for the ring's hover readout: `41,230`. */
export function formatTokenCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** One per-million rate: `$3`, `$0.27`, `$15.50`. Trailing zeros trimmed —
 *  a price is a fact, not a column to align. */
export function formatPerMillion(rate: number): string {
  const rounded = Math.round(rate * 100) / 100;
  return `$${String(rounded)}`;
}

/** The pricing line, from whichever rates the catalog actually knows:
 *  `$3 in · $15 out /M tokens`. Undefined when it knows neither. */
export function formatPricing(pricing: ModelMetadata['pricing']): string | undefined {
  if (pricing === undefined) return undefined;
  const parts: string[] = [];
  if (pricing.inputPerMillion !== undefined)
    parts.push(`${formatPerMillion(pricing.inputPerMillion)} in`);
  if (pricing.outputPerMillion !== undefined)
    parts.push(`${formatPerMillion(pricing.outputPerMillion)} out`);
  if (parts.length === 0) return undefined;
  return `${parts.join(' · ')} /M tokens`;
}

/** The modality line: `text, image → text`. Undefined when the catalog has no
 *  modality row (absent renders as absent, never a guess). */
export function formatModalities(modalities: ModelMetadata['modalities']): string | undefined {
  if (modalities === undefined) return undefined;
  const input = modalities.input.join(', ');
  const output = modalities.output.join(', ');
  if (input === '' && output === '') return undefined;
  return `${input || '?'} → ${output || '?'}`;
}
