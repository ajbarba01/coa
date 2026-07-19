import { create } from 'zustand';
import { PROVIDERS, type ProviderModel } from './providers.js';

/**
 * MOCKUP SPINE for the "editable model list as SOT" design
 * (docs/superpowers/specs/2026-07-18-editable-model-list-sot-design.md). This prototypes the
 * shape of the real `ModelCatalogStore` + effective-list assembler so the Gate-0 mockup can be
 * clicked through in the running app; it is NOT the shipped store (that lands TDD'd, over
 * `~/.coa/models.yaml`). Everything here is renderer-only, seeded from the provider catalog.
 *
 * The one idea: the user's per-provider list is the SINGLE SOURCE OF TRUTH for every place a
 * model is chosen (the in-chat chip and the agent-config picker). The live fetch is demoted to
 * enrichment. Seeding is shape "B": a provider's list is lazily materialised from its default
 * catalog on first touch, so an untouched list renders identically to today.
 */

/** The effort ladder, low→max — the coa reasoning scale. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * A model entry's reasoning profile. `inherit` (the default) means "resolve caps from the live
 * fetch, then the shipped catalog defaults" — the everyday case. The others are explicit user
 * overrides: cap the effort ladder, a binary thinking toggle, an adaptive-thinking token
 * budget, or no reasoning control at all.
 */
export type ReasoningProfile =
  | { kind: 'inherit' }
  | { kind: 'none' }
  | { kind: 'effort'; max: Effort }
  | { kind: 'thinking' }
  | { kind: 'budget'; tokens: number };

/** One editable model in a provider's list. `origin` gates the remove-confirm: a `custom`
 *  model has no catalog to re-add from, so deleting it is the destructive path that asks
 *  first; a `default` is re-addable in two clicks, so it removes unconfirmed. */
export interface ModelEntry {
  id: string;
  /** Falls back to `id` in the picker when unset. */
  label?: string;
  hidden?: boolean;
  origin: 'default' | 'custom';
  /** Advanced; undefined ⇒ inherit (the same as `{ kind: 'inherit' }`). */
  reasoning?: ReasoningProfile;
}

/** The reasoning profile an entry effectively wears (undefined normalises to inherit). */
export function profileOf(entry: ModelEntry): ReasoningProfile {
  return entry.reasoning ?? { kind: 'inherit' };
}

/** The one-line summary a reasoning profile wears in the editor row. */
export function reasoningSummary(p: ReasoningProfile): string {
  switch (p.kind) {
    case 'inherit':
      return 'inherits';
    case 'none':
      return 'no reasoning';
    case 'effort':
      return `effort · up to ${p.max}`;
    case 'thinking':
      return 'thinking toggle';
    case 'budget':
      return `budget · ${p.tokens.toLocaleString()} tok`;
  }
}

/** The label an entry shows (its own label, else its id). */
export function entryLabel(entry: ModelEntry): string {
  return entry.label ?? entry.id;
}

/**
 * The DEFAULT CATALOG per provider — coa-owned, hand-curated (the Claude finding: the backend
 * advertises aliases only, so the authoritative "these work" set is ours, not the live fetch).
 * Seeded from `providers.ts` today's list, plus a few catalog-only entries so "add from
 * defaults" has something to offer after seeding. Each carries the reasoning caps the effective
 * list needs, so adding from defaults is zero-config.
 */
const CATALOG_EXTRAS: Record<string, ProviderModel[]> = {
  claude: [
    { id: 'claude-opus-4-5', label: 'opus 4.5' },
    { id: 'claude-haiku-3', label: 'haiku 3' },
  ],
  deepseek: [{ id: 'deepseek-coder', label: 'deepseek coder' }],
  gemini: [{ id: 'gemini-2.5-flash-8b', label: 'gemini 2.5 flash 8b' }],
};

function catalogFor(providerId: string): ModelEntry[] {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  const base = provider?.models ?? [];
  const extras = CATALOG_EXTRAS[providerId] ?? [];
  return [...base, ...extras].map((m) => ({ id: m.id, label: m.label, origin: 'default' as const }));
}

/** The `default`-origin ids each provider's catalog knows — used to decide what "add from
 *  defaults" can still offer. */
export function defaultCatalog(providerId: string): ModelEntry[] {
  return catalogFor(providerId);
}

interface MockModelsState {
  /** provider → the user's editable list. Absent ⇒ not yet materialised (seed on first touch). */
  lists: Record<string, ModelEntry[]>;

  /** The effective list for a provider, materialising the catalog on first read (seeding B). */
  listFor: (providerId: string) => ModelEntry[];
  seedIfNeeded: (providerId: string) => void;
  addFromDefaults: (providerId: string, ids: string[]) => void;
  addCustom: (providerId: string, entry: { id: string; label?: string; reasoning?: ReasoningProfile }) => void;
  editModel: (
    providerId: string,
    id: string,
    patch: { label?: string; reasoning?: ReasoningProfile },
  ) => void;
  setHidden: (providerId: string, id: string, hidden: boolean) => void;
  removeModel: (providerId: string, id: string) => void;
}

const materialise = (lists: Record<string, ModelEntry[]>, providerId: string): ModelEntry[] =>
  lists[providerId] ?? catalogFor(providerId);

export const useMockModels = create<MockModelsState>((set, get) => ({
  lists: {},

  listFor: (providerId) => materialise(get().lists, providerId),

  seedIfNeeded: (providerId) =>
    set((s) =>
      s.lists[providerId] !== undefined
        ? s
        : { lists: { ...s.lists, [providerId]: catalogFor(providerId) } },
    ),

  addFromDefaults: (providerId, ids) =>
    set((s) => {
      const list = materialise(s.lists, providerId);
      const have = new Set(list.map((m) => m.id));
      const additions = catalogFor(providerId).filter((m) => ids.includes(m.id) && !have.has(m.id));
      return { lists: { ...s.lists, [providerId]: [...list, ...additions] } };
    }),

  addCustom: (providerId, entry) =>
    set((s) => {
      const list = materialise(s.lists, providerId);
      if (list.some((m) => m.id === entry.id)) return s;
      const next: ModelEntry = { id: entry.id, origin: 'custom' };
      if (entry.label !== undefined && entry.label !== '') next.label = entry.label;
      if (entry.reasoning !== undefined) next.reasoning = entry.reasoning;
      return { lists: { ...s.lists, [providerId]: [...list, next] } };
    }),

  editModel: (providerId, id, patch) =>
    set((s) => {
      const list = materialise(s.lists, providerId);
      return {
        lists: {
          ...s.lists,
          [providerId]: list.map((m) => {
            if (m.id !== id) return m;
            const next: ModelEntry = { ...m };
            if (patch.label !== undefined) {
              if (patch.label === '') delete next.label;
              else next.label = patch.label;
            }
            if (patch.reasoning !== undefined) next.reasoning = patch.reasoning;
            return next;
          }),
        },
      };
    }),

  setHidden: (providerId, id, hidden) =>
    set((s) => {
      const list = materialise(s.lists, providerId);
      return {
        lists: {
          ...s.lists,
          [providerId]: list.map((m) => (m.id === id ? { ...m, hidden } : m)),
        },
      };
    }),

  removeModel: (providerId, id) =>
    set((s) => {
      const list = materialise(s.lists, providerId);
      return { lists: { ...s.lists, [providerId]: list.filter((m) => m.id !== id) } };
    }),
}));

/** The picker-visible ids across the added backends — the effective list the chat chip and the
 *  agent picker consume (hidden dropped). This is the SOT projection: editing a provider's list
 *  here changes what both pickers show. `added` scopes it to the providers actually on the auth
 *  surface; omit (or empty) to show every backend's catalog. */
export function visibleModelsForPickers(
  lists: Record<string, ModelEntry[]>,
  added?: string[],
): { id: string; label: string; provider: string }[] {
  const backends = PROVIDERS.filter((p) => p.group === 'backend').filter(
    (p) => added === undefined || added.length === 0 || added.includes(p.id),
  );
  return backends.flatMap((p) => {
    const list = lists[p.id] ?? catalogFor(p.id);
    return list
      .filter((m) => m.hidden !== true)
      .map((m) => ({ id: m.id, label: entryLabel(m), provider: p.id }));
  });
}
