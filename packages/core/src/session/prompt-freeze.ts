import { createHash } from 'node:crypto';
import type { CapabilityFrame, NeutralConfig } from '@coa/shared';

/**
 * M8 — prompt freezing (SPEC: caching is a prefix match; any byte change in the
 * prefix invalidates everything after it). A session compiles its system prompt
 * ONCE, at the first turn, and every later turn reuses that frozen compilation
 * verbatim — so the provider's prompt cache stays warm and the prompt never drifts
 * silently under the conversation. Recompiling is a deliberate, user-raised act
 * (the drift banner), not a per-turn side effect.
 *
 * The frozen compilation is the backend-neutral {@link NeutralConfig} plus the
 * {@link CapabilityFrame} it was built with (tools are part of the cached prefix
 * too, so they freeze together). `promptVersion` is a stable content hash of the
 * neutral config — the identity the resume stamp and drift check compare against.
 */
export interface FrozenCompilation {
  neutral: NeutralConfig;
  frame: CapabilityFrame;
  /** Stable content hash of {@link neutral} — bumped only on a deliberate recompile. */
  promptVersion: string;
}

/** Deterministic JSON (object keys sorted at every depth) so the hash is stable
 *  regardless of key insertion order — the same silent-invalidator discipline the
 *  cache itself needs. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/** The stable identity of a compiled prompt — two configs that render to the same
 *  bytes share a version; any material change produces a new one. */
export function promptVersionOf(neutral: NeutralConfig): string {
  return createHash('sha256').update(stableStringify(neutral)).digest('hex').slice(0, 16);
}
