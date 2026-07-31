import type { ClaudeEffort, ModelDescriptor, ModelEntry } from '@coa/shared';

/**
 * The coa-owned default model catalog — hand-curated, versioned by us, enriched
 * (never defined) by the backend read. The Claude backend advertises aliases
 * only, so the authoritative "these work" set is ours (see the ADR added with
 * this feature). Seeds a provider's editable list on first touch and backs the
 * "add from defaults" picker.
 *
 * last-verified: 2026-07-18 (claude ids against a live Pro subscription).
 */

interface CatalogRow {
  id: string;
  label: string;
  /** Shipped caps — the assembler's lowest tier. Omitted ⇒ no reasoning control. */
  caps?: Pick<ModelDescriptor, 'supportsEffort' | 'supportedEffortLevels' | 'supportsAdaptiveThinking' | 'supportsThinking'>;
}

const FULL_EFFORT: Pick<ModelDescriptor, 'supportsEffort' | 'supportedEffortLevels'> = { supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as ClaudeEffort[] };

/** The pre-xhigh range: xhigh arrived with opus 4.7, so 4.6-era models stop at max. */
const PRE_XHIGH_EFFORT: Pick<ModelDescriptor, 'supportsEffort' | 'supportedEffortLevels'> = { supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'] as ClaudeEffort[] };

const CATALOG: Record<string, CatalogRow[]> = {
  claude: [
    { id: 'claude-fable-5', label: 'fable 5', caps: { ...FULL_EFFORT, supportsAdaptiveThinking: true } },
    { id: 'claude-opus-4-8', label: 'opus 4.8', caps: { ...FULL_EFFORT, supportsAdaptiveThinking: true } },
    { id: 'claude-sonnet-5', label: 'sonnet 5', caps: { ...FULL_EFFORT, supportsAdaptiveThinking: true } },
    { id: 'claude-haiku-4-5', label: 'haiku 4.5', caps: { supportsThinking: true } },
    { id: 'claude-opus-4-7', label: 'opus 4.7', caps: { ...FULL_EFFORT, supportsAdaptiveThinking: true } },
    { id: 'claude-sonnet-4-6', label: 'sonnet 4.6', caps: { ...PRE_XHIGH_EFFORT, supportsAdaptiveThinking: true } },
    { id: 'claude-opus-4-1', label: 'opus 4.1', caps: { supportsThinking: true } },
    { id: 'claude-sonnet-4-0', label: 'sonnet 4', caps: { supportsThinking: true } },
  ],
  // V4 ids: `deepseek-chat`/`deepseek-reasoner` are deprecated 2026-07-24 15:59 UTC and
  // error after it. Thinking is DeepSeek's default mode on both tiers, not a variant.
  deepseek: [
    { id: 'deepseek-v4-flash', label: 'deepseek v4 flash', caps: { supportsThinking: true } },
    { id: 'deepseek-v4-pro', label: 'deepseek v4 pro', caps: { supportsThinking: true } },
  ],
  // The id LongCat's own platform documents — and the one its price table keys, so a
  // mismatch here silently bills every LongCat turn at the zero floor.
  longcat: [{ id: 'LongCat-2.0', label: 'longcat 2.0', caps: { supportsThinking: true } }],
};

/** The default entries a provider's list seeds from (fresh copies every call). */
export function defaultCatalog(providerId: string): ModelEntry[] {
  return (CATALOG[providerId] ?? []).map((row) => ({ id: row.id, label: row.label, origin: 'default' }));
}

/** The shipped-caps descriptor for a catalog id — the assembler's lowest tier. */
export function catalogDescriptor(providerId: string, id: string): ModelDescriptor | undefined {
  const row = (CATALOG[providerId] ?? []).find((r) => r.id === id);
  if (row === undefined) return undefined;
  return { id: row.id, provider: providerId, displayName: row.label, ...(row.caps ?? {}) };
}
