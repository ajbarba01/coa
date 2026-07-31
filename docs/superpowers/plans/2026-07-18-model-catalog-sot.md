# Editable Model List as Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-provider model list user-editable, persisted in `~/.coa/models.yaml`, and the single source of truth feeding both the chat model chip and the agent-config picker — with the live backend fetch demoted to enrichment.

**Architecture:** A new `ModelCatalogStore` (core, mirrors `ConsoleStateStore`) + a coa-owned default catalog + a pure effective-list assembler. The daemon's existing `listModels` verb starts serving the assembled effective list; new editor verbs mirror the `buildAuthHandlers` pattern (every write returns the fresh catalog view). The renderer's `mockModels.ts` spine is replaced by a daemon-mirroring store (the `mockAuth.ts` pattern).

**Tech Stack:** TypeScript strict, Zod, yaml, Vitest, zustand (renderer), Electron IPC via the shared `METHODS` registry.

**Spec:** `docs/superpowers/specs/2026-07-18-editable-model-list-sot-design.md`

## Global Constraints

- TypeScript `strict`, no `any`; `exactOptionalPropertyTypes` is on — never assign `field: undefined`, rebuild objects by omission.
- Never-cage (SC-1/D85): empty list ⇒ picker falls back to backend default; removed/hidden ids still run on the wire; an untouched provider renders identically to today.
- Determinism-first: no model call anywhere in this plan; the live fetch stays cached in `ModelCache` and failures degrade to the catalog tier.
- `~/.coa/models.yaml` written 0600; reads drop-unknown / never-throw (`safeParse` → empty).
- Commits: subject-only Conventional Commits, no body/trailer, no module ids/phase numbers. Stage files by name.
- Tests run from repo root: `corepack pnpm exec vitest run <path>`. Typecheck: `corepack pnpm -r exec tsc --noEmit` (or the package-local `corepack pnpm --filter <pkg> exec tsc -p tsconfig.json --noEmit`).
- Docs same-commit rule: a task that adds files updates the relevant doc in the same commit only where a doc actually lists such content (REPO_LAYOUT is package-level — no update needed for new files inside existing packages).

---

### Task 1: Model-entry schemas in `@coa/shared`

**Files:**
- Create: `packages/shared/src/models-file.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './models-file.js';`)
- Test: `packages/shared/src/models-file.test.ts`

**Interfaces:**
- Consumes: `claudeEffortSchema`, `ClaudeEffort` from `packages/shared/src/config.ts`.
- Produces: `reasoningProfileSchema`/`ReasoningProfile` (discriminated union on `kind`: `inherit | none | effort{max: ClaudeEffort} | thinking | budget{tokens: number}`), `modelEntrySchema`/`ModelEntry` (`{id, label?, hidden?, origin: 'default'|'custom', reasoning?}`), `modelsFileSchema`/`ModelsFile` (`{version: 1, providers: Record<string, ModelEntry[]>}`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/models-file.test.ts
import { describe, expect, it } from 'vitest';
import { modelEntrySchema, modelsFileSchema } from './models-file.js';

describe('modelsFileSchema', () => {
  it('parses a full file and defaults origin to default', () => {
    const parsed = modelsFileSchema.parse({
      version: 1,
      providers: { claude: [{ id: 'claude-fable-5' }] },
    });
    expect(parsed.providers['claude']?.[0]).toEqual({ id: 'claude-fable-5', origin: 'default' });
  });

  it('defaults an empty object to version 1 with no providers', () => {
    expect(modelsFileSchema.parse({})).toEqual({ version: 1, providers: {} });
  });

  it('strips unknown fields on an entry (drop-unknown)', () => {
    const entry = modelEntrySchema.parse({ id: 'x', origin: 'custom', bogus: true });
    expect(entry).toEqual({ id: 'x', origin: 'custom' });
  });

  it('accepts every reasoning profile kind', () => {
    for (const reasoning of [
      { kind: 'inherit' },
      { kind: 'none' },
      { kind: 'effort', max: 'high' },
      { kind: 'thinking' },
      { kind: 'budget', tokens: 8000 },
    ]) {
      expect(modelEntrySchema.parse({ id: 'x', reasoning }).reasoning).toEqual(reasoning);
    }
  });

  it('rejects a budget without a positive integer token count', () => {
    expect(modelEntrySchema.safeParse({ id: 'x', reasoning: { kind: 'budget', tokens: 0 } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/shared/src/models-file.test.ts`
Expected: FAIL — cannot resolve `./models-file.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/models-file.ts
import { z } from 'zod';
import { claudeEffortSchema } from './config.js';

/**
 * M0 — the user-editable model list (`~/.coa/models.yaml`), the single source of
 * truth for every place a model is chosen. Entries are per provider (the map key,
 * so an entry never repeats it). `origin` gates the remove-confirm in the editor:
 * a `custom` entry has no catalog to re-add from. Reads are drop-unknown /
 * never-throw at the store; unknown keys on an entry are stripped here.
 */

/** A model entry's reasoning override. `inherit` (the default when absent) resolves
 *  caps from the live fetch, then the shipped catalog defaults. */
export const reasoningProfileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inherit') }),
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('effort'), max: claudeEffortSchema }),
  z.object({ kind: z.literal('thinking') }),
  z.object({ kind: z.literal('budget'), tokens: z.number().int().positive() }),
]);
export type ReasoningProfile = z.infer<typeof reasoningProfileSchema>;

/** One editable model in a provider's list. The id is what goes on the wire, as-is. */
export const modelEntrySchema = z.object({
  id: z.string().min(1),
  /** Picker label; falls back to `id` when unset. */
  label: z.string().optional(),
  /** Dropped from the pickers, kept in the list. */
  hidden: z.boolean().optional(),
  origin: z.enum(['default', 'custom']).default('default'),
  /** Advanced; absent ⇒ inherit. */
  reasoning: reasoningProfileSchema.optional(),
});
export type ModelEntry = z.infer<typeof modelEntrySchema>;

/** The on-disk shape of `~/.coa/models.yaml`, keyed by provider. */
export const modelsFileSchema = z.object({
  version: z.literal(1).default(1),
  providers: z.record(z.string(), z.array(modelEntrySchema)).default({}),
});
export type ModelsFile = z.infer<typeof modelsFileSchema>;
```

Add to `packages/shared/src/index.ts`, alongside the existing exports:

```ts
export * from './models-file.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run packages/shared/src/models-file.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/models-file.ts packages/shared/src/models-file.test.ts packages/shared/src/index.ts
git commit -m "feat: add the editable model-list schemas"
```

---

### Task 2: The coa-owned default catalog

**Files:**
- Create: `packages/core/src/models/default-catalog.ts`
- Test: `packages/core/src/models/default-catalog.test.ts`

**Interfaces:**
- Consumes: `ModelEntry`, `ModelDescriptor` from `@coa/shared`.
- Produces: `defaultCatalog(providerId: string): ModelEntry[]` (fresh copies, `origin:'default'`), `catalogDescriptor(providerId: string, id: string): ModelDescriptor | undefined` (the shipped-caps tier the assembler falls back to).

Catalog content: the Claude list is promoted verbatim from the renderer's `providers.ts` (hand-verified — the subscription honors explicit older ids, per the model-access spike). DeepSeek/LongCat get their shipped ids; their live `/models` fetch enriches at assembly time.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/models/default-catalog.test.ts
import { describe, expect, it } from 'vitest';
import { catalogDescriptor, defaultCatalog } from './default-catalog.js';

describe('defaultCatalog', () => {
  it('ships the hand-verified claude list, origin default', () => {
    const claude = defaultCatalog('claude');
    expect(claude.map((m) => m.id)).toContain('claude-fable-5');
    expect(claude.map((m) => m.id)).toContain('claude-sonnet-4-6');
    expect(claude.every((m) => m.origin === 'default')).toBe(true);
  });

  it('returns an empty list for an unknown provider (never throws)', () => {
    expect(defaultCatalog('nope')).toEqual([]);
  });

  it('returns fresh copies — mutating a result never corrupts the catalog', () => {
    const first = defaultCatalog('claude');
    first[0]!.hidden = true;
    expect(defaultCatalog('claude')[0]!.hidden).toBeUndefined();
  });

  it('catalogDescriptor carries claude effort caps for the shipped ids', () => {
    const d = catalogDescriptor('claude', 'claude-opus-4-8');
    expect(d?.supportsEffort).toBe(true);
    expect(d?.supportedEffortLevels).toContain('max');
  });

  it('catalogDescriptor is undefined off-catalog', () => {
    expect(catalogDescriptor('claude', 'made-up')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/core/src/models/default-catalog.test.ts`
Expected: FAIL — cannot resolve `./default-catalog.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/models/default-catalog.ts
import type { ModelDescriptor, ModelEntry } from '@coa/shared';

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

const FULL_EFFORT = { supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] } as const;

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run packages/core/src/models/default-catalog.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/models/default-catalog.ts packages/core/src/models/default-catalog.test.ts
git commit -m "feat: ship the coa-owned default model catalog"
```

---

### Task 3: `ModelCatalogStore` over `~/.coa/models.yaml`

**Files:**
- Create: `packages/core/src/models/model-catalog-store.ts`
- Test: `packages/core/src/models/model-catalog-store.test.ts`

**Interfaces:**
- Consumes: `modelsFileSchema`, `ModelEntry`, `ModelsFile`, `ReasoningProfile` from `@coa/shared`; `defaultCatalog` from `./default-catalog.js`.
- Produces: `class ModelCatalogStore { constructor(home: string); listFor(providerId): ModelEntry[]; addFromDefaults(providerId, ids: string[]): void; addCustom(providerId, entry: {id, label?, reasoning?}): void; edit(providerId, id, patch: {label?, reasoning?}): void; setHidden(providerId, id, hidden): void; remove(providerId, id): void }` and `modelsPath(home): string`.

Semantics locked here: **reads are pure** (`listFor` falls back to the catalog without writing); **writes materialise first** (seeding B — the first mutation persists the catalog list, then mutates it). An empty array is a legal persisted state, distinct from "never touched". An empty `patch.label` clears the label (falls back to id).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/models/model-catalog-store.test.ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultCatalog } from './default-catalog.js';
import { ModelCatalogStore, modelsPath } from './model-catalog-store.js';

let home: string;
let store: ModelCatalogStore;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-models-'));
  store = new ModelCatalogStore(home);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('ModelCatalogStore', () => {
  it('an untouched provider reads as its default catalog without writing the file', () => {
    expect(store.listFor('claude')).toEqual(defaultCatalog('claude'));
    expect(() => readFileSync(modelsPath(home))).toThrow(); // no file yet — strict-superset
  });

  it('the first write materialises the catalog, then mutates (seeding B)', () => {
    store.setHidden('claude', 'claude-haiku-3-5', true);
    const list = store.listFor('claude');
    expect(list.length).toBe(defaultCatalog('claude').length);
    expect(list.find((m) => m.id === 'claude-haiku-3-5')?.hidden).toBe(true);
    const onDisk = parse(readFileSync(modelsPath(home), 'utf8')) as { providers: Record<string, unknown[]> };
    expect(onDisk.providers['claude']?.length).toBe(list.length);
  });

  it('addFromDefaults adds only catalog ids not already present', () => {
    store.remove('claude', 'claude-opus-4-1');
    store.addFromDefaults('claude', ['claude-opus-4-1', 'claude-fable-5', 'not-in-catalog']);
    const ids = store.listFor('claude').map((m) => m.id);
    expect(ids).toContain('claude-opus-4-1');
    expect(ids.filter((id) => id === 'claude-fable-5').length).toBe(1);
    expect(ids).not.toContain('not-in-catalog');
  });

  it('addCustom appends origin custom and refuses a duplicate id', () => {
    store.addCustom('claude', { id: 'claude-opus-4-9', label: 'opus 4.9' });
    store.addCustom('claude', { id: 'claude-opus-4-9' });
    const matches = store.listFor('claude').filter((m) => m.id === 'claude-opus-4-9');
    expect(matches).toEqual([{ id: 'claude-opus-4-9', label: 'opus 4.9', origin: 'custom' }]);
  });

  it('edit patches label and reasoning; an empty label clears back to id', () => {
    store.edit('claude', 'claude-fable-5', { reasoning: { kind: 'effort', max: 'high' }, label: '' });
    const entry = store.listFor('claude').find((m) => m.id === 'claude-fable-5');
    expect(entry?.label).toBeUndefined();
    expect(entry?.reasoning).toEqual({ kind: 'effort', max: 'high' });
  });

  it('remove deletes the entry; removing every entry persists a legal empty list', () => {
    for (const m of store.listFor('claude')) store.remove('claude', m.id);
    expect(store.listFor('claude')).toEqual([]); // never re-seeds — empty is a state
  });

  it('a corrupt file reads as empty state, never throws', () => {
    store.setHidden('claude', 'claude-fable-5', true);
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(modelsPath(home), ':: not yaml ::');
    expect(store.listFor('claude')).toEqual(defaultCatalog('claude'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/core/src/models/model-catalog-store.test.ts`
Expected: FAIL — cannot resolve `./model-catalog-store.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/models/model-catalog-store.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { modelsFileSchema, type ModelEntry, type ModelsFile, type ReasoningProfile } from '@coa/shared';
import { defaultCatalog } from './default-catalog.js';

/** The user-global model-list path. `home` is injectable so tests run over a temp dir. */
export function modelsPath(home: string): string {
  return join(home, '.coa', 'models.yaml');
}

const EMPTY: ModelsFile = { version: 1, providers: {} };

/**
 * The editable per-provider model list — the source of truth for every place a
 * model is chosen. Reads are PURE: an untouched provider falls back to the
 * default catalog without writing (strict-superset — no file until the user
 * edits). Writes materialise first (seeding B): the first mutation persists the
 * catalog list, then mutates it, so an emptied list stays empty (a legal state,
 * distinct from never-touched). Drop-unknown / never-throw on read.
 */
export class ModelCatalogStore {
  readonly #home: string;
  constructor(home: string) {
    this.#home = home;
  }

  listFor(providerId: string): ModelEntry[] {
    return this.#read().providers[providerId] ?? defaultCatalog(providerId);
  }

  addFromDefaults(providerId: string, ids: string[]): void {
    this.#mutate(providerId, (list) => {
      const have = new Set(list.map((m) => m.id));
      const additions = defaultCatalog(providerId).filter((m) => ids.includes(m.id) && !have.has(m.id));
      return [...list, ...additions];
    });
  }

  addCustom(providerId: string, entry: { id: string; label?: string; reasoning?: ReasoningProfile }): void {
    this.#mutate(providerId, (list) => {
      if (list.some((m) => m.id === entry.id)) return list;
      const next: ModelEntry = { id: entry.id, origin: 'custom' };
      if (entry.label !== undefined && entry.label !== '') next.label = entry.label;
      if (entry.reasoning !== undefined) next.reasoning = entry.reasoning;
      return [...list, next];
    });
  }

  edit(providerId: string, id: string, patch: { label?: string; reasoning?: ReasoningProfile }): void {
    this.#mutate(providerId, (list) =>
      list.map((m) => {
        if (m.id !== id) return m;
        const next: ModelEntry = { ...m };
        if (patch.label !== undefined) {
          if (patch.label === '') delete next.label;
          else next.label = patch.label;
        }
        if (patch.reasoning !== undefined) {
          if (patch.reasoning.kind === 'inherit') delete next.reasoning;
          else next.reasoning = patch.reasoning;
        }
        return next;
      }),
    );
  }

  setHidden(providerId: string, id: string, hidden: boolean): void {
    this.#mutate(providerId, (list) =>
      list.map((m) => {
        if (m.id !== id) return m;
        const next: ModelEntry = { ...m };
        if (hidden) next.hidden = true;
        else delete next.hidden;
        return next;
      }),
    );
  }

  remove(providerId: string, id: string): void {
    this.#mutate(providerId, (list) => list.filter((m) => m.id !== id));
  }

  /** Materialise-then-mutate: the write path that implements seeding B. */
  #mutate(providerId: string, fn: (list: ModelEntry[]) => ModelEntry[]): void {
    const file = this.#read();
    const current = file.providers[providerId] ?? defaultCatalog(providerId);
    file.providers[providerId] = fn(current);
    this.#write(file);
  }

  #read(): ModelsFile {
    let raw: unknown;
    try {
      raw = parse(readFileSync(modelsPath(this.#home), 'utf8'));
    } catch {
      return structuredClone(EMPTY);
    }
    const parsed = modelsFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : structuredClone(EMPTY);
  }

  #write(file: ModelsFile): void {
    const path = modelsPath(this.#home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringify(file), { encoding: 'utf8', mode: 0o600 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run packages/core/src/models/model-catalog-store.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/models/model-catalog-store.ts packages/core/src/models/model-catalog-store.test.ts
git commit -m "feat: persist the editable model list in models.yaml"
```

---

### Task 4: The effective-list assembler

**Files:**
- Create: `packages/core/src/models/effective-models.ts`
- Test: `packages/core/src/models/effective-models.test.ts`

**Interfaces:**
- Consumes: `ModelEntry`, `ModelDescriptor`, `ReasoningProfile`, `claudeEffortSchema` from `@coa/shared`; `catalogDescriptor` from `./default-catalog.js`.
- Produces: `effectiveModels(providerId: string, entries: ModelEntry[], live: ModelDescriptor[]): ModelDescriptor[]` — pure; hidden entries dropped; per-field precedence user override → live fetch (by id) → shipped catalog → bare `{id, provider}`.

Reasoning-profile → descriptor mapping (the one table, pinned by tests):

| profile | descriptor caps |
| --- | --- |
| `inherit` / absent | the base tier's caps, untouched |
| `none` | no reasoning fields at all |
| `effort {max}` | `supportsEffort: true`, `supportedEffortLevels` = ladder from `low` up to `max` |
| `thinking` | `supportsThinking: true` only |
| `budget {tokens}` | `supportsAdaptiveThinking: true` only |

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/models/effective-models.test.ts
import { describe, expect, it } from 'vitest';
import type { ModelDescriptor, ModelEntry } from '@coa/shared';
import { effectiveModels } from './effective-models.js';

const entry = (id: string, extra: Partial<ModelEntry> = {}): ModelEntry => ({ id, origin: 'default', ...extra });

describe('effectiveModels', () => {
  it('hidden entries are dropped; order follows the user list', () => {
    const out = effectiveModels('claude', [entry('a'), entry('b', { hidden: true }), entry('c')], []);
    expect(out.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('an empty list assembles to an empty list (picker falls back to backend default)', () => {
    expect(effectiveModels('claude', [], [{ id: 'live-1' }])).toEqual([]);
  });

  it('live fetch enriches by id but never defines membership', () => {
    const live: ModelDescriptor[] = [
      { id: 'claude-x', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
      { id: 'not-in-list' },
    ];
    const out = effectiveModels('claude', [entry('claude-x')], live);
    expect(out).toEqual([
      { id: 'claude-x', provider: 'claude', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
    ]);
  });

  it('falls back to catalog caps when the live fetch lacks the id', () => {
    const out = effectiveModels('claude', [entry('claude-opus-4-8')], []);
    expect(out[0]?.supportsEffort).toBe(true);
    expect(out[0]?.displayName).toBe('opus 4.8');
  });

  it('an unknown hand-typed id degrades to a bare runnable descriptor (never-cage)', () => {
    expect(effectiveModels('claude', [entry('mystery', { origin: 'custom' })], [])).toEqual([
      { id: 'mystery', provider: 'claude' },
    ]);
  });

  it('the user label overrides every tier as displayName', () => {
    const live: ModelDescriptor[] = [{ id: 'claude-x', displayName: 'from live' }];
    const out = effectiveModels('claude', [entry('claude-x', { label: 'mine' })], live);
    expect(out[0]?.displayName).toBe('mine');
  });

  it('reasoning overrides replace the base caps per the mapping table', () => {
    const live: ModelDescriptor[] = [
      { id: 'x', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true },
    ];
    const cases: [ModelEntry['reasoning'], Partial<ModelDescriptor>][] = [
      [{ kind: 'none' }, {}],
      [{ kind: 'effort', max: 'high' }, { supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] }],
      [{ kind: 'thinking' }, { supportsThinking: true }],
      [{ kind: 'budget', tokens: 8000 }, { supportsAdaptiveThinking: true }],
    ];
    for (const [reasoning, caps] of cases) {
      const out = effectiveModels('claude', [entry('x', { reasoning })], live);
      expect(out[0]).toEqual({ id: 'x', provider: 'claude', ...caps });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/core/src/models/effective-models.test.ts`
Expected: FAIL — cannot resolve `./effective-models.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/models/effective-models.ts
import { claudeEffortSchema, type ModelDescriptor, type ModelEntry } from '@coa/shared';
import { catalogDescriptor } from './default-catalog.js';

/**
 * The pure SOT projection: the user's list decides membership + order; the live
 * fetch (matched by id) then the shipped catalog supply capabilities; a user
 * override (label, reasoning) outranks every tier. An id no tier knows still
 * assembles to a bare runnable descriptor — the backend is the real authority
 * (an invalid id errors live, never blocked).
 */

const LADDER = claudeEffortSchema.options;

/** The four reasoning-cap fields a profile override replaces wholesale. */
function strippedCaps(base: ModelDescriptor): ModelDescriptor {
  const { supportsEffort, supportedEffortLevels, supportsAdaptiveThinking, supportsThinking, ...rest } = base;
  return rest;
}

function applyReasoning(base: ModelDescriptor, entry: ModelEntry): ModelDescriptor {
  const profile = entry.reasoning;
  if (profile === undefined || profile.kind === 'inherit') return base;
  const bare = strippedCaps(base);
  switch (profile.kind) {
    case 'none':
      return bare;
    case 'effort':
      return {
        ...bare,
        supportsEffort: true,
        supportedEffortLevels: LADDER.slice(0, LADDER.indexOf(profile.max) + 1),
      };
    case 'thinking':
      return { ...bare, supportsThinking: true };
    case 'budget':
      return { ...bare, supportsAdaptiveThinking: true };
  }
}

export function effectiveModels(
  providerId: string,
  entries: ModelEntry[],
  live: ModelDescriptor[],
): ModelDescriptor[] {
  return entries
    .filter((entry) => entry.hidden !== true)
    .map((entry) => {
      const base: ModelDescriptor =
        live.find((d) => d.id === entry.id) ??
        catalogDescriptor(providerId, entry.id) ??
        { id: entry.id };
      const withProvider: ModelDescriptor = { ...base, provider: providerId };
      const withLabel: ModelDescriptor =
        entry.label !== undefined ? { ...withProvider, displayName: entry.label } : withProvider;
      return applyReasoning(withLabel, entry);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run packages/core/src/models/effective-models.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/models/effective-models.ts packages/core/src/models/effective-models.test.ts
git commit -m "feat: assemble the effective model list from the user list"
```

---

### Task 5: Model RPC verbs (`buildModelHandlers`) + core exports

**Files:**
- Create: `packages/core/src/rpc/model-handlers.ts`
- Modify: `packages/core/src/index.ts` (export the new modules)
- Test: `packages/core/src/rpc/model-handlers.test.ts`

**Interfaces:**
- Consumes: `ModelCatalogStore` (Task 3), `defaultCatalog` (Task 2), `rpcMethod`/`RpcHandlers` from `./router.js`, `reasoningProfileSchema` from `@coa/shared`.
- Produces: `buildModelHandlers(store: ModelCatalogStore, providers: readonly string[]): RpcHandlers` with verbs `modelCatalog` (read), `addModels {providerId, ids}`, `addCustomModel {providerId, id, label?, reasoning?}`, `editModel {providerId, id, label?, reasoning?}`, `removeModel {providerId, id}`, `setModelHidden {providerId, id, hidden}` — **every verb returns the same `ModelCatalogView`**: `{ lists: Record<string, ModelEntry[]>, catalog: Record<string, ModelEntry[]> }` over the given providers (the auth-handler pattern: write → fresh view). Also exports `MODEL_PROVIDERS = ['claude', 'deepseek', 'longcat'] as const`.

Note: the daemon's *effective* feed stays on the existing `listModels` verb (Task 6); these verbs serve the **editor**. The spec's `listModels`/`listDefaultCatalog` read pair is collapsed into the single `modelCatalog` view — one read, no drift between the two halves the editor always needs together.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/rpc/model-handlers.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultCatalog } from '../models/default-catalog.js';
import { ModelCatalogStore } from '../models/model-catalog-store.js';
import { MODEL_PROVIDERS, buildModelHandlers, type ModelCatalogView } from './model-handlers.js';

let home: string;
let handlers: ReturnType<typeof buildModelHandlers>;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-mh-'));
  handlers = buildModelHandlers(new ModelCatalogStore(home), MODEL_PROVIDERS);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const call = async (verb: string, params?: unknown): Promise<ModelCatalogView> =>
  (await handlers[verb]!.handle(params)) as ModelCatalogView;

describe('buildModelHandlers', () => {
  it('modelCatalog returns every provider list + its default catalog', async () => {
    const view = await call('modelCatalog');
    expect(view.lists['claude']).toEqual(defaultCatalog('claude'));
    expect(view.catalog['deepseek']?.map((m) => m.id)).toContain('deepseek-chat');
  });

  it('addCustomModel → the view carries the new entry; removeModel deletes it', async () => {
    const added = await call('addCustomModel', { providerId: 'claude', id: 'my-model', label: 'mine' });
    expect(added.lists['claude']?.find((m) => m.id === 'my-model')?.origin).toBe('custom');
    const removed = await call('removeModel', { providerId: 'claude', id: 'my-model' });
    expect(removed.lists['claude']?.some((m) => m.id === 'my-model')).toBe(false);
  });

  it('setModelHidden flips the flag; editModel patches reasoning', async () => {
    const hidden = await call('setModelHidden', { providerId: 'claude', id: 'claude-fable-5', hidden: true });
    expect(hidden.lists['claude']?.find((m) => m.id === 'claude-fable-5')?.hidden).toBe(true);
    const edited = await call('editModel', {
      providerId: 'claude', id: 'claude-fable-5', reasoning: { kind: 'effort', max: 'high' },
    });
    expect(edited.lists['claude']?.find((m) => m.id === 'claude-fable-5')?.reasoning)
      .toEqual({ kind: 'effort', max: 'high' });
  });

  it('addModels re-adds a removed default from the catalog', async () => {
    await call('removeModel', { providerId: 'claude', id: 'claude-opus-4-1' });
    const view = await call('addModels', { providerId: 'claude', ids: ['claude-opus-4-1'] });
    expect(view.lists['claude']?.some((m) => m.id === 'claude-opus-4-1')).toBe(true);
  });

  it('rejects malformed params (M0-validated at the edge)', async () => {
    await expect(call('addCustomModel', { providerId: 'claude' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/core/src/rpc/model-handlers.test.ts`
Expected: FAIL — cannot resolve `./model-handlers.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/rpc/model-handlers.ts
import { reasoningProfileSchema, type ModelEntry } from '@coa/shared';
import { z } from 'zod';
import { defaultCatalog } from '../models/default-catalog.js';
import type { ModelCatalogStore } from '../models/model-catalog-store.js';
import { rpcMethod, type RpcHandlers } from './router.js';

/**
 * The model-catalog verbs — the GUI editor's twin of the auth verbs, over the
 * models.yaml store. Every write returns the fresh view (the auth pattern), so
 * the renderer only ever mirrors what the daemon last said. The EFFECTIVE feed
 * (`listModels`) is separate: these verbs edit the SOT, that verb serves its
 * projection.
 */

/** The backends whose model lists are editable. */
export const MODEL_PROVIDERS = ['claude', 'deepseek', 'longcat'] as const;

export interface ModelCatalogView {
  /** provider → the user's list (materialised or catalog-fallback). */
  lists: Record<string, ModelEntry[]>;
  /** provider → the full default catalog ("add from defaults" offers catalog − list). */
  catalog: Record<string, ModelEntry[]>;
}

const noParams = z.unknown().optional();
const addParams = z.object({ providerId: z.string().min(1), ids: z.array(z.string().min(1)) });
const customParams = z.object({
  providerId: z.string().min(1),
  id: z.string().min(1),
  label: z.string().optional(),
  reasoning: reasoningProfileSchema.optional(),
});
const editParams = z.object({
  providerId: z.string().min(1),
  id: z.string().min(1),
  label: z.string().optional(),
  reasoning: reasoningProfileSchema.optional(),
});
const idParams = z.object({ providerId: z.string().min(1), id: z.string().min(1) });
const hiddenParams = z.object({ providerId: z.string().min(1), id: z.string().min(1), hidden: z.boolean() });

export function buildModelHandlers(store: ModelCatalogStore, providers: readonly string[]): RpcHandlers {
  const view = (): ModelCatalogView => {
    const lists: Record<string, ModelEntry[]> = {};
    const catalog: Record<string, ModelEntry[]> = {};
    for (const p of providers) {
      lists[p] = store.listFor(p);
      catalog[p] = defaultCatalog(p);
    }
    return { lists, catalog };
  };

  return {
    modelCatalog: rpcMethod(noParams, () => view()),
    addModels: rpcMethod(addParams, (p) => {
      store.addFromDefaults(p.providerId, p.ids);
      return view();
    }),
    addCustomModel: rpcMethod(customParams, (p) => {
      store.addCustom(p.providerId, {
        id: p.id,
        ...(p.label !== undefined ? { label: p.label } : {}),
        ...(p.reasoning !== undefined ? { reasoning: p.reasoning } : {}),
      });
      return view();
    }),
    editModel: rpcMethod(editParams, (p) => {
      store.edit(p.providerId, p.id, {
        ...(p.label !== undefined ? { label: p.label } : {}),
        ...(p.reasoning !== undefined ? { reasoning: p.reasoning } : {}),
      });
      return view();
    }),
    removeModel: rpcMethod(idParams, (p) => {
      store.remove(p.providerId, p.id);
      return view();
    }),
    setModelHidden: rpcMethod(hiddenParams, (p) => {
      store.setHidden(p.providerId, p.id, p.hidden);
      return view();
    }),
  };
}
```

Add to `packages/core/src/index.ts` next to the existing rpc/store exports (match the file's existing export style):

```ts
export { ModelCatalogStore, modelsPath } from './models/model-catalog-store.js';
export { defaultCatalog, catalogDescriptor } from './models/default-catalog.js';
export { effectiveModels } from './models/effective-models.js';
export { buildModelHandlers, MODEL_PROVIDERS, type ModelCatalogView } from './rpc/model-handlers.js';
```

- [ ] **Step 4: Run tests + package typecheck**

Run: `corepack pnpm exec vitest run packages/core/src/rpc/model-handlers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rpc/model-handlers.ts packages/core/src/rpc/model-handlers.test.ts packages/core/src/index.ts
git commit -m "feat: add the model-catalog rpc verbs"
```

---

### Task 6: Daemon wiring — `listModels` serves the effective list

**Files:**
- Modify: `apps/cli/src/cli.ts` (`startDaemon` + `listMergedModels`)
- Test: `apps/cli/src/cli.test.ts` (extend the existing suite — read it first and follow its harness)

**Interfaces:**
- Consumes: `ModelCatalogStore`, `effectiveModels`, `buildModelHandlers`, `MODEL_PROVIDERS` from `@coa/core`; the existing `ModelCache`, `ModelCacheAccount`, `modelAccounts()` machinery in `cli.ts`.
- Produces: `listEffectiveModels(catalog: ModelCatalogStore, models: ModelCache, accounts: ModelCacheAccount[], logErr?): Promise<ModelDescriptor[]>` (exported for tests); the daemon registers `...buildModelHandlers(catalog, MODEL_PROVIDERS)` and points `listModels` at `listEffectiveModels`.

- [ ] **Step 1: Read the existing harness, then write the failing test**

Read `apps/cli/src/cli.test.ts` to see how `listMergedModels` is currently tested (fake `ModelCache` etc.) and add, in the same style:

```ts
// added to apps/cli/src/cli.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelCatalogStore } from '@coa/core';
import { listEffectiveModels } from './cli.js';

describe('listEffectiveModels', () => {
  let home: string;
  beforeEach(() => (home = mkdtempSync(join(tmpdir(), 'coa-eff-'))));
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('serves the user list enriched by the live fetch, per provider', async () => {
    const store = new ModelCatalogStore(home);
    store.setHidden('claude', 'claude-haiku-3-5', true);
    const cache = {
      list: vi.fn().mockResolvedValue([{ id: 'claude-fable-5', supportsEffort: true }]),
    } as unknown as ModelCache;
    const out = await listEffectiveModels(store, cache, [{ label: 'a', provider: 'claude' }]);
    expect(out.some((m) => m.id === 'claude-haiku-3-5')).toBe(false); // hidden dropped
    expect(out.find((m) => m.id === 'claude-fable-5')?.supportsEffort).toBe(true); // enriched
    expect(out.find((m) => m.id === 'claude-sonnet-4-6')).toBeDefined(); // catalog id not in live fetch still served
  });

  it('a failed live fetch degrades to the catalog tier, never empty', async () => {
    const store = new ModelCatalogStore(home);
    const cache = { list: vi.fn().mockRejectedValue(new Error('down')) } as unknown as ModelCache;
    const out = await listEffectiveModels(store, cache, [{ label: 'a', provider: 'claude' }], () => {});
    expect(out.length).toBeGreaterThan(0);
  });

  it('an account provider with an emptied list contributes nothing (backend default)', async () => {
    const store = new ModelCatalogStore(home);
    for (const m of store.listFor('claude')) store.remove('claude', m.id);
    const cache = { list: vi.fn().mockResolvedValue([{ id: 'live' }]) } as unknown as ModelCache;
    const out = await listEffectiveModels(store, cache, [{ label: 'a', provider: 'claude' }]);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run apps/cli/src/cli.test.ts`
Expected: FAIL — `listEffectiveModels` is not exported.

- [ ] **Step 3: Implement**

In `apps/cli/src/cli.ts`, next to `listMergedModels` (which stays — it is the enrichment fetch):

```ts
import { ModelCatalogStore, MODEL_PROVIDERS, buildModelHandlers, effectiveModels } from '@coa/core';

/**
 * The SOT projection `listModels` now serves: the user's per-provider list
 * (models.yaml, catalog-seeded), enriched by that provider's live fetch. The
 * fetch is demoted to enrichment — it can fail (degrading to shipped caps)
 * without emptying the list; an emptied list is served empty (the picker falls
 * back to the backend default — never-cage).
 */
export async function listEffectiveModels(
  catalog: ModelCatalogStore,
  models: ModelCache,
  accounts: ModelCacheAccount[],
  logErr: (line: string) => void = (line) => console.error(line),
): Promise<ModelDescriptor[]> {
  // One live list per provider (an account pins the fetch; extra accounts on the
  // same provider add nothing to the SOT projection).
  const byProvider = new Map<string, ModelCacheAccount>();
  for (const account of accounts) byProvider.set(account.provider ?? 'claude', account);
  const lists = await Promise.all(
    [...byProvider.entries()].map(async ([provider, account]) => {
      const live = await models.list(account).catch((error: unknown): ModelDescriptor[] => {
        const message = error instanceof Error ? error.message : String(error);
        logErr(`listModels: ${account.label} (${provider}) failed: ${message}`);
        return [];
      });
      return effectiveModels(provider, catalog.listFor(provider), live);
    }),
  );
  return lists.flat();
}
```

In `startDaemon`, before `bindDaemon`:

```ts
const modelCatalog = new ModelCatalogStore(homedir());
```

and in the handler spread passed to `bindDaemon`, replace the `listModels` line and add the editor verbs:

```ts
    ...buildModelHandlers(modelCatalog, MODEL_PROVIDERS),
    // The SOT projection: the user's editable list, enriched (never defined) by
    // each provider's live fetch — both pickers read this one feed.
    listModels: { handle: () => listEffectiveModels(modelCatalog, models, modelAccounts(), options.err) },
```

(`homedir` is already imported in the daemon composition path — add `import { homedir } from 'node:os';` to `cli.ts` if not present.)

- [ ] **Step 4: Run the cli suite + typecheck**

Run: `corepack pnpm exec vitest run apps/cli/src/cli.test.ts` — Expected: PASS (existing + 3 new).
Run: `corepack pnpm --filter @coa/cli exec tsc -p tsconfig.json --noEmit` (use the package's real name from `apps/cli/package.json`) — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/cli.ts apps/cli/src/cli.test.ts
git commit -m "feat: serve the effective model list from the daemon"
```

---

### Task 7: Desktop IPC — the verbs cross the bridge

**Files:**
- Modify: `apps/desktop/src/shared/methods.ts` (MethodName union + `METHODS` entries)
- Modify: `apps/desktop/src/main/index.ts` (proxy cases)
- Modify: `apps/desktop/src/preload/api.d.ts` (bridge types)
- Modify: `packages/console-viewmodel/src/reads.ts` (edge schemas)
- Test: `apps/desktop/src/shared/methods.test.ts` if one exists (read the dir); otherwise the compile + the Task 8 store tests cover this task.

**Interfaces:**
- Consumes: `ModelCatalogView` shape from Task 5 (re-declared as an edge schema — the renderer cannot import `@coa/core`).
- Produces: renderer-callable `window.coa.modelCatalog() / addModels(p) / addCustomModel(p) / editModel(p) / removeModel(p) / setModelHidden(p)`, each `Promise<ModelCatalogView>`; `ModelCatalogViewSchema`, `ModelEntrySchema`, `ReasoningProfileSchema` exported from `@coa/console-viewmodel`.

- [ ] **Step 1: Edge schemas in `packages/console-viewmodel/src/reads.ts`**

Append (mirroring the file's existing edge-schema style):

```ts
/** A model entry as the editor needs it — mirrors the M0 shape; the renderer
 *  cannot import `@coa/shared`'s server modules, so the edge schema lives here. */
export const ReasoningProfileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inherit') }),
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('effort'), max: z.enum(['low', 'medium', 'high', 'xhigh', 'max']) }),
  z.object({ kind: z.literal('thinking') }),
  z.object({ kind: z.literal('budget'), tokens: z.number().int().positive() }),
]);
export type ReasoningProfile = z.infer<typeof ReasoningProfileSchema>;

export const ModelEntrySchema = z
  .object({
    id: z.string(),
    label: z.string().optional(),
    hidden: z.boolean().optional(),
    origin: z.enum(['default', 'custom']),
    reasoning: ReasoningProfileSchema.optional(),
  })
  .strip();
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ModelCatalogViewSchema = z
  .object({
    lists: z.record(z.string(), z.array(ModelEntrySchema)),
    catalog: z.record(z.string(), z.array(ModelEntrySchema)),
  })
  .strip();
export type ModelCatalogView = z.infer<typeof ModelCatalogViewSchema>;
```

(If `reads.ts` already imports `z`, nothing more; check the package's `index.ts` re-exports `reads.ts` — it does for the existing schemas.)

- [ ] **Step 2: `methods.ts` — union + registry**

Add to the `MethodName` union after `'listModels'`:

```ts
  | 'modelCatalog'
  | 'addModels'
  | 'addCustomModel'
  | 'editModel'
  | 'removeModel'
  | 'setModelHidden'
```

Import `ModelCatalogViewSchema` and `ReasoningProfileSchema` from `@coa/console-viewmodel` at the top (alongside the existing `AuthViewSchema` import), then add to `METHODS` after the `listModels` entry:

```ts
  modelCatalog: { result: ModelCatalogViewSchema },
  addModels: {
    params: z.object({ providerId: z.string(), ids: z.array(z.string()) }),
    result: ModelCatalogViewSchema,
  },
  addCustomModel: {
    params: z.object({
      providerId: z.string(),
      id: z.string(),
      label: z.string().optional(),
      reasoning: ReasoningProfileSchema.optional(),
    }),
    result: ModelCatalogViewSchema,
  },
  editModel: {
    params: z.object({
      providerId: z.string(),
      id: z.string(),
      label: z.string().optional(),
      reasoning: ReasoningProfileSchema.optional(),
    }),
    result: ModelCatalogViewSchema,
  },
  removeModel: { params: z.object({ providerId: z.string(), id: z.string() }), result: ModelCatalogViewSchema },
  setModelHidden: {
    params: z.object({ providerId: z.string(), id: z.string(), hidden: z.boolean() }),
    result: ModelCatalogViewSchema,
  },
```

- [ ] **Step 3: `main/index.ts` — proxy cases**

In the method switch, after the `listModels` case:

```ts
    case 'modelCatalog':
      return proxyDaemon('modelCatalog');
    case 'addModels':
      return proxyDaemon('addModels', params);
    case 'addCustomModel':
      return proxyDaemon('addCustomModel', params);
    case 'editModel':
      return proxyDaemon('editModel', params);
    case 'removeModel':
      return proxyDaemon('removeModel', params);
    case 'setModelHidden':
      return proxyDaemon('setModelHidden', params);
```

- [ ] **Step 4: `preload/api.d.ts` — bridge types**

Next to `listModels()` (import the types from `@coa/console-viewmodel` the way the file imports its other types):

```ts
      modelCatalog(): Promise<ModelCatalogView>;
      addModels(params: { providerId: string; ids: string[] }): Promise<ModelCatalogView>;
      addCustomModel(params: {
        providerId: string;
        id: string;
        label?: string;
        reasoning?: ReasoningProfile;
      }): Promise<ModelCatalogView>;
      editModel(params: {
        providerId: string;
        id: string;
        label?: string;
        reasoning?: ReasoningProfile;
      }): Promise<ModelCatalogView>;
      removeModel(params: { providerId: string; id: string }): Promise<ModelCatalogView>;
      setModelHidden(params: { providerId: string; id: string; hidden: boolean }): Promise<ModelCatalogView>;
```

(The preload `index.ts` auto-generates one method per `METHODS` key — no change there.)

- [ ] **Step 5: Typecheck + run the desktop suites touching methods**

Run: `corepack pnpm --filter coa-desktop exec tsc -p tsconfig.json --noEmit` (use the real package name from `apps/desktop/package.json`) — Expected: clean.
Run: `corepack pnpm exec vitest run apps/desktop/src` — Expected: PASS (nothing regressed).

- [ ] **Step 6: Commit**

```bash
git add packages/console-viewmodel/src/reads.ts apps/desktop/src/shared/methods.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/api.d.ts
git commit -m "feat: bridge the model-catalog verbs across the ipc boundary"
```

---

### Task 8: Renderer — `modelsStore` mirrors the daemon; the mock spine retires

**Files:**
- Create: `apps/desktop/src/renderer/panels/modelsStore.ts`
- Delete: `apps/desktop/src/renderer/panels/mockModels.ts` (Task 9 rewires its consumers)
- Modify: `apps/desktop/src/renderer/console.ts` (rpc wrappers + a `refreshModels` re-export)
- Test: `apps/desktop/src/renderer/panels/modelsStore.test.ts`

**Interfaces:**
- Consumes: `window.coa` bridge methods (Task 7), `ModelCatalogView`/`ModelEntry`/`ReasoningProfile` from `@coa/console-viewmodel`.
- Produces: a zustand store `useModels` with state `{ lists: Record<string, ModelEntry[]>, catalog: Record<string, ModelEntry[]> }` and actions `hydrate() / addFromDefaults(providerId, ids) / addCustom(providerId, entry) / editModel(providerId, id, patch) / setHidden(providerId, id, hidden) / removeModel(providerId, id)` — every action calls its RPC, reprojects the returned view, then fires the injected `onModelsChanged` (wired to `console.ts`'s `loadModels`) so the chip/agent-picker feed refreshes in the same breath. Also pure helpers carried over from the mock: `entryLabel(entry)`, `profileOf(entry)`, `reasoningSummary(profile)`, `EFFORTS`, `Effort`.

- [ ] **Step 1: `console.ts` rpc wrappers**

In `apps/desktop/src/renderer/console.ts`, next to the existing `rpcAuthView` block add (and export `loadModels` trigger — read the file: `loadModels` is a closure inside the controller; expose a module-level `notifyModelsChanged` callback registered by the controller, following how the file already exposes `rpcAuthView` for `mockAuth`):

```ts
export const rpcModelCatalog = (): Promise<ModelCatalogView> => window.coa.modelCatalog();
export const rpcAddModels = (p: { providerId: string; ids: string[] }): Promise<ModelCatalogView> =>
  window.coa.addModels(p);
export const rpcAddCustomModel = (p: {
  providerId: string; id: string; label?: string; reasoning?: ReasoningProfile;
}): Promise<ModelCatalogView> => window.coa.addCustomModel(p);
export const rpcEditModel = (p: {
  providerId: string; id: string; label?: string; reasoning?: ReasoningProfile;
}): Promise<ModelCatalogView> => window.coa.editModel(p);
export const rpcRemoveModel = (p: { providerId: string; id: string }): Promise<ModelCatalogView> =>
  window.coa.removeModel(p);
export const rpcSetModelHidden = (p: { providerId: string; id: string; hidden: boolean }): Promise<ModelCatalogView> =>
  window.coa.setModelHidden(p);

/** The models-changed hook: the controller registers its `loadModels` here so a
 *  catalog edit refreshes the chip/agent-picker feed in the same breath. */
let modelsChanged: () => Promise<void> = () => Promise.resolve();
export const onModelsChanged = (fn: () => Promise<void>): void => { modelsChanged = fn; };
export const notifyModelsChanged = (): Promise<void> => modelsChanged();
```

Inside the controller where `loadModels` is defined, register it: `onModelsChanged(loadModels);` (place it next to where the other one-time wiring happens, e.g. beside the `bootLoads` setup).

- [ ] **Step 2: Write the failing store test**

```ts
// apps/desktop/src/renderer/panels/modelsStore.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const view = {
  lists: { claude: [{ id: 'a', origin: 'default' as const }] },
  catalog: { claude: [{ id: 'a', origin: 'default' as const }, { id: 'b', origin: 'default' as const }] },
};
const rpc = {
  rpcModelCatalog: vi.fn().mockResolvedValue(view),
  rpcAddModels: vi.fn().mockResolvedValue(view),
  rpcAddCustomModel: vi.fn().mockResolvedValue(view),
  rpcEditModel: vi.fn().mockResolvedValue(view),
  rpcRemoveModel: vi.fn().mockResolvedValue(view),
  rpcSetModelHidden: vi.fn().mockResolvedValue(view),
  notifyModelsChanged: vi.fn().mockResolvedValue(undefined),
  onModelsChanged: vi.fn(),
};
vi.mock('../console.js', () => rpc);

import { offerable, useModels } from './modelsStore.js';

describe('useModels', () => {
  beforeEach(() => {
    useModels.setState({ lists: {}, catalog: {} });
    vi.clearAllMocks();
  });

  it('hydrate reprojects the daemon view', async () => {
    await useModels.getState().hydrate();
    expect(useModels.getState().lists['claude']?.[0]?.id).toBe('a');
  });

  it('a write reprojects the returned view and refreshes the picker feed', async () => {
    await useModels.getState().setHidden('claude', 'a', true);
    expect(rpc.rpcSetModelHidden).toHaveBeenCalledWith({ providerId: 'claude', id: 'a', hidden: true });
    expect(useModels.getState().catalog['claude']?.length).toBe(2);
    expect(rpc.notifyModelsChanged).toHaveBeenCalled();
  });

  it('offerable = catalog minus the list', () => {
    expect(offerable(view.catalog['claude']!, view.lists['claude']!).map((m) => m.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/panels/modelsStore.test.ts`
Expected: FAIL — cannot resolve `./modelsStore.js`.

- [ ] **Step 4: Implement the store**

```ts
// apps/desktop/src/renderer/panels/modelsStore.ts
import { create } from 'zustand';
import type { ModelCatalogView, ModelEntry, ReasoningProfile } from '@coa/console-viewmodel';
import {
  notifyModelsChanged,
  rpcAddCustomModel,
  rpcAddModels,
  rpcEditModel,
  rpcModelCatalog,
  rpcRemoveModel,
  rpcSetModelHidden,
} from '../console.js';

/**
 * The model editor's data, LIVE from the daemon (the mockAuth pattern): hydrate
 * reads `modelCatalog`; every write calls its RPC verb and reprojects the
 * returned view — the store never computes lists itself. After a write it also
 * pokes the controller's `loadModels`, because the effective picker feed
 * (`state.data.models`) is a projection of what was just edited.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function profileOf(entry: ModelEntry): ReasoningProfile {
  return entry.reasoning ?? { kind: 'inherit' };
}

export function entryLabel(entry: ModelEntry): string {
  return entry.label ?? entry.id;
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

/** What "add from defaults" can still offer: the catalog minus the current list. */
export function offerable(catalog: ModelEntry[], list: ModelEntry[]): ModelEntry[] {
  const have = new Set(list.map((m) => m.id));
  return catalog.filter((m) => !have.has(m.id));
}

interface ModelsState {
  lists: Record<string, ModelEntry[]>;
  catalog: Record<string, ModelEntry[]>;
  hydrate: () => Promise<void>;
  addFromDefaults: (providerId: string, ids: string[]) => Promise<void>;
  addCustom: (
    providerId: string,
    entry: { id: string; label?: string; reasoning?: ReasoningProfile },
  ) => Promise<void>;
  editModel: (
    providerId: string,
    id: string,
    patch: { label?: string; reasoning?: ReasoningProfile },
  ) => Promise<void>;
  setHidden: (providerId: string, id: string, hidden: boolean) => Promise<void>;
  removeModel: (providerId: string, id: string) => Promise<void>;
}

export const useModels = create<ModelsState>((set) => {
  const apply = (view: ModelCatalogView): void => set({ lists: view.lists, catalog: view.catalog });
  /** Write → reproject → refresh the effective feed (the pickers' projection). */
  const applyAndNotify = async (view: ModelCatalogView): Promise<void> => {
    apply(view);
    await notifyModelsChanged();
  };
  return {
    lists: {},
    catalog: {},
    hydrate: async () => apply(await rpcModelCatalog()),
    addFromDefaults: async (providerId, ids) => applyAndNotify(await rpcAddModels({ providerId, ids })),
    addCustom: async (providerId, entry) =>
      applyAndNotify(await rpcAddCustomModel({ providerId, ...entry })),
    editModel: async (providerId, id, patch) =>
      applyAndNotify(await rpcEditModel({ providerId, id, ...patch })),
    setHidden: async (providerId, id, hidden) =>
      applyAndNotify(await rpcSetModelHidden({ providerId, id, hidden })),
    removeModel: async (providerId, id) => applyAndNotify(await rpcRemoveModel({ providerId, id })),
  };
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/panels/modelsStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/panels/modelsStore.ts apps/desktop/src/renderer/panels/modelsStore.test.ts apps/desktop/src/renderer/console.ts
git commit -m "feat: mirror the daemon model catalog in the renderer"
```

---

### Task 9: `ModelEditor` on the real store — dialog + right-click amendments

**Files:**
- Modify: `apps/desktop/src/renderer/panels/ModelEditor.tsx` (rewire to `modelsStore`; add-from-defaults becomes a `ModalShell` dialog; model rows gain the right-click door)
- Delete: `apps/desktop/src/renderer/panels/mockModels.ts`
- Modify: `apps/desktop/src/renderer/panels/mockAuth.ts` (drop the now-dead `hiddenModels` state + `setModelHidden` action if still present)
- Test: `apps/desktop/src/renderer/panels/ModelEditor.test.tsx` (new — jsdom, following the style of existing panel tests in the directory)

The mockup's `ModelEditor.tsx` (committed on `mockups/model-list-and-login` as `a6436fb`) is the interaction reference — port its structure onto the real store with these changes:

1. **Imports/reads:** replace every `useMockModels` read with `useModels`; replace `defaultCatalog(provider.id)` with `useModels((s) => s.catalog[provider.id] ?? [])`; the per-provider list is `useModels((s) => s.lists[provider.id] ?? [])`. Delete the `useProviderModels`/`seedIfNeeded` effect (the daemon materialises on write; an untouched provider's list arrives catalog-shaped from `modelCatalog`). `ModelsSection` calls `useModels.getState().hydrate()` in a mount effect (idempotent, the `AuthSurface` pattern), `.catch(() => {})`.
2. **Actions:** all writes go through the store's async actions with `void ….catch(() => {})` fire-and-forget (the `mockAuth` idiom).
3. **Add-from-defaults becomes a dialog.** Replace the inline `AddFromDefaultsPanel` + its `AnimatePresence` slot with a `ModalShell`-based `AddFromDefaultsDialog` (the `RemoveCustomConfirm`/`AddProviderDialog` idiom):

```tsx
/** Add from the coa catalog — a dialog (it's a picker over a static set, not a form
 *  growing the list it sits above), multi-select with a count-carrying commit. */
function AddFromDefaultsDialog({
  open,
  provider,
  onClose,
}: {
  open: boolean;
  provider: ProviderDescriptor;
  onClose: () => void;
}): React.JSX.Element {
  const list = useModels((s) => s.lists[provider.id] ?? []);
  const catalog = useModels((s) => s.catalog[provider.id] ?? []);
  const addFromDefaults = useModels((s) => s.addFromDefaults);
  const offered = offerable(catalog, list);
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const close = (): void => {
    setPicked([]);
    onClose();
  };
  const commit = (): void => {
    if (picked.length > 0) void addFromDefaults(provider.id, picked).catch(() => {});
    close();
  };

  return (
    <ModalShell open={open} onClose={close} aria-label="add from defaults" className="w-112">
      <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
        <BrandMark spec={provider.mark} />
        <span className="text-sec font-semibold text-s11">add from the coa catalog</span>
        <span className="ml-auto font-mono text-meta text-s7">{offered.length} available</span>
      </div>
      <div className="max-h-100 overflow-y-auto px-4 py-2">
        {offered.length === 0 ? (
          <div className="py-6 text-center text-sec text-s7">
            every catalog model is already in your list
          </div>
        ) : (
          offered.map((m) => {
            const on = picked.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                className="slip flex w-full cursor-pointer items-center gap-2.5 rounded-r2 px-2 py-1.5 text-left hover:bg-s3"
              >
                <span
                  aria-hidden
                  className={cx(
                    'flex h-3.5 w-3.5 flex-none items-center justify-center rounded-r1 border text-[8px]',
                    on ? 'border-s10 bg-s10 text-s1' : 'border-s6 text-transparent',
                  )}
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1 truncate text-sec text-s10">{entryLabel(m)}</span>
                <span className="truncate font-mono text-meta text-s7">{m.id}</span>
              </button>
            );
          })
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
        <Button variant="outline" onClick={close}>
          cancel
        </Button>
        <Button variant="quiet" disabled={picked.length === 0} onClick={commit}>
          add {picked.length > 0 ? picked.length : ''}
        </Button>
      </div>
    </ModalShell>
  );
}
```

`ModelsSection` keeps a `useState<'idle' | 'custom'>` for the inline create-custom form and a separate `const [addingDefaults, setAddingDefaults] = useState(false)` driving the dialog; the `AddMenu` items call `setAddingDefaults(true)` / `setMode('custom')`.

4. **Right-click on model rows** — port the `CredentialRow` pattern verbatim onto `ModelRow`: the row `div` gains the `onContextMenu` handler (preventDefault, stopPropagation, portal-aware `currentTarget.contains(target)` guard, `setMenuAt({x,y})`, `setMenuOpen(true)`), `ModelRow` holds `menuOpen`/`menuAt` state, and the local `RowMenu` gains the same controlled `open`/`onOpenChange`/`anchorPoint` props `AuthPanel.tsx`'s `RowMenu` has (copy that component's controlled-pair shape; the ⋯ trigger keeps `opacity-0 group-hover:opacity-100` visibility with `menuOpen ? 'opacity-100' : …` like the credential row).

- [ ] **Step 1: Write failing tests** (jsdom; mock `../console.js` exactly as in `modelsStore.test.ts`, seed `useModels.setState` directly):

```tsx
// apps/desktop/src/renderer/panels/ModelEditor.test.tsx — the shape; follow the
// directory's existing panel-test setup (render helpers, kit providers).
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// …mock '../console.js' with vi.fn rpc stubs as in modelsStore.test.ts…
import { useModels } from './modelsStore.js';
import { ModelsSection } from './ModelEditor.js';
import { PROVIDERS } from './providers.js';

const claude = PROVIDERS.find((p) => p.id === 'claude')!;
const seed = {
  lists: { claude: [{ id: 'claude-fable-5', label: 'fable 5', origin: 'default' as const }] },
  catalog: {
    claude: [
      { id: 'claude-fable-5', label: 'fable 5', origin: 'default' as const },
      { id: 'claude-opus-4-8', label: 'opus 4.8', origin: 'default' as const },
    ],
  },
};

describe('ModelsSection', () => {
  beforeEach(() => useModels.setState(seed));

  it('renders the provider list from the store', () => {
    render(<ModelsSection provider={claude} />);
    expect(screen.getByText('fable 5')).toBeInTheDocument();
  });

  it('add-from-defaults opens as a dialog offering catalog − list', async () => {
    render(<ModelsSection provider={claude} />);
    fireEvent.click(screen.getByText('+ add'));
    fireEvent.click(await screen.findByText('add from defaults…'));
    expect(screen.getByLabelText('add from defaults')).toBeInTheDocument();
    expect(screen.getByText('opus 4.8')).toBeInTheDocument();
    expect(screen.queryAllByText('fable 5').length).toBe(1); // only the row, not the dialog
  });

  it('right-click on a row opens the same actions menu', () => {
    render(<ModelsSection provider={claude} />);
    fireEvent.contextMenu(screen.getByText('fable 5'));
    expect(screen.getByText('edit…')).toBeInTheDocument();
    expect(screen.getByText('hide from pickers')).toBeInTheDocument();
  });

  it('empty list renders the backend-default fallback line', () => {
    useModels.setState({ ...seed, lists: { claude: [] } });
    render(<ModelsSection provider={claude} />);
    expect(screen.getByText(/backend default/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify the new assertions fail**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/panels/ModelEditor.test.tsx`
Expected: FAIL (store not wired / dialog not present).

- [ ] **Step 3: Implement** the four changes above in `ModelEditor.tsx`; delete `mockModels.ts`; remove the `hiddenModels`/`setModelHidden` remnants from `mockAuth.ts` (grep `hiddenModels` across `apps/desktop/src` and clean every consumer — the effective list now arrives pre-filtered from the daemon).

- [ ] **Step 4: Run the desktop suite + typecheck**

Run: `corepack pnpm exec vitest run apps/desktop/src` — Expected: PASS.
Run: `corepack pnpm --filter <desktop-package-name> exec tsc -p tsconfig.json --noEmit` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/ModelEditor.tsx apps/desktop/src/renderer/panels/ModelEditor.test.tsx apps/desktop/src/renderer/panels/mockAuth.ts
git rm apps/desktop/src/renderer/panels/mockModels.ts
git commit -m "feat: drive the model editor from the daemon catalog"
```

---

### Task 10: ADR + verify in the running app

**Files:**
- Create: `docs/adr/NNNN-coa-owned-model-catalog.md` (NNNN = next free number in `docs/adr/`)
- Modify: `ROADMAP.md` (mark the model-list SOT work done, per its existing per-module format)

- [ ] **Step 1: Write the ADR** (match the format of an existing ADR in `docs/adr/`, e.g. `0006-multi-account-auth.md`):

```markdown
# NNNN — The model catalog is coa-owned; the backend read enriches, never defines

Status: accepted · Date: 2026-07-18

## Context
Backends do not reliably advertise the concrete model ids that work: the Claude
SDK returns five aliases while the subscription honors explicit older ids
(verified live, 2026-07-12 model-access spike); DeepSeek/LongCat return ids but
no reasoning capabilities.

## Decision
The per-provider model list the pickers consume is the user's editable list in
`~/.coa/models.yaml`, seeded from a coa-shipped, hand-verified default catalog.
The live fetch is enrichment only — it supplies capabilities by id and populates
"add from defaults", never membership. The catalog carries a `last-verified`
date and is re-verified when Claude ships new ids.

## Consequences
- Editing the list is the supported way to reach un-advertised models — a
  catalog change, not a rearchitecture.
- Never-cage: an emptied list falls back to the backend default; a removed or
  hidden id still runs on the wire for anything pinned to it.
- The `COA_DEEPSEEK_EFFORT`/`COA_LONGCAT_EFFORT` env maps survive as the
  lowest-precedence capability tier, superseded by any UI-set profile.
```

- [ ] **Step 2: Run `corepack pnpm docs:check`** — Expected: clean (ADRs are reachable via the docs/adr/ table row in AGENTS.md).

- [ ] **Step 3: Full-repo verification**

Run: `corepack pnpm exec vitest run` — Expected: all suites PASS.
Run: `corepack pnpm -r exec tsc --noEmit` (or the repo's canonical typecheck script if one exists in the root `package.json`) — Expected: clean.

- [ ] **Step 4: Drive the app** (attended — invoke the `verify` skill's spirit): launch with `env -u ELECTRON_RUN_AS_NODE corepack pnpm --filter <desktop-package-name> dev` (one window — single-instance lock). Check: the Auth surface's models section renders the catalog; hide a model → the chat chip and agent picker lose it; add a custom id → both gain it; restart the app → edits survived (`~/.coa/models.yaml`); remove every model → chip falls back to backend default, nothing crashes.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/NNNN-coa-owned-model-catalog.md ROADMAP.md
git commit -m "docs: record the coa-owned model catalog decision"
```
