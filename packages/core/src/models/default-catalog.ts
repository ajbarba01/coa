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

const CATALOG: Record<string, CatalogRow[]> = {
  claude: [
    { id: 'claude-fable-5', label: 'fable 5', caps: { ...FULL_EFFORT, supportsAdaptiveThinking: true } },
    { id: 'claude-opus-4-8', label: 'opus 4.8', caps: { ...FULL_EFFORT, supportsAdaptiveThinking: true } },
    { id: 'claude-sonnet-5', label: 'sonnet 5', caps: { ...FULL_EFFORT, supportsAdaptiveThinking: true } },
    { id: 'claude-haiku-4-5', label: 'haiku 4.5', caps: { supportsThinking: true } },
    { id: 'claude-opus-4-7', label: 'opus 4.7', caps: { ...FULL_EFFORT } },
    { id: 'claude-sonnet-4-6', label: 'sonnet 4.6', caps: { supportsThinking: true } },
    { id: 'claude-opus-4-1', label: 'opus 4.1', caps: { supportsThinking: true } },
    { id: 'claude-sonnet-4-0', label: 'sonnet 4', caps: { supportsThinking: true } },
    { id: 'claude-haiku-3-5', label: 'haiku 3.5' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'deepseek chat' },
    { id: 'deepseek-reasoner', label: 'deepseek reasoner', caps: { supportsThinking: true } },
  ],
  longcat: [
    { id: 'longcat-flash-chat', label: 'longcat flash chat' },
    { id: 'longcat-flash-thinking', label: 'longcat flash thinking', caps: { supportsThinking: true } },
  ],
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
