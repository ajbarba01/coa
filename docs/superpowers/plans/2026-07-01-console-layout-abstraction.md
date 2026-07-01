# Console Layout Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the engine-agnostic layout core — a panel registry, a versioned Zod layout descriptor, an engine port, and a hand-rolled StaticEngine — as a standalone, Electron-free, jsdom-unit-tested package that a later shell mounts.

**Architecture:** A new `@coa/console-layout` package holds four seams (spec §11). Panels are pure view modules held in a registry; arrangement is a serializable, versioned, drop-unknown-tolerant descriptor tree; a swappable `LayoutEngine` port owns whether arrangement is mutable; the MVP `StaticEngine` renders static regions as flexbox and resizable regions with `react-resizable-panels` (controlled). The package is generic over the panel view-model — it imports `react` + `react-resizable-panels` + `zod` only, never `console-ui`/`console-viewmodel`/`core`/`electron`.

**Tech Stack:** TypeScript (strict), React 19, `react-resizable-panels@4.12.0`, Zod 4, Vitest + jsdom + @testing-library/react, tsdown, dependency-cruiser.

## Global Constraints

- **TypeScript `strict`, no `any`.** Use `unknown` + internal existential casts for the heterogeneous registry, never `any`. (AGENTS.md Constitution.)
- **No-lock-in.** The descriptor is a neutral coa-owned schema, not a library's shape. (spec §3, §11.2)
- **Drop-unknown-panelId, never throw.** Persisted layout is untrusted input: `parseDescriptor` validates-or-falls-back-to-default and drops unknown panels rather than throwing. (spec §11.2)
- **StaticEngine loses zero functionality vs a docking engine**; a `dockable` region it can't dock degrades to `resizable`. (spec §11, §11.4)
- **WAI-ARIA window-splitter a11y** from `react-resizable-panels` (role=separator, arrow-key resize); static regions have no splitter; `focusPanel` ships day one; splitters are labelled. (spec §11.5)
- **No emoji anywhere.** (spec §14)
- **Commits: subject-only Conventional Commits**, no body/trailers, no internal identifiers (no module IDs / plan numbers). **Stage files by name.** **Developer-sized commits** — this plan commits at Part boundaries (two commits), NOT per task; the repo's commit-batching rule overrides TDD per-task commits.
- **pnpm PATH quirk:** prefix every pnpm command with `pnpm_config_verify_deps_before_run=false corepack pnpm …`. Run gates individually (the composite `check` script calls bare `pnpm`).
- **Single test from repo root:** `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run <path>`.
- **Same-commit doc rule:** the package-creating commit (Part A) also updates `.dependency-cruiser.cjs`, `tsconfig.json`, `vitest.config.ts`, and `docs/REPO_LAYOUT.md`.

---

## File structure

```
packages/console-layout/
  package.json                       new — @coa/console-layout; react peer, react-resizable-panels + zod deps
  tsconfig.json                      new — mirrors console-ui (jsx react-jsx, DOM lib)
  tsdown.config.ts                   new — esm build, externals
  src/
    index.ts                         new — public barrel
    panel/registry.ts                new — PanelHostApi, PanelDefinition, PanelRegistry, createPanelRegistry
    panel/registry.test.ts           new — registry behavior (node env)
    descriptor/schema.ts             new — Adjustability, Region tree, LayoutDescriptor + Zod schemas, LAYOUT_VERSION
    descriptor/schema.test.ts        new — schema accept/reject (node env)
    descriptor/migrate.ts            new — migrations ladder + parseDescriptor (drop-unknown, fallback, never-throw)
    descriptor/migrate.test.ts       new — migrate/drop-unknown/fallback (node env)
    engine/port.ts                   new — LayoutEngine, LayoutHandle, LayoutMountArgs types
    engine/static-engine.tsx         new — createStaticEngine (flex static + react-resizable-panels)
    engine/static-engine.test.tsx    new — mount/render/a11y/focus/onChange/dispose (jsdom env)
```

Same-commit doc/config edits (Part A commit):
- Modify: `.dependency-cruiser.cjs` — add `console-layout-no-electron-core` rule.
- Modify: `tsconfig.json` (root) — add `{ "path": "packages/console-layout" }`.
- Modify: `vitest.config.ts` — add the `@coa/console-layout` src alias.
- Modify: `docs/REPO_LAYOUT.md` — add the package to the tree, the logical→physical map note, and the dependency-rules bullet.
- Modify: `pnpm-workspace.yaml` — add `react-resizable-panels@4.12.0` to `minimumReleaseAgeExclude` **only if** the install is blocked by the release-age gate.

---

# Part A — Panel registry + Layout descriptor (one commit)

### Task A1: Scaffold the `@coa/console-layout` package + same-commit wiring

**Files:**
- Create: `packages/console-layout/package.json`
- Create: `packages/console-layout/tsconfig.json`
- Create: `packages/console-layout/tsdown.config.ts`
- Create: `packages/console-layout/src/index.ts` (temporary empty barrel)
- Modify: `.dependency-cruiser.cjs`
- Modify: `tsconfig.json` (root)
- Modify: `vitest.config.ts`
- Modify: `docs/REPO_LAYOUT.md`

**Interfaces:**
- Consumes: nothing (new package).
- Produces: the buildable `@coa/console-layout` package + its `@coa/console-layout` test alias; the depcruise `console-layout-no-electron-core` rule.

- [ ] **Step 1: Create `packages/console-layout/package.json`**

```json
{
  "name": "@coa/console-layout",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsdown",
    "typecheck": "tsc -b"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "dependencies": {
    "react-resizable-panels": "^4.12.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/console-layout/tsconfig.json`** (mirrors `packages/console-ui/tsconfig.json`)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "jsx": "react-jsx"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "dist", "node_modules"]
}
```

- [ ] **Step 3: Create `packages/console-layout/tsdown.config.ts`**

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  unbundle: true,
  fixedExtension: false,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react-dom/client',
    'react-resizable-panels',
    'zod',
  ],
});
```

- [ ] **Step 4: Create a temporary empty barrel `packages/console-layout/src/index.ts`**

```ts
export {};
```

- [ ] **Step 5: Add the dependency-cruiser rule.** In `.dependency-cruiser.cjs`, insert after the `console-ui-no-electron-core` rule block (before `renderer-isolation`):

```js
    {
      name: 'console-layout-no-electron-core',
      severity: 'error',
      comment:
        'The layout core is a pure renderer-side library; it never imports electron or the daemon core (only react/react-resizable-panels/zod).',
      from: { path: '^packages/console-layout/src' },
      to: { path: 'node_modules/electron/|^packages/core/' },
    },
```

- [ ] **Step 6: Add the root tsconfig reference.** In `tsconfig.json`, add after the `console-ui` line:

```json
    { "path": "packages/console-layout" },
```

- [ ] **Step 7: Add the vitest test alias.** In `vitest.config.ts`, add to `workspaceAlias` after the `@coa/console-ui` entry:

```ts
  '@coa/console-layout': fileURLToPath(
    new URL('./packages/console-layout/src/index.ts', import.meta.url),
  ),
```

- [ ] **Step 8: Update `docs/REPO_LAYOUT.md`.** (a) In the top-level tree, after the `console-ui/` line add:

```
    console-layout/          M10 — @coa/console-layout (panel registry + versioned layout descriptor + engine port + StaticEngine; pure react/react-resizable-panels/zod, no electron/core)
```

(b) In the logical→physical map, update the M10 Console `Package` cell to append `+ packages/console-layout` and the Notes cell to append `; console-layout owns the engine-agnostic layout core (registry + descriptor + engine port + StaticEngine)`.

(c) In "Dependency rules", after the `console-ui` bullet add:

```
- **`console-layout` is the pure layout core** — it imports only `react`/`react-resizable-panels`/`zod`, never
  `electron`/`core` (enforced: `console-layout-no-electron-core`). It stays generic over the panel view-model
  (no `console-ui`/`console-viewmodel` import); concrete panels live in the shell.
```

- [ ] **Step 9: Install** (registers the new workspace package + its deps)

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm install`
Expected: success. If blocked with a minimum-release-age error naming `react-resizable-panels`, add `react-resizable-panels@4.12.0` to `pnpm-workspace.yaml` → `minimumReleaseAgeExclude` (mirror the existing entries) and re-run.

- [ ] **Step 10: Verify the scaffold typechecks and the graph is clean**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck`
Expected: PASS (empty package builds).
Run: `pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: PASS, 0 violations.

(No commit yet — Part A commits after Task A4.)

---

### Task A2: Panel registry

**Files:**
- Create: `packages/console-layout/src/panel/registry.ts`
- Test: `packages/console-layout/src/panel/registry.test.ts`

**Interfaces:**
- Consumes: `react` (`ComponentType`).
- Produces:
  - `interface PanelHostApi { readonly title: string; setTitle(t: string): void; onVisibilityChange(cb: (visible: boolean) => void): () => void; requestFocus(): void }`
  - `interface PanelConstraints { minWidth?: number; minHeight?: number }`
  - `interface PanelDefinition<VM = unknown, S = unknown> { id: string; displayName: string; render: ComponentType<{ vm: VM; host: PanelHostApi }>; selectVm: (daemonState: S) => VM; defaultConstraints?: PanelConstraints }`
  - `interface PanelRegistry { register<VM, S>(def: PanelDefinition<VM, S>): void; resolve(id: string): PanelDefinition | undefined; has(id: string): boolean }`
  - `function createPanelRegistry(): PanelRegistry`

- [ ] **Step 1: Write the failing test** `packages/console-layout/src/panel/registry.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createPanelRegistry, type PanelDefinition } from './registry.js';

function fakePanel(id: string): PanelDefinition<number, { n: number }> {
  return {
    id,
    displayName: id.toUpperCase(),
    render: () => null,
    selectVm: (s) => s.n,
  };
}

describe('createPanelRegistry', () => {
  it('registers and resolves a panel by id', () => {
    const reg = createPanelRegistry();
    reg.register(fakePanel('cost'));
    expect(reg.has('cost')).toBe(true);
    expect(reg.resolve('cost')?.displayName).toBe('COST');
  });

  it('returns undefined / false for unknown ids', () => {
    const reg = createPanelRegistry();
    expect(reg.resolve('nope')).toBeUndefined();
    expect(reg.has('nope')).toBe(false);
  });

  it('throws on duplicate registration', () => {
    const reg = createPanelRegistry();
    reg.register(fakePanel('cost'));
    expect(() => reg.register(fakePanel('cost'))).toThrow(/already registered/i);
  });

  it('exposes a pure selectVm that maps daemon state to a view-model', () => {
    const reg = createPanelRegistry();
    reg.register(fakePanel('cost'));
    const def = reg.resolve('cost');
    expect(def?.selectVm({ n: 42 })).toBe(42);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-layout/src/panel/registry.test.ts`
Expected: FAIL (cannot resolve `./registry.js`).

- [ ] **Step 3: Implement** `packages/console-layout/src/panel/registry.ts`

```ts
import type { ComponentType } from 'react';

/** The panel's view of its host. A strict SUBSET of dockview's panel api, so a
 *  panel written today runs unchanged under a docking engine tomorrow. */
export interface PanelHostApi {
  readonly title: string;
  setTitle(title: string): void;
  /** Subscribe to visibility changes; returns an unsubscribe. */
  onVisibilityChange(cb: (visible: boolean) => void): () => void;
  requestFocus(): void;
}

export interface PanelConstraints {
  minWidth?: number;
  minHeight?: number;
}

/** A panel is a pure view module: a component + a pure daemon-state -> view-model
 *  selector. It never imports the engine or the descriptor. */
export interface PanelDefinition<VM = unknown, S = unknown> {
  id: string;
  displayName: string;
  render: ComponentType<{ vm: VM; host: PanelHostApi }>;
  selectVm: (daemonState: S) => VM;
  defaultConstraints?: PanelConstraints;
}

export interface PanelRegistry {
  register<VM, S>(def: PanelDefinition<VM, S>): void;
  resolve(id: string): PanelDefinition | undefined;
  has(id: string): boolean;
}

export function createPanelRegistry(): PanelRegistry {
  const panels = new Map<string, PanelDefinition>();
  return {
    register(def) {
      if (panels.has(def.id)) {
        throw new Error(`Panel already registered: ${def.id}`);
      }
      // Store erased: the registry is heterogeneous over VM/S. The public
      // register<VM,S> keeps callers type-safe; the internal store is existential.
      panels.set(def.id, def as unknown as PanelDefinition);
    },
    resolve(id) {
      return panels.get(id);
    },
    has(id) {
      return panels.has(id);
    },
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-layout/src/panel/registry.test.ts`
Expected: PASS (4 tests).

---

### Task A3: Layout descriptor schema

**Files:**
- Create: `packages/console-layout/src/descriptor/schema.ts`
- Test: `packages/console-layout/src/descriptor/schema.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `const AdjustabilitySchema` / `type Adjustability = 'static' | 'resizable' | 'dockable'`
  - `interface LeafRegion { type: 'leaf'; panelId: string; size?: number }`
  - `interface SplitRegion { type: 'split'; direction: 'row' | 'column'; adjustability: Adjustability; children: Region[] }`
  - `type Region = LeafRegion | SplitRegion`
  - `const RegionSchema: z.ZodType<Region>`
  - `const LAYOUT_VERSION = 1`
  - `interface LayoutDescriptor { version: number; root: Region }`
  - `const LayoutDescriptorSchema: z.ZodType<LayoutDescriptor>`

- [ ] **Step 1: Write the failing test** `packages/console-layout/src/descriptor/schema.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { LayoutDescriptorSchema, LAYOUT_VERSION, type LayoutDescriptor } from './schema.js';

const valid: LayoutDescriptor = {
  version: LAYOUT_VERSION,
  root: {
    type: 'split',
    direction: 'row',
    adjustability: 'resizable',
    children: [
      { type: 'leaf', panelId: 'nav' },
      { type: 'leaf', panelId: 'chat', size: 70 },
    ],
  },
};

describe('LayoutDescriptorSchema', () => {
  it('accepts a well-formed descriptor', () => {
    expect(LayoutDescriptorSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a nested split tree', () => {
    const nested: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'static',
        children: [
          { type: 'leaf', panelId: 'nav' },
          {
            type: 'split',
            direction: 'column',
            adjustability: 'resizable',
            children: [
              { type: 'leaf', panelId: 'chat' },
              { type: 'leaf', panelId: 'input' },
            ],
          },
        ],
      },
    };
    expect(LayoutDescriptorSchema.parse(nested)).toEqual(nested);
  });

  it('rejects an unknown version', () => {
    expect(() => LayoutDescriptorSchema.parse({ ...valid, version: 999 })).toThrow();
  });

  it('rejects an unknown adjustability value', () => {
    const bad = {
      version: LAYOUT_VERSION,
      root: { type: 'split', direction: 'row', adjustability: 'floaty', children: [{ type: 'leaf', panelId: 'a' }] },
    };
    expect(() => LayoutDescriptorSchema.parse(bad)).toThrow();
  });

  it('rejects a leaf without a panelId', () => {
    const bad = { version: LAYOUT_VERSION, root: { type: 'leaf' } };
    expect(() => LayoutDescriptorSchema.parse(bad)).toThrow();
  });

  it('rejects a split with no children', () => {
    const bad = {
      version: LAYOUT_VERSION,
      root: { type: 'split', direction: 'row', adjustability: 'static', children: [] },
    };
    expect(() => LayoutDescriptorSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-layout/src/descriptor/schema.test.ts`
Expected: FAIL (cannot resolve `./schema.js`).

- [ ] **Step 3: Implement** `packages/console-layout/src/descriptor/schema.ts`

```ts
import { z } from 'zod';

/** Per-region resize dial. `dockable` is honored by a docking engine; the
 *  StaticEngine degrades it to `resizable`. */
export const AdjustabilitySchema = z.enum(['static', 'resizable', 'dockable']);
export type Adjustability = z.infer<typeof AdjustabilitySchema>;

/** A leaf hosts exactly one panel; `size` is its fractional size within its parent split. */
export interface LeafRegion {
  type: 'leaf';
  panelId: string;
  size?: number;
}

/** A split arranges children along an axis; the resize dial lives here (it owns
 *  the boundary between its children). */
export interface SplitRegion {
  type: 'split';
  direction: 'row' | 'column';
  adjustability: Adjustability;
  children: Region[];
}

export type Region = LeafRegion | SplitRegion;

const LeafRegionSchema: z.ZodType<LeafRegion> = z.object({
  type: z.literal('leaf'),
  panelId: z.string().min(1),
  size: z.number().positive().optional(),
});

const SplitRegionSchema: z.ZodType<SplitRegion> = z.lazy(() =>
  z.object({
    type: z.literal('split'),
    direction: z.enum(['row', 'column']),
    adjustability: AdjustabilitySchema,
    children: z.array(RegionSchema).min(1),
  }),
);

export const RegionSchema: z.ZodType<Region> = z.lazy(() =>
  z.union([LeafRegionSchema, SplitRegionSchema]),
);

/** Current descriptor version. Bump + add a migration when the shape changes. */
export const LAYOUT_VERSION = 1;

export interface LayoutDescriptor {
  version: number;
  root: Region;
}

export const LayoutDescriptorSchema: z.ZodType<LayoutDescriptor> = z.object({
  version: z.literal(LAYOUT_VERSION),
  root: RegionSchema,
});
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-layout/src/descriptor/schema.test.ts`
Expected: PASS (6 tests).

---

### Task A4: Descriptor parse + migration + drop-unknown

**Files:**
- Create: `packages/console-layout/src/descriptor/migrate.ts`
- Test: `packages/console-layout/src/descriptor/migrate.test.ts`
- Modify: `packages/console-layout/src/index.ts` (replace the temporary barrel)

**Interfaces:**
- Consumes: `./schema.js` (`LayoutDescriptorSchema`, `LayoutDescriptor`, `Region`, `LAYOUT_VERSION`), `../panel/registry.js` (`PanelRegistry`).
- Produces:
  - `type Migration = (raw: Record<string, unknown>) => Record<string, unknown>`
  - `const migrations: Record<number, Migration>`
  - `function parseDescriptor(raw: unknown, registry: PanelRegistry, fallback: LayoutDescriptor): LayoutDescriptor`

- [ ] **Step 1: Write the failing test** `packages/console-layout/src/descriptor/migrate.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseDescriptor } from './migrate.js';
import { LAYOUT_VERSION, type LayoutDescriptor } from './schema.js';
import { createPanelRegistry, type PanelDefinition } from '../panel/registry.js';

function reg(...ids: string[]) {
  const r = createPanelRegistry();
  for (const id of ids) {
    const def: PanelDefinition = { id, displayName: id, render: () => null, selectVm: () => undefined };
    r.register(def);
  }
  return r;
}

const fallback: LayoutDescriptor = {
  version: LAYOUT_VERSION,
  root: { type: 'leaf', panelId: 'nav' },
};

describe('parseDescriptor', () => {
  it('returns a valid descriptor unchanged when all panels are known', () => {
    const d: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'resizable',
        children: [
          { type: 'leaf', panelId: 'nav' },
          { type: 'leaf', panelId: 'chat' },
        ],
      },
    };
    expect(parseDescriptor(d, reg('nav', 'chat'), fallback)).toEqual(d);
  });

  it('drops a leaf whose panelId is unknown and keeps the rest', () => {
    const d: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'resizable',
        children: [
          { type: 'leaf', panelId: 'nav' },
          { type: 'leaf', panelId: 'ghost' },
          { type: 'leaf', panelId: 'chat' },
        ],
      },
    };
    const out = parseDescriptor(d, reg('nav', 'chat'), fallback);
    expect(out.root).toEqual({
      type: 'split',
      direction: 'row',
      adjustability: 'resizable',
      children: [
        { type: 'leaf', panelId: 'nav' },
        { type: 'leaf', panelId: 'chat' },
      ],
    });
  });

  it('collapses a split down to its single surviving child', () => {
    const d: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'static',
        children: [
          { type: 'leaf', panelId: 'chat' },
          { type: 'leaf', panelId: 'ghost' },
        ],
      },
    };
    const out = parseDescriptor(d, reg('chat'), fallback);
    expect(out.root).toEqual({ type: 'leaf', panelId: 'chat' });
  });

  it('falls back when every panel is unknown', () => {
    const d: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: { type: 'leaf', panelId: 'ghost' },
    };
    expect(parseDescriptor(d, reg('nav'), fallback)).toBe(fallback);
  });

  it('falls back (never throws) on structurally invalid input', () => {
    expect(parseDescriptor({ garbage: true }, reg('nav'), fallback)).toBe(fallback);
    expect(parseDescriptor(null, reg('nav'), fallback)).toBe(fallback);
    expect(parseDescriptor('nope', reg('nav'), fallback)).toBe(fallback);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-layout/src/descriptor/migrate.test.ts`
Expected: FAIL (cannot resolve `./migrate.js`).

- [ ] **Step 3: Implement** `packages/console-layout/src/descriptor/migrate.ts`

```ts
import { LayoutDescriptorSchema, LAYOUT_VERSION, type LayoutDescriptor, type Region } from './schema.js';
import type { PanelRegistry } from '../panel/registry.js';

/** A single version-to-next-version upgrade. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** version n -> n+1. Empty at v1 (the first version); grows as the shape evolves. */
export const migrations: Record<number, Migration> = {};

function runMigrations(raw: Record<string, unknown>): Record<string, unknown> {
  let cur = raw;
  while (typeof cur['version'] === 'number' && cur['version'] < LAYOUT_VERSION) {
    const step = migrations[cur['version']];
    if (!step) break;
    cur = step(cur);
  }
  return cur;
}

/** Remove leaves whose panelId is unknown; prune splits emptied by the removal
 *  and collapse single-child splits. Returns null if the whole tree collapses. */
function pruneUnknown(region: Region, registry: PanelRegistry): Region | null {
  if (region.type === 'leaf') {
    return registry.has(region.panelId) ? region : null;
  }
  const kept = region.children
    .map((c) => pruneUnknown(c, registry))
    .filter((c): c is Region => c !== null);
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0] as Region;
  return { ...region, children: kept };
}

/** Validate persisted (untrusted) layout: migrate to the current version, parse,
 *  drop unknown panels, and fall back to `fallback` rather than ever throwing. */
export function parseDescriptor(
  raw: unknown,
  registry: PanelRegistry,
  fallback: LayoutDescriptor,
): LayoutDescriptor {
  try {
    const migrated =
      raw !== null && typeof raw === 'object'
        ? runMigrations(raw as Record<string, unknown>)
        : raw;
    const parsed = LayoutDescriptorSchema.parse(migrated);
    const pruned = pruneUnknown(parsed.root, registry);
    if (pruned === null) return fallback;
    return { version: parsed.version, root: pruned };
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-layout/src/descriptor/migrate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Replace the temporary barrel** `packages/console-layout/src/index.ts`

```ts
export * from './panel/registry.js';
export * from './descriptor/schema.js';
export * from './descriptor/migrate.js';
```

- [ ] **Step 6: Run the full Part A gate sweep**

```
pnpm_config_verify_deps_before_run=false corepack pnpm typecheck
pnpm_config_verify_deps_before_run=false corepack pnpm lint
pnpm_config_verify_deps_before_run=false corepack pnpm format:write
pnpm_config_verify_deps_before_run=false corepack pnpm format
pnpm_config_verify_deps_before_run=false corepack pnpm test
pnpm_config_verify_deps_before_run=false corepack pnpm depcruise
```
Expected: all PASS; test count = previous total + 15 new (4 registry + 6 schema + 5 migrate); depcruise 0 violations.

- [ ] **Step 7: Commit Part A** (stage by name; subject-only)

```bash
git add packages/console-layout/package.json packages/console-layout/tsconfig.json \
  packages/console-layout/tsdown.config.ts packages/console-layout/src/index.ts \
  packages/console-layout/src/panel/registry.ts packages/console-layout/src/panel/registry.test.ts \
  packages/console-layout/src/descriptor/schema.ts packages/console-layout/src/descriptor/schema.test.ts \
  packages/console-layout/src/descriptor/migrate.ts packages/console-layout/src/descriptor/migrate.test.ts \
  .dependency-cruiser.cjs tsconfig.json vitest.config.ts docs/REPO_LAYOUT.md pnpm-lock.yaml
# include pnpm-workspace.yaml too if a minimumReleaseAgeExclude entry was added
git commit -m "feat: add the console layout panel registry and descriptor"
```

---

# Part B — Engine port + StaticEngine (one commit)

### Task B1: Engine port + StaticEngine rendering

**Files:**
- Create: `packages/console-layout/src/engine/port.ts`
- Create: `packages/console-layout/src/engine/static-engine.tsx`
- Test: `packages/console-layout/src/engine/static-engine.test.tsx`
- Modify: `packages/console-layout/src/index.ts`

**Interfaces:**
- Consumes: `./port.js`, `../descriptor/schema.js`, `../panel/registry.js`, `react`, `react-dom/client`, `react-resizable-panels`.
- Produces:
  - `interface LayoutMountArgs { container: HTMLElement; descriptor: LayoutDescriptor; registry: PanelRegistry; daemonState: unknown; onChange: (descriptor: LayoutDescriptor) => void }`
  - `interface LayoutHandle { serialize(): LayoutDescriptor; applyDescriptor(descriptor: LayoutDescriptor): void; focusPanel(id: string): void; dispose(): void }`
  - `interface LayoutEngine { readonly id: string; readonly supports: ReadonlySet<Adjustability>; mount(args: LayoutMountArgs): LayoutHandle }`
  - `function createStaticEngine(): LayoutEngine`

- [ ] **Step 1: Write the failing test** `packages/console-layout/src/engine/static-engine.test.tsx`

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStaticEngine } from './static-engine.js';
import { createPanelRegistry, type PanelDefinition, type PanelHostApi } from '../panel/registry.js';
import { LAYOUT_VERSION, type LayoutDescriptor } from '../descriptor/schema.js';

function textPanel(id: string): PanelDefinition<string, unknown> {
  return {
    id,
    displayName: id.toUpperCase(),
    render: ({ vm }: { vm: string; host: PanelHostApi }) => <div>{vm}</div>,
    selectVm: () => `panel:${id}`,
  };
}

function mountInto(descriptor: LayoutDescriptor, onChange = vi.fn()) {
  const registry = createPanelRegistry();
  registry.register(textPanel('nav'));
  registry.register(textPanel('chat'));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const engine = createStaticEngine();
  let handle!: ReturnType<typeof engine.mount>;
  act(() => {
    handle = engine.mount({ container, descriptor, registry, daemonState: {}, onChange });
  });
  return { registry, container, handle, onChange };
}

afterEach(() => {
  document.body.innerHTML = '';
});

const staticSplit: LayoutDescriptor = {
  version: LAYOUT_VERSION,
  root: {
    type: 'split',
    direction: 'row',
    adjustability: 'static',
    children: [
      { type: 'leaf', panelId: 'nav' },
      { type: 'leaf', panelId: 'chat' },
    ],
  },
};

const resizableSplit: LayoutDescriptor = {
  version: LAYOUT_VERSION,
  root: {
    type: 'split',
    direction: 'row',
    adjustability: 'resizable',
    children: [
      { type: 'leaf', panelId: 'nav', size: 30 },
      { type: 'leaf', panelId: 'chat', size: 70 },
    ],
  },
};

describe('StaticEngine', () => {
  it('advertises its identity and supported dials', () => {
    const engine = createStaticEngine();
    expect(engine.id).toBe('static');
    expect(engine.supports.has('static')).toBe(true);
    expect(engine.supports.has('resizable')).toBe(true);
    expect(engine.supports.has('dockable')).toBe(false);
  });

  it('renders each panel body via its selectVm', () => {
    const { container } = mountInto(staticSplit);
    expect(container.textContent).toContain('panel:nav');
    expect(container.textContent).toContain('panel:chat');
  });

  it('renders a labelled separator for a resizable split', () => {
    const { container } = mountInto(resizableSplit);
    const seps = container.querySelectorAll('[role="separator"]');
    expect(seps.length).toBe(1);
    expect(seps[0]?.getAttribute('aria-label')?.length).toBeGreaterThan(0);
  });

  it('renders NO separator for a static split', () => {
    const { container } = mountInto(staticSplit);
    expect(container.querySelectorAll('[role="separator"]').length).toBe(0);
  });

  it('exposes each panel body as a focus target keyed by panelId', () => {
    const { container } = mountInto(staticSplit);
    expect(container.querySelector('[data-panel-id="nav"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="chat"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-layout/src/engine/static-engine.test.tsx`
Expected: FAIL (cannot resolve `./static-engine.js`).

- [ ] **Step 3: Implement the port** `packages/console-layout/src/engine/port.ts`

```ts
import type { Adjustability, LayoutDescriptor } from '../descriptor/schema.js';
import type { PanelRegistry } from '../panel/registry.js';

export interface LayoutMountArgs {
  container: HTMLElement;
  descriptor: LayoutDescriptor;
  registry: PanelRegistry;
  daemonState: unknown;
  /** Fires whenever the arrangement changes (e.g. a resize). */
  onChange: (descriptor: LayoutDescriptor) => void;
}

export interface LayoutHandle {
  serialize(): LayoutDescriptor;
  applyDescriptor(descriptor: LayoutDescriptor): void;
  focusPanel(id: string): void;
  dispose(): void;
}

/** The one seam that knows whether arrangement is mutable. Swapping this (Static ->
 *  Dockview) does not touch panels or descriptors. */
export interface LayoutEngine {
  readonly id: string;
  readonly supports: ReadonlySet<Adjustability>;
  mount(args: LayoutMountArgs): LayoutHandle;
}
```

- [ ] **Step 4: Implement the StaticEngine** `packages/console-layout/src/engine/static-engine.tsx`

```tsx
import { Fragment, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { Adjustability, LayoutDescriptor, Region } from '../descriptor/schema.js';
import type { PanelHostApi, PanelRegistry } from '../panel/registry.js';
import type { LayoutEngine, LayoutHandle, LayoutMountArgs } from './port.js';

const SUPPORTED: ReadonlySet<Adjustability> = new Set<Adjustability>(['static', 'resizable']);

/** Mutable, React-external state so the imperative handle can drive/read the tree
 *  without React re-rendering on every drag (which would fight the resize lib). */
interface LayoutStore {
  current: LayoutDescriptor;
  revision: number;
  focusTargets: Map<string, HTMLElement>;
  listeners: Set<() => void>;
}

function notify(store: LayoutStore): void {
  for (const l of store.listeners) l();
}

interface RenderCtx {
  store: LayoutStore;
  registry: PanelRegistry;
  daemonState: unknown;
  onChange: (d: LayoutDescriptor) => void;
}

/** First panel id under a region — used to label a splitter by an adjacent panel. */
function firstPanelId(region: Region): string | undefined {
  if (region.type === 'leaf') return region.panelId;
  for (const child of region.children) {
    const id = firstPanelId(child);
    if (id !== undefined) return id;
  }
  return undefined;
}

function separatorLabel(ctx: RenderCtx, before: Region, after: Region): string {
  const a = firstPanelId(before);
  const b = firstPanelId(after);
  const nameA = (a !== undefined && ctx.registry.resolve(a)?.displayName) || 'region';
  const nameB = (b !== undefined && ctx.registry.resolve(b)?.displayName) || 'region';
  return `Resize ${nameA} and ${nameB}`;
}

function setLeafSize(region: Region, size: number | undefined): Region {
  if (size === undefined || region.type !== 'leaf') return region;
  return { ...region, size };
}

/** Fold new pixel/percent sizes reported by a PanelGroup back into the descriptor
 *  at `path` (dot-joined child indices under root). */
function updateSizesAtPath(desc: LayoutDescriptor, path: string, sizes: number[]): LayoutDescriptor {
  const indices = path.split('.').slice(1).map(Number);
  function recur(region: Region, depth: number): Region {
    if (region.type !== 'split') return region;
    if (depth === indices.length) {
      return { ...region, children: region.children.map((c, i) => setLeafSize(c, sizes[i])) };
    }
    const idx = indices[depth];
    return { ...region, children: region.children.map((c, i) => (i === idx ? recur(c, depth + 1) : c)) };
  }
  return { ...desc, root: recur(desc.root, 0) };
}

function PanelBody({ region, ctx }: { region: Region & { type: 'leaf' }; ctx: RenderCtx }): React.JSX.Element | null {
  const def = ctx.registry.resolve(region.panelId);
  if (!def) return null; // defensive: parseDescriptor already dropped unknowns
  const vm = def.selectVm(ctx.daemonState);
  const Render = def.render;
  const host: PanelHostApi = {
    title: def.displayName,
    setTitle: () => {}, // inert under StaticEngine; lights up under dockview
    onVisibilityChange: () => () => {}, // panels are always visible in the static layout
    requestFocus: () => ctx.store.focusTargets.get(region.panelId)?.focus(),
  };
  return (
    <div
      data-panel-id={region.panelId}
      tabIndex={-1}
      ref={(el) => {
        if (el) ctx.store.focusTargets.set(region.panelId, el);
        else ctx.store.focusTargets.delete(region.panelId);
      }}
      style={{ minWidth: 0, minHeight: 0, height: '100%', width: '100%' }}
    >
      <Render vm={vm} host={host} />
    </div>
  );
}

function renderRegion(region: Region, ctx: RenderCtx, path: string): React.JSX.Element {
  if (region.type === 'leaf') {
    return <PanelBody region={region} ctx={ctx} />;
  }
  // A `dockable` region degrades to `resizable` under the StaticEngine.
  const resizable = region.adjustability !== 'static';
  if (!resizable) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: region.direction === 'row' ? 'row' : 'column',
          minWidth: 0,
          minHeight: 0,
          height: '100%',
          width: '100%',
        }}
      >
        {region.children.map((child, i) => (
          <div key={i} style={{ flex: child.type === 'leaf' && child.size ? `${child.size} 1 0` : '1 1 0', minWidth: 0, minHeight: 0 }}>
            {renderRegion(child, ctx, `${path}.${i}`)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <PanelGroup
      key={`${path}:${ctx.store.revision}`}
      direction={region.direction === 'row' ? 'horizontal' : 'vertical'}
      onLayout={(sizes: number[]) => {
        ctx.store.current = updateSizesAtPath(ctx.store.current, path, sizes);
        ctx.onChange(ctx.store.current);
      }}
    >
      {region.children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <PanelResizeHandle aria-label={separatorLabel(ctx, region.children[i - 1] as Region, child)} />}
          <Panel defaultSize={child.type === 'leaf' ? child.size : undefined} minSize={5}>
            {renderRegion(child, ctx, `${path}.${i}`)}
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  );
}

function StaticRoot({ ctx }: { ctx: RenderCtx }): React.JSX.Element {
  const descriptor = useSyncExternalStore(
    (cb) => {
      ctx.store.listeners.add(cb);
      return () => ctx.store.listeners.delete(cb);
    },
    () => ctx.store.current,
  );
  return <div style={{ height: '100%', width: '100%' }}>{renderRegion(descriptor.root, ctx, 'root')}</div>;
}

export function createStaticEngine(): LayoutEngine {
  return {
    id: 'static',
    supports: SUPPORTED,
    mount({ container, descriptor, registry, daemonState, onChange }: LayoutMountArgs): LayoutHandle {
      const store: LayoutStore = {
        current: descriptor,
        revision: 0,
        focusTargets: new Map(),
        listeners: new Set(),
      };
      const ctx: RenderCtx = { store, registry, daemonState, onChange };
      const root = createRoot(container);
      root.render(<StaticRoot ctx={ctx} />);
      return {
        serialize: () => store.current,
        applyDescriptor: (d) => {
          store.current = d;
          store.revision += 1;
          notify(store);
        },
        focusPanel: (id) => store.focusTargets.get(id)?.focus(),
        dispose: () => root.unmount(),
      };
    },
  };
}
```

- [ ] **Step 5: Export the engine.** Append to `packages/console-layout/src/index.ts`:

```ts
export * from './engine/port.js';
export { createStaticEngine } from './engine/static-engine.js';
```

- [ ] **Step 6: Run the rendering test and confirm it passes**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-layout/src/engine/static-engine.test.tsx`
Expected: PASS (5 tests). If `noUncheckedIndexedAccess` flags `sizes[i]` / `indices[depth]`, keep the `setLeafSize` undefined-guard and compare `i === idx` with `idx` possibly `undefined` (a no-op match) — this is intentional and safe.

---

### Task B2: StaticEngine handle behaviors (focus, onChange, applyDescriptor, dispose, degrade)

**Files:**
- Modify: `packages/console-layout/src/engine/static-engine.test.tsx` (append behaviors)

**Interfaces:**
- Consumes: the Task B1 handle (`serialize`, `applyDescriptor`, `focusPanel`, `dispose`).
- Produces: nothing new (behavioral coverage of the existing handle).

- [ ] **Step 1: Append the failing behavior tests** to `packages/console-layout/src/engine/static-engine.test.tsx`

```tsx
describe('StaticEngine handle', () => {
  it('serialize returns the current descriptor', () => {
    const { handle } = mountInto(resizableSplit);
    expect(handle.serialize()).toEqual(resizableSplit);
  });

  it('focusPanel moves focus to the panel body', () => {
    const { handle, container } = mountInto(staticSplit);
    act(() => handle.focusPanel('chat'));
    expect(document.activeElement).toBe(container.querySelector('[data-panel-id="chat"]'));
  });

  it('applyDescriptor re-renders and updates serialize', () => {
    const { handle, container } = mountInto(staticSplit);
    const next: LayoutDescriptor = { version: LAYOUT_VERSION, root: { type: 'leaf', panelId: 'chat' } };
    act(() => handle.applyDescriptor(next));
    expect(handle.serialize()).toEqual(next);
    expect(container.textContent).toContain('panel:chat');
    expect(container.textContent).not.toContain('panel:nav');
  });

  it('dispose unmounts the tree', () => {
    const { handle, container } = mountInto(staticSplit);
    act(() => handle.dispose());
    expect(container.textContent).toBe('');
  });

  it('degrades a dockable split to a resizable one (renders a separator)', () => {
    const dockable: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'dockable',
        children: [
          { type: 'leaf', panelId: 'nav' },
          { type: 'leaf', panelId: 'chat' },
        ],
      },
    };
    const { container } = mountInto(dockable);
    expect(container.querySelectorAll('[role="separator"]').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run and confirm the new tests pass** (they exercise Task B1's handle — no new implementation needed)

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-layout/src/engine/static-engine.test.tsx`
Expected: PASS (10 tests total in the file). If `applyDescriptor`'s re-render does not swap the tree, confirm `StaticRoot` reads `ctx.store.current` through `useSyncExternalStore` and that `notify` runs inside the test's `act`.

- [ ] **Step 3: Run the full Part B gate sweep**

```
pnpm_config_verify_deps_before_run=false corepack pnpm typecheck
pnpm_config_verify_deps_before_run=false corepack pnpm lint
pnpm_config_verify_deps_before_run=false corepack pnpm format:write
pnpm_config_verify_deps_before_run=false corepack pnpm format
pnpm_config_verify_deps_before_run=false corepack pnpm test
pnpm_config_verify_deps_before_run=false corepack pnpm depcruise
```
Expected: all PASS; test total = Part A total + 10; depcruise 0 violations (the `console-layout-no-electron-core` rule holds — no electron/core import).

- [ ] **Step 4: Commit Part B** (stage by name; subject-only)

```bash
git add packages/console-layout/src/engine/port.ts \
  packages/console-layout/src/engine/static-engine.tsx \
  packages/console-layout/src/engine/static-engine.test.tsx \
  packages/console-layout/src/index.ts
git commit -m "feat: add the static layout engine"
```

---

## Post-plan: memory upkeep (not a code commit)

After both parts land green, update `C:\Users\Zander\.claude\projects\c--Users-Zander-Documents-Side-Projects-coa\memory\m10-status.md` and the `MEMORY.md` index: the layout core (registry + descriptor + engine port + StaticEngine) is BUILT in `@coa/console-layout`; next step is Plan 4 (the app shell composing registry + panels + the buildable-now surfaces onto the StaticEngine); DockviewEngine + daemon persistence wiring + apps/desktop consumption remain deferred.

## Self-review

**Spec coverage (§11):** §11.1 registry → Task A2. §11.2 versioned descriptor + drop-unknown → Tasks A3–A4. §11.3 engine port → Task B1. §11.4 StaticEngine + react-resizable-panels + dockable-degrades → Tasks B1–B2. §11.5 a11y (separator present/absent + labelled, focusPanel day one) → Tasks B1–B2. §11.6 package placement + console-local schema + imperative port + deferrals → Tasks A1, A3–A4, B1. §17 testability (all jsdom/node, no Electron) → every task.

**Placeholder scan:** none — every step carries real code/commands.

**Type consistency:** `PanelDefinition`/`PanelRegistry`/`PanelHostApi` names identical across A2, A4, B1. `LayoutDescriptor`/`Region`/`Adjustability`/`LAYOUT_VERSION` identical across A3, A4, B1. `LayoutEngine`/`LayoutHandle`/`LayoutMountArgs`/`createStaticEngine` identical across B1, B2. `parseDescriptor(raw, registry, fallback)` signature stable.

**Deferred (out of scope, confirmed):** DockviewEngine; concrete panels; daemon persistence verb + per-workspace storage + IPC; apps/desktop consumption (vite alias / tsconfig ref / globals.css `@source`).
