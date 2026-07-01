# Console Component Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standardized six-family component kit (Actions · Inputs & Selection · Layout & Structure · Data-display · Feedback & Status · Overlays) in a new `packages/console-ui` package, each component shipping the full feedback-contract state set, a typed `intent` declaration, and behavior tests, so the later shell and surfaces compose a tested kit instead of ad-hoc markup.

**Architecture:** A new pure-UI package `@coa/console-ui` owns the design tokens (relocated from `apps/desktop`) and the component library. Components wrap Radix headless primitives for the accessibility floor, style themselves with Tailwind utilities that read the CSS-var tokens through a package-shipped `@theme inline` map, and express every feedback state as a `data-*` attribute so behavior is assertable in jsdom without a running Tailwind. Each component colocates a typed `ComponentIntent` object; a presence test forbids merging a component without one, and a generator compiles all intents into a diff-checked `COMPONENTS.md` catalogue — the single doc a human or agent reads to pick a component.

**Tech Stack:** TypeScript 6 (strict) · React 19 · `radix-ui` (umbrella headless primitives) · `lucide-react` (icons) · Tailwind v4 (configured from tokens) · Vitest 4 + jsdom + `@testing-library/react` · `tsdown` (bundler) · pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-30-console-frontend-foundation-design.md` — §7 (component families + intent contract), §5 + §5.1 (principles P1–P12 + the 16 composition principles), §6 (tokens), §8 (motion + feedback contract), §14 (anti-slop charter), §15 (accessibility floor), §4 (stack). The three Plan-2 decisions locked in brainstorming and recorded here: (1) a new `packages/console-ui` owning tokens + components (spec §7 "a single packages/ui"); (2) the intent contract is a typed colocated export enforced for **presence + completeness only** (correctness stays a review judgment) plus a generated catalogue; (3) the full six-family kit, sequenced behind a proof slice. Dense/Viz (P11) and AppShell/layout are **out of scope** (Plan 3+).

## Global Constraints

_Every task's requirements implicitly include this section._

- **TypeScript `strict`, no `any`.** The new package extends `tsconfig.base.json` (composite, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Use `import type` for type-only imports (`consistent-type-imports` is an error).
- **Node ≥ 22.20.0 · pnpm 11.9.0** — invoke pnpm as `pnpm_config_verify_deps_before_run=false corepack pnpm …` (bare `pnpm` is not on PATH; the release-age pre-check must be disabled per the environment note). The composite `pnpm check` script is broken here — run each gate individually.
- **Gates (all pass before each commit):** `corepack pnpm typecheck` · `corepack pnpm lint` · `corepack pnpm format` · `corepack pnpm test` · `corepack pnpm depcruise`. `format` is a check; fix with `corepack pnpm exec prettier --write <files>`. Run a single test file from the **repo root**: `corepack pnpm exec vitest run <path>`.
- **Supply-chain hygiene.** New deps install with `--ignore-scripts` (default). Any dep newer than the minimum-release-age window is added to `pnpm-workspace.yaml` → `minimumReleaseAgeExclude` as `name@version` (mirror the existing entries) and the install re-run. `radix-ui`, `lucide-react`, and the `@testing-library/*` + `jsdom` devDeps will likely need entries.
- **Pure-UI package.** `@coa/console-ui` imports only React, `radix-ui`, `lucide-react`, and its own modules — **never** `electron` or `@coa/core` (enforced by a dependency-cruiser rule added in Task 1). It is consumed by the sandboxed renderer, so it inherits the renderer-isolation floor.
- **Byte-faithful / no emoji.** No emoji in any component string, label, icon, intent text, empty-state, or catalogue. Renders show bytes as-is; no silent truncation.
- **Accessibility floor (§15).** Radix supplies keyboard/focus/ARIA; every focusable control shows a **real `outline`** focus ring (`focus-visible`, 2px, 2px offset — survives Windows High-Contrast; box-shadow does not). Never encode state by color alone — pair with an icon/shape/label.
- **Feedback contract (§8).** Every interactive component expresses the applicable subset of rest / hover / active / focus / loading / disabled / error / success, each surfaced as a `data-*` attribute or ARIA state so it is testable. Animate `transform`/`opacity` only.
- **SC-1 — help, never cage.** The console adds **no block**. `DenyNotice` (Task 7) only *surfaces* the two real blocks (M3 close-gate, M7 cost-cap) from typed data; it never invents a deny, gates an action, or blocks input.
- **Commits:** subject-only Conventional Commits — **no body, no trailers, no `Co-Authored-By`/"Generated with", no internal identifiers** (no `M10`, `P3`, `SC-1`, decision codes) in the subject. Stage files **by name** (never `git add -A`). One logical unit per commit.
- **Same-commit doc rule.** Task 1 (adds the package) updates `docs/REPO_LAYOUT.md` and `.dependency-cruiser.cjs` in the **same** commit.

---

## File Structure

```
packages/console-ui/                     NEW · @coa/console-ui
  package.json · tsconfig.json · tsdown.config.ts
  src/index.ts                           barrel: tokens + all components + intent types
  src/theme.css                          @theme inline map: Tailwind utilities → CSS-var tokens (Task 4)
  src/tokens/                            RELOCATED from apps/desktop/src/tokens (Task 1)
    palette.ts · semantic.ts · tokens.ts · tokens.test.ts
  src/lib/
    cx.ts                                cx() classname join + shared style fragments (focusRing) (Task 4)
    cx.test.ts
    intent.ts                            ComponentIntent type + assertIntent helper (Task 3)
    intent.test.ts
    catalog.ts                           generateCatalog(intents) → markdown (Task 3)
    catalog.test.ts
  src/icon/
    Icon.tsx · Icon.intent.ts · Icon.test.tsx                                    (Task 4)
  src/actions/
    Button.tsx · Button.intent.ts · Button.test.tsx                              (Task 5)
    IconButton.tsx · ButtonGroup.tsx · Link.tsx · Menu.tsx  (+ .intent.ts/.test.tsx)  (Task 8)
  src/inputs/
    Field.tsx · TextField.tsx  (+ .intent.ts/.test.tsx)                          (Task 6)
    Checkbox.tsx · Radio.tsx · Switch.tsx  (+ .intent.ts/.test.tsx)              (Task 9)
    Select.tsx · Combobox.tsx  (+ .intent.ts/.test.tsx)                          (Task 10)
  src/layout/
    Divider.tsx · Toolbar.tsx · Pane.tsx · NavList.tsx  (+ .intent.ts/.test.tsx) (Task 11)
  src/data/
    Table.tsx · List.tsx · KeyValue.tsx  (+ .intent.ts/.test.tsx)                (Task 12)
    Code.tsx · Badge.tsx · Stat.tsx  (+ .intent.ts/.test.tsx)                    (Task 13)
  src/feedback/
    Banner.tsx · DenyNotice.tsx  (+ .intent.ts/.test.tsx)                        (Task 7)
    Toast.tsx · InlineMessage.tsx · Spinner.tsx · Skeleton.tsx · EmptyState.tsx  (Task 14)
  src/overlays/
    Dialog.tsx · Popover.tsx · Tooltip.tsx · Sheet.tsx  (+ .intent.ts/.test.tsx) (Task 15)
  src/registry.ts                        allIntents[] barrel feeding catalogue + coverage test (grows per task)
  COMPONENTS.md                          GENERATED catalogue (diff-checked) (Task 3, regen each task)

apps/desktop/
  src/tokens/                            DELETED (moved to the package) (Task 1)
  src/renderer/main.tsx                  MODIFY · import tokensToCss from '@coa/console-ui' (Task 1)
  src/renderer/globals.css               MODIFY · @import tailwind + '@coa/console-ui/theme.css' + @source (Task 4)
  electron.vite.config.ts                MODIFY · vite alias '@coa/console-ui' → package src (Task 1)
  tsconfig.json                          MODIFY · add reference to packages/console-ui (Task 1)
  package.json                           MODIFY · add '@coa/console-ui': workspace:* (Task 1)

vitest.config.ts                         MODIFY · alias + .tsx include + react plugin + jsdom setup (Tasks 1,2)
vitest.setup.ts                          NEW · @testing-library/jest-dom + RTL cleanup (Task 2)
tsconfig.json (root)                     MODIFY · add reference to packages/console-ui (Task 1)
.dependency-cruiser.cjs                  MODIFY · console-ui-no-electron-core rule (Task 1)
docs/REPO_LAYOUT.md                      MODIFY · logical→physical map + dependency-rule note (Task 1)
```

---

### Task 1: Stand up `packages/console-ui` by relocating the token system

**Files:**
- Create: `packages/console-ui/package.json`, `packages/console-ui/tsconfig.json`, `packages/console-ui/tsdown.config.ts`, `packages/console-ui/src/index.ts`
- Move (verbatim): `apps/desktop/src/tokens/{palette.ts,semantic.ts,tokens.ts,tokens.test.ts}` → `packages/console-ui/src/tokens/` (keep `import './palette.js'` relative paths unchanged — they still resolve)
- Delete: `apps/desktop/src/tokens/` (now empty)
- Modify: `apps/desktop/src/renderer/main.tsx`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/tsconfig.json`, `apps/desktop/package.json`, root `tsconfig.json`, `vitest.config.ts`, `.dependency-cruiser.cjs`, `docs/REPO_LAYOUT.md`

**Interfaces:**
- Produces: `@coa/console-ui` barrel re-exporting `resolveTokens`, `tokensToCss`, `SEMANTIC_TOKEN_NAMES`, `type Theme`, `type Density`. Later tasks import components from the same barrel.

- [ ] **Step 1: Create the package manifest**

`packages/console-ui/package.json`:
```json
{
  "name": "@coa/console-ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./theme.css": "./src/theme.css"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "src/theme.css"],
  "scripts": { "build": "tsdown", "typecheck": "tsc -b" },
  "peerDependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" },
  "dependencies": { "lucide-react": "^0.400.0", "radix-ui": "^1.1.0" },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```
(If pnpm resolves a newer `radix-ui`/`lucide-react`, update these ranges to the resolved majors; both are runtime-scriptless.)

- [ ] **Step 2: TypeScript + bundler config**

`packages/console-ui/tsconfig.json`:
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
`packages/console-ui/tsdown.config.ts`:
```ts
import { defineConfig } from 'tsdown';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  unbundle: true,
  fixedExtension: false,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
});
```

- [ ] **Step 3: Move the token files verbatim + barrel**

Move `palette.ts`, `semantic.ts`, `tokens.ts`, `tokens.test.ts` from `apps/desktop/src/tokens/` into `packages/console-ui/src/tokens/` unchanged. Then delete the now-empty `apps/desktop/src/tokens/` directory.

`packages/console-ui/src/index.ts`:
```ts
export * from './tokens/tokens.js';
```

- [ ] **Step 4: Wire the workspace (deps, aliases, references)**

Add to `apps/desktop/package.json` `dependencies`: `"@coa/console-ui": "workspace:*"`.

`apps/desktop/src/renderer/main.tsx` — change the token import:
```tsx
import { tokensToCss } from '@coa/console-ui';
```
(remove the old `import { tokensToCss } from '../tokens/tokens.js';`)

`apps/desktop/electron.vite.config.ts` — add a renderer alias so the app consumes the package **source** (HMR, no prebuild):
```ts
import { fileURLToPath } from 'node:url';
// … inside defineConfig, replace the renderer block:
  renderer: {
    root: 'src/renderer',
    build: { outDir: 'dist/renderer' },
    plugins: [react(), tailwind()],
    resolve: {
      alias: {
        '@coa/console-ui': fileURLToPath(new URL('../../packages/console-ui/src/index.ts', import.meta.url)),
      },
    },
  },
```

`apps/desktop/tsconfig.json` — add `{ "path": "../../packages/console-ui" }` to `references`.

Root `tsconfig.json` — add `{ "path": "packages/console-ui" }` to `references` (before `apps/cli`).

`vitest.config.ts` — add to `workspaceAlias`:
```ts
  '@coa/console-ui': fileURLToPath(new URL('./packages/console-ui/src/index.ts', import.meta.url)),
```

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm install`
(If blocked on minimum-release-age, add the exact `name@version` to `pnpm-workspace.yaml` → `minimumReleaseAgeExclude` and re-run.)

- [ ] **Step 5: Add the dependency-cruiser rule + docs (same commit)**

In `.dependency-cruiser.cjs` `forbidden`, add after the `viewmodel-no-electron-react` rule:
```js
{
  name: 'console-ui-no-electron-core',
  severity: 'error',
  comment:
    'The UI kit is a pure renderer-side library; it never imports electron or the daemon core (only react/radix/lucide).',
  from: { path: '^packages/console-ui/src' },
  to: { path: 'node_modules/electron/|^packages/core/' },
},
```
In `docs/REPO_LAYOUT.md`: under the top-level tree add a `console-ui/` row beside `console-viewmodel/`:
```
    console-ui/              M10 — @coa/console-ui (design tokens + the component kit; pure react/radix, no electron/core)
```
Update the `desktop/` row note to drop "tokens" (they moved): `… main pipe-client, isolated renderer` . Add one line under the dependency-rule notes: "`console-ui` imports only react/radix/lucide — never electron/core (enforced: `console-ui-no-electron-core`)." Update the `_Last reviewed_` footer date to 2026-06-30.

- [ ] **Step 6: Verify the move + gates**

Run: `corepack pnpm exec vitest run packages/console-ui/src/tokens/tokens.test.ts`
Expected: PASS (3 tests) at the new path.
Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass (app typechecks against the relocated tokens; depcruise clean).
Run: `corepack pnpm exec prettier --write "packages/console-ui/**/*.{ts,json}" "apps/desktop/**/*.{ts,tsx}" .dependency-cruiser.cjs docs/REPO_LAYOUT.md vitest.config.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format`
Expected: pass.
Run (optional boot check, manual): `pnpm_config_verify_deps_before_run=false corepack pnpm --filter @coa/desktop exec electron-vite build` — builds with the aliased package.

- [ ] **Step 7: Commit**

```bash
git add packages/console-ui apps/desktop/src/renderer/main.tsx apps/desktop/electron.vite.config.ts apps/desktop/tsconfig.json apps/desktop/package.json tsconfig.json vitest.config.ts .dependency-cruiser.cjs docs/REPO_LAYOUT.md pnpm-workspace.yaml pnpm-lock.yaml
git rm -r apps/desktop/src/tokens
git commit -m "refactor: extract the console design tokens into a shared ui package"
```

---

### Task 2: Component test environment (jsdom + Testing Library)

**Files:**
- Create: `vitest.setup.ts`
- Modify: `vitest.config.ts`
- Add devDeps to `packages/console-ui/package.json`: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `@vitejs/plugin-react`

**Interfaces:**
- Produces: a jsdom render environment for `*.test.tsx` files (opted-in per file via the `@vitest-environment jsdom` docblock), `@testing-library/jest-dom` matchers globally, and RTL auto-cleanup. Every later component test relies on this.

- [ ] **Step 1: Install the test deps**

Add to `packages/console-ui/package.json` `devDependencies`:
```json
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@testing-library/jest-dom": "^6.4.0",
    "jsdom": "^25.0.0",
    "@vitejs/plugin-react": "^4.7.0"
```
Run: `pnpm_config_verify_deps_before_run=false corepack pnpm install` (add any release-age-blocked `name@version` to `minimumReleaseAgeExclude` and re-run).

- [ ] **Step 2: Wire vitest — react plugin, .tsx tests, setup file**

`vitest.setup.ts` (includes the jsdom polyfills Radix's pointer-driven primitives — Select, DropdownMenu, overlays — require; without them their tests throw `hasPointerCapture is not a function` / `scrollIntoView is not a function`):
```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom lacks these; Radix primitives call them during pointer interactions.
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

afterEach(() => {
  cleanup();
});
```
(The guards run in the node environment too, but `Element` is undefined there, so the `if` skips them.)
`vitest.config.ts` — add the react plugin, the setup file, and `.tsx` to the include globs:
```ts
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// … workspaceAlias unchanged …

export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceAlias },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'packages/*/test/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.tsx',
    ],
  },
});
```
(The default environment stays `node`; component tests opt into jsdom per file. The setup file only augments `expect` and registers cleanup — harmless for the existing node-env tests.)

- [ ] **Step 3: Write a smoke render test that proves the environment**

`packages/console-ui/src/lib/smoke.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('component test environment', () => {
  it('renders JSX into jsdom and exposes jest-dom matchers', () => {
    render(<button type="button">ok</button>);
    expect(screen.getByRole('button', { name: 'ok' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the smoke test**

Run: `corepack pnpm exec vitest run packages/console-ui/src/lib/smoke.test.tsx`
Expected: PASS (1 test) — confirms jsdom env, JSX transform, RTL, and jest-dom all work.
Run the full suite to confirm no regression: `pnpm_config_verify_deps_before_run=false corepack pnpm test`
Expected: all existing tests still pass (648 + 1).

- [ ] **Step 5: Delete the smoke test, gates + commit**

Delete `packages/console-ui/src/lib/smoke.test.tsx` (it was proof-of-wiring; the real component tests replace it).
Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && corepack pnpm exec prettier --write vitest.config.ts vitest.setup.ts packages/console-ui/package.json && pnpm_config_verify_deps_before_run=false corepack pnpm format`
Expected: pass.
```bash
git add vitest.config.ts vitest.setup.ts packages/console-ui/package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "test: add a jsdom component render environment"
```

---

### Task 3: Intent contract infrastructure + catalogue generator (TDD)

**Files:**
- Create: `packages/console-ui/src/lib/intent.ts`, `packages/console-ui/src/lib/intent.test.ts`, `packages/console-ui/src/lib/catalog.ts`, `packages/console-ui/src/lib/catalog.test.ts`, `packages/console-ui/src/registry.ts`
- Modify: `packages/console-ui/src/index.ts` (export the intent type)

**Interfaces:**
- Produces: `interface ComponentIntent { name; family; intent; useWhen: string[]; dontUseWhen: string[]; anatomy; variantsStates: string[]; accessibility; related: string[] }`; `assertIntent(i: ComponentIntent): ComponentIntent` (runtime completeness guard — throws on any empty field); `generateCatalog(intents: ComponentIntent[]): string` (deterministic markdown); `allIntents: ComponentIntent[]` (the registry barrel, grows one entry per component). Every component task appends its intent to `registry.ts` and asserts coverage.

- [ ] **Step 1: Write the failing intent test**

`packages/console-ui/src/lib/intent.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { assertIntent, type ComponentIntent } from './intent.js';

const valid: ComponentIntent = {
  name: 'Button',
  family: 'Actions',
  intent: 'Triggers the primary action of a view.',
  useWhen: ['A user commits an action (submit, confirm, run).'],
  dontUseWhen: ['Navigating between locations — use Link.'],
  anatomy: 'Optional leading icon, label, optional trailing icon.',
  variantsStates: ['primary', 'rest/hover/active/focus/loading/disabled'],
  accessibility: 'Native <button>; Enter/Space activate; visible focus ring.',
  related: ['IconButton', 'Link'],
};

describe('assertIntent', () => {
  it('returns a fully-populated intent unchanged', () => {
    expect(assertIntent(valid)).toBe(valid);
  });

  it('throws when a string field is empty', () => {
    expect(() => assertIntent({ ...valid, intent: '' })).toThrow(/intent/i);
  });

  it('throws when a list field is empty', () => {
    expect(() => assertIntent({ ...valid, useWhen: [] })).toThrow(/useWhen/i);
  });

  it('throws when a list entry is blank', () => {
    expect(() => assertIntent({ ...valid, related: ['  '] })).toThrow(/related/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm exec vitest run packages/console-ui/src/lib/intent.test.ts`
Expected: FAIL — cannot resolve `./intent.js`.

- [ ] **Step 3: Implement the intent type + guard**

`packages/console-ui/src/lib/intent.ts`:
```ts
/** The per-component usage declaration. Presence + completeness are enforced;
 *  correctness is a review judgment. All intents compile into COMPONENTS.md. */
export interface ComponentIntent {
  /** Component export name, e.g. 'Button'. */
  name: string;
  /** Family bucket, e.g. 'Actions'. */
  family: string;
  /** One sentence: what it is for. */
  intent: string;
  /** When to reach for it. */
  useWhen: string[];
  /** When NOT to — the governance lever. */
  dontUseWhen: string[];
  /** Parts it is composed of. */
  anatomy: string;
  /** Variants and the feedback-contract states it expresses. */
  variantsStates: string[];
  /** Keyboard model, focus, labelling. */
  accessibility: string;
  /** Which components to consider instead. */
  related: string[];
}

const STRING_FIELDS = ['name', 'family', 'intent', 'anatomy', 'accessibility'] as const;
const LIST_FIELDS = ['useWhen', 'dontUseWhen', 'variantsStates', 'related'] as const;

/** Throws unless every field is present and non-blank. */
export function assertIntent(i: ComponentIntent): ComponentIntent {
  for (const f of STRING_FIELDS) {
    if (i[f].trim() === '') throw new Error(`ComponentIntent.${f} must not be empty (${i.name || '?'})`);
  }
  for (const f of LIST_FIELDS) {
    if (i[f].length === 0) throw new Error(`ComponentIntent.${f} must not be empty (${i.name})`);
    if (i[f].some((e) => e.trim() === '')) throw new Error(`ComponentIntent.${f} has a blank entry (${i.name})`);
  }
  return i;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm exec vitest run packages/console-ui/src/lib/intent.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing catalogue test**

`packages/console-ui/src/lib/catalog.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { generateCatalog } from './catalog.js';
import type { ComponentIntent } from './intent.js';

const a: ComponentIntent = {
  name: 'Button', family: 'Actions', intent: 'Triggers an action.',
  useWhen: ['Committing an action.'], dontUseWhen: ['Navigating — use Link.'],
  anatomy: 'Icon + label.', variantsStates: ['primary', 'disabled'],
  accessibility: 'Native button.', related: ['Link'],
};
const b: ComponentIntent = {
  name: 'Banner', family: 'Feedback', intent: 'Persistent status.',
  useWhen: ['A condition persists.'], dontUseWhen: ['Transient — use Toast.'],
  anatomy: 'Icon + message.', variantsStates: ['info', 'danger'],
  accessibility: 'role=status.', related: ['Toast'],
};

describe('generateCatalog', () => {
  it('groups by family with a stable heading and orders deterministically', () => {
    const md = generateCatalog([b, a]);
    expect(md).toContain('## Actions');
    expect(md).toContain('## Feedback');
    // families alphabetical, components alphabetical within a family
    expect(md.indexOf('## Actions')).toBeLessThan(md.indexOf('## Feedback'));
    expect(md).toContain('### Button');
    expect(md).toContain("Don't use it when");
  });

  it('is idempotent for the same input', () => {
    expect(generateCatalog([a, b])).toBe(generateCatalog([b, a]));
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `corepack pnpm exec vitest run packages/console-ui/src/lib/catalog.test.ts`
Expected: FAIL — cannot resolve `./catalog.js`.

- [ ] **Step 7: Implement the generator + empty registry**

`packages/console-ui/src/lib/catalog.ts`:
```ts
import type { ComponentIntent } from './intent.js';

/** Deterministic markdown catalogue: families alphabetical, components alphabetical within. */
export function generateCatalog(intents: ComponentIntent[]): string {
  const families = [...new Set(intents.map((i) => i.family))].sort((x, y) => x.localeCompare(y));
  const lines: string[] = ['# Component catalogue', '', '_Generated from each component\'s intent declaration. Do not edit by hand._', ''];
  for (const family of families) {
    lines.push(`## ${family}`, '');
    const members = intents.filter((i) => i.family === family).sort((x, y) => x.name.localeCompare(y.name));
    for (const c of members) {
      lines.push(`### ${c.name}`, '');
      lines.push(c.intent, '');
      lines.push('- **Use it when:** ' + c.useWhen.join(' '));
      lines.push("- **Don't use it when:** " + c.dontUseWhen.join(' '));
      lines.push('- **Anatomy:** ' + c.anatomy);
      lines.push('- **Variants & states:** ' + c.variantsStates.join(', '));
      lines.push('- **Accessibility:** ' + c.accessibility);
      lines.push('- **Related:** ' + c.related.join(', '));
      lines.push('');
    }
  }
  return lines.join('\n');
}
```
`packages/console-ui/src/registry.ts`:
```ts
import type { ComponentIntent } from './lib/intent.js';

/** Every component appends its intent here. Feeds COMPONENTS.md + the coverage test. */
export const allIntents: ComponentIntent[] = [];
```
`packages/console-ui/src/index.ts` — add:
```ts
export type { ComponentIntent } from './lib/intent.js';
```

- [ ] **Step 8: Run it to verify it passes**

Run: `corepack pnpm exec vitest run packages/console-ui/src/lib/catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec prettier --write "packages/console-ui/src/**/*.ts" && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/lib/intent.ts packages/console-ui/src/lib/intent.test.ts packages/console-ui/src/lib/catalog.ts packages/console-ui/src/lib/catalog.test.ts packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the component intent contract and catalogue generator"
```

---

### Task 4: Tailwind-from-tokens map, class helper, and the Icon wrapper (TDD)

**Files:**
- Create: `packages/console-ui/src/theme.css`, `packages/console-ui/src/lib/cx.ts`, `packages/console-ui/src/lib/cx.test.ts`, `packages/console-ui/src/icon/Icon.tsx`, `packages/console-ui/src/icon/Icon.intent.ts`, `packages/console-ui/src/icon/Icon.test.tsx`
- Modify: `packages/console-ui/src/tokens/palette.ts`, `packages/console-ui/src/tokens/semantic.ts` (extend with the component-consumed semantic tokens), `packages/console-ui/src/registry.ts` (append Icon intent), `packages/console-ui/src/index.ts` (export cx, Icon), `apps/desktop/src/renderer/globals.css` (import the theme + `@source`)

**Interfaces:**
- Consumes: `assertIntent` (Task 3), Lucide icon components.
- Produces: `cx(...parts): string`; `focusRing` (shared focus-visible utility string); `<Icon name={LucideIcon} size? label? />` (decorative by default → `aria-hidden`; labelled → `role="img"` + `aria-label`). Every component imports `cx`/`focusRing` and uses `Icon` for glyphs.

- [ ] **Step 1: Extend the semantic tokens the components need**

`packages/console-ui/src/tokens/palette.ts` — add inside the object (keep existing keys):
```ts
  brassHover: '#d4ab52',
  onBrass: '#1b1207',
  elementHover: '#362a22',
  elementActive: '#41322a',
  focus: '#c39a3e',
  selection: '#c39a3e33',
  dangerTint: '#3a1f1a', dangerText: '#e8a597',
  warningTint: '#332715', warningText: '#e6c489',
  successTint: '#1e2a1c', successText: '#a8c39a',
  info: '#5b7fb0', infoTint: '#1b2733', infoText: '#9fc0e6',
  // light-theme companions (starter values, tuned later)
  brassInkHover: '#75581a', onBrassLight: '#fbf6ec',
  elementHoverLight: '#ded2bf', elementActiveLight: '#d3c4ac',
  focusLight: '#8a6a1f', selectionLight: '#8a6a1f2e',
  dangerTintLight: '#f6e0da', dangerTextLight: '#8a2c1d',
  warningTintLight: '#f6ead2', warningTextLight: '#7a5410',
  successTintLight: '#e2ecdc', successTextLight: '#3e5730',
  infoLight: '#3f6aa0', infoTintLight: '#dde8f4', infoTextLight: '#274a73',
```
`packages/console-ui/src/tokens/semantic.ts` — add these keys to **both** the `dark` and `light` maps (dark uses the first set, light the `*Light` set), so `SEMANTIC_TOKEN_NAMES` (derived from `dark`) resolves in both themes:
```ts
// add to `dark`:
  '--color-bg-element': palette.brown2,
  '--color-bg-element-hover': palette.elementHover,
  '--color-bg-element-active': palette.elementActive,
  '--color-accent-hover': palette.brassHover,
  '--color-fg-on-accent': palette.onBrass,
  '--color-focus-ring': palette.focus,
  '--color-selection': palette.selection,
  '--color-danger-tint': palette.dangerTint, '--color-danger-text': palette.dangerText,
  '--color-warning-tint': palette.warningTint, '--color-warning-text': palette.warningText,
  '--color-success-tint': palette.successTint, '--color-success-text': palette.successText,
  '--color-info': palette.info, '--color-info-tint': palette.infoTint, '--color-info-text': palette.infoText,
// add to `light` (same keys, light values):
  '--color-bg-element': palette.paper2,
  '--color-bg-element-hover': palette.elementHoverLight,
  '--color-bg-element-active': palette.elementActiveLight,
  '--color-accent-hover': palette.brassInkHover,
  '--color-fg-on-accent': palette.onBrassLight,
  '--color-focus-ring': palette.focusLight,
  '--color-selection': palette.selectionLight,
  '--color-danger-tint': palette.dangerTintLight, '--color-danger-text': palette.dangerTextLight,
  '--color-warning-tint': palette.warningTintLight, '--color-warning-text': palette.warningTextLight,
  '--color-success-tint': palette.successTintLight, '--color-success-text': palette.successTextLight,
  '--color-info': palette.infoLight, '--color-info-tint': palette.infoTintLight, '--color-info-text': palette.infoTextLight,
```
Run: `corepack pnpm exec vitest run packages/console-ui/src/tokens/tokens.test.ts`
Expected: PASS — the existing "every semantic token resolves in both themes" test now covers the new tokens (both maps have them).

- [ ] **Step 2: Ship the Tailwind `@theme inline` map**

`packages/console-ui/src/theme.css` (mapping only — the app owns `@import 'tailwindcss'`; `inline` makes utilities reference the runtime `var(--…)`, so theme switching still works and there is no duplicate `:root` emission):
```css
@theme inline {
  --color-base: var(--color-bg-base);
  --color-subtle: var(--color-bg-subtle);
  --color-surface: var(--color-bg-surface);
  --color-raised: var(--color-bg-raised);
  --color-element: var(--color-bg-element);
  --color-element-hover: var(--color-bg-element-hover);
  --color-element-active: var(--color-bg-element-active);
  --color-border-default: var(--color-border);
  --color-hairline: var(--color-hairline);
  --color-fg: var(--color-fg-default);
  --color-muted: var(--color-fg-muted);
  --color-faint: var(--color-fg-faint);
  --color-on-accent: var(--color-fg-on-accent);
  --color-accent: var(--color-accent);
  --color-accent-hover: var(--color-accent-hover);
  --color-danger: var(--color-danger);
  --color-danger-tint: var(--color-danger-tint);
  --color-danger-text: var(--color-danger-text);
  --color-warning: var(--color-warning);
  --color-warning-tint: var(--color-warning-tint);
  --color-warning-text: var(--color-warning-text);
  --color-success: var(--color-success);
  --color-success-tint: var(--color-success-tint);
  --color-success-text: var(--color-success-text);
  --color-info: var(--color-info);
  --color-info-tint: var(--color-info-tint);
  --color-info-text: var(--color-info-text);
  --color-focus: var(--color-focus-ring);
  --color-selection: var(--color-selection);
  --radius-control: 4px;
  --radius-surface: 6px;
  --radius-overlay: 8px;
}
```
`apps/desktop/src/renderer/globals.css` — import the map and register the package as a Tailwind source (so its class names are scanned):
```css
@import 'tailwindcss';
@import '@coa/console-ui/theme.css';
@source '../../../../packages/console-ui/src';

:root {
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
}
body { margin: 0; background: var(--color-bg-base); color: var(--color-fg-default); }
```
(The `@source` path is relative to `globals.css`. Verify the depth when wiring: from `apps/desktop/src/renderer/` to `packages/console-ui/src` — adjust the `../` count if the build reports no utilities generated for the package.)

- [ ] **Step 3: Write the failing cx test**

`packages/console-ui/src/lib/cx.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cx, focusRing } from './cx.js';

describe('cx', () => {
  it('joins truthy parts and drops falsy ones', () => {
    expect(cx('a', false, undefined, 'b', null, '')).toBe('a b');
  });
  it('focusRing targets a real outline with the focus-ring token', () => {
    expect(focusRing).toContain('focus-visible:outline');
    expect(focusRing).toContain('outline-focus');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `corepack pnpm exec vitest run packages/console-ui/src/lib/cx.test.ts`
Expected: FAIL — cannot resolve `./cx.js`.

- [ ] **Step 5: Implement cx + focusRing**

`packages/console-ui/src/lib/cx.ts`:
```ts
/** Join class fragments; drop falsy. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(' ');
}

/** Shared visible focus ring — a real outline (survives Windows High-Contrast), :focus-visible only. */
export const focusRing =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
```

- [ ] **Step 6: Write the failing Icon test**

`packages/console-ui/src/icon/Icon.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Check } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon.js';

describe('Icon', () => {
  it('is decorative (aria-hidden) by default', () => {
    const { container } = render(<Icon name={Check} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
  it('is a labelled image when given a label', () => {
    render(<Icon name={Check} label="Done" />);
    const img = screen.getByRole('img', { name: 'Done' });
    expect(img).toBeInTheDocument();
    expect(img).not.toHaveAttribute('aria-hidden');
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `corepack pnpm exec vitest run packages/console-ui/src/icon/Icon.test.tsx`
Expected: FAIL — cannot resolve `./Icon.js`.

- [ ] **Step 8: Implement Icon + its intent, register it**

`packages/console-ui/src/icon/Icon.tsx`:
```tsx
import type { LucideIcon } from 'lucide-react';

export interface IconProps {
  /** A Lucide icon component. */
  name: LucideIcon;
  /** Pixel size (default 16, snapped to the icon grid). */
  size?: number;
  /** If provided, the icon is meaningful and announced; otherwise it is decorative. */
  label?: string;
  className?: string;
}

/** The one wrapped icon. Consistent stroke + size; decorative unless labelled. */
export function Icon({ name: Glyph, size = 16, label, className }: IconProps): React.JSX.Element {
  return label !== undefined ? (
    <Glyph size={size} strokeWidth={2} role="img" aria-label={label} className={className} />
  ) : (
    <Glyph size={size} strokeWidth={2} aria-hidden className={className} focusable={false} />
  );
}
```
`packages/console-ui/src/icon/Icon.intent.ts`:
```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const iconIntent: ComponentIntent = assertIntent({
  name: 'Icon',
  family: 'Foundations',
  intent: 'Renders a single Lucide glyph at a consistent stroke and grid size.',
  useWhen: ['A glyph reinforces a label, status, or action.'],
  dontUseWhen: ['A glyph would stand alone as the only meaning — pair it with text.', 'You need an emoji — emoji are banned.'],
  anatomy: 'A Lucide icon component sized to the icon grid.',
  variantsStates: ['decorative (aria-hidden)', 'labelled (role=img)'],
  accessibility: 'Decorative by default (aria-hidden, not focusable); pass label to announce it as an image.',
  related: ['IconButton', 'Badge'],
});
```
`packages/console-ui/src/registry.ts` — import and push:
```ts
import { iconIntent } from './icon/Icon.intent.js';
// …
export const allIntents: ComponentIntent[] = [iconIntent];
```
`packages/console-ui/src/index.ts` — add:
```ts
export { cx, focusRing } from './lib/cx.js';
export { Icon, type IconProps } from './icon/Icon.js';
```

- [ ] **Step 9: Run the Icon + cx tests**

Run: `corepack pnpm exec vitest run packages/console-ui/src/icon/Icon.test.tsx packages/console-ui/src/lib/cx.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 10: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec prettier --write "packages/console-ui/src/**/*.{ts,tsx,css}" "apps/desktop/src/renderer/globals.css" && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/theme.css packages/console-ui/src/lib/cx.ts packages/console-ui/src/lib/cx.test.ts packages/console-ui/src/icon packages/console-ui/src/tokens/palette.ts packages/console-ui/src/tokens/semantic.ts packages/console-ui/src/registry.ts packages/console-ui/src/index.ts apps/desktop/src/renderer/globals.css
git commit -m "feat: map tailwind utilities to tokens and add the icon wrapper"
```

---

### Task 5: Button — the proof component (TDD)

**Files:**
- Create: `packages/console-ui/src/actions/Button.tsx`, `packages/console-ui/src/actions/Button.intent.ts`, `packages/console-ui/src/actions/Button.test.tsx`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `cx`, `focusRing`, `Icon`, `assertIntent`. `radix-ui` `Slot` for polymorphism.
- Produces: `type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger'`; `type ButtonSize = 'sm' | 'md'`; `<Button variant? size? loading? asChild? …buttonProps />`. Establishes the canonical component pattern (variant record + `data-*` state contract + intent + tests) every later component copies.

- [ ] **Step 1: Write the failing Button test**

`packages/console-ui/src/actions/Button.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.js';

describe('Button', () => {
  it('renders a native button with the primary variant by default', () => {
    render(<Button>Run</Button>);
    const btn = screen.getByRole('button', { name: 'Run' });
    expect(btn).toHaveAttribute('data-variant', 'primary');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('reflects the requested variant', () => {
    render(<Button variant="danger">Stop</Button>);
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveAttribute('data-variant', 'danger');
  });

  it('exposes loading as a data flag, disables interaction, and marks busy', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Run</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-loading', 'true');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
  });

  it('does not fire onClick while disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Run</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires onClick when enabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Run</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders as its child element when asChild is set (polymorphism)', () => {
    render(<Button asChild><a href="/x">Go</a></Button>);
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).toHaveAttribute('data-variant', 'primary');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm exec vitest run packages/console-ui/src/actions/Button.test.tsx`
Expected: FAIL — cannot resolve `./Button.js`.

- [ ] **Step 3: Implement Button**

`packages/console-ui/src/actions/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Slot } from 'radix-ui';
import { cx, focusRing } from '../lib/cx.js';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a busy state and blocks interaction. */
  loading?: boolean;
  /** Render as the single child element (e.g. an anchor) instead of <button>. */
  asChild?: boolean;
  children?: ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-control border font-medium select-none ' +
  'transition-[background-color,border-color,color] duration-fast disabled:opacity-50 disabled:pointer-events-none';

const bySize: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-[12px]',
  md: 'h-7 px-3 text-[13px]',
};

const byVariant: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent border-transparent hover:bg-accent-hover active:bg-accent-hover',
  secondary: 'bg-element text-fg border-border-default hover:bg-element-hover active:bg-element-active',
  tertiary: 'bg-transparent text-fg border-transparent hover:bg-element-hover active:bg-element-active',
  danger: 'bg-danger text-on-accent border-transparent hover:opacity-90 active:opacity-100',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  asChild = false,
  disabled,
  type,
  className,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  const Comp = asChild ? Slot.Root : 'button';
  const isDisabled = disabled === true || loading;
  return (
    <Comp
      // native <button> gets a type; a Slot child (e.g. anchor) must not receive one
      {...(asChild ? {} : { type: type ?? 'button' })}
      data-variant={variant}
      data-size={size}
      data-loading={loading ? 'true' : undefined}
      aria-busy={loading || undefined}
      disabled={asChild ? undefined : isDisabled}
      data-disabled={isDisabled ? 'true' : undefined}
      className={cx(base, bySize[size], byVariant[variant], focusRing, className)}
      {...rest}
    >
      {children}
    </Comp>
  );
}
```
(Note: with `asChild`, the child element carries the styling via `Slot`; `disabled`/`type` are not forwarded to a non-button element — the `data-disabled` flag records intent for styling/tests.)

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm exec vitest run packages/console-ui/src/actions/Button.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the intent + register + export**

`packages/console-ui/src/actions/Button.intent.ts`:
```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const buttonIntent: ComponentIntent = assertIntent({
  name: 'Button',
  family: 'Actions',
  intent: 'Triggers an action the user commits to.',
  useWhen: ['Submitting, confirming, running, or cancelling an action.', 'A view has one primary action (use variant=primary once).'],
  dontUseWhen: ['Navigating to another location — use Link.', 'Toggling a boolean — use Switch or Checkbox.', 'The trigger is icon-only in a dense toolbar — use IconButton.'],
  anatomy: 'Optional leading Icon, label, optional trailing Icon; one border-box control.',
  variantsStates: ['primary', 'secondary', 'tertiary', 'danger', 'sizes sm/md', 'rest', 'hover', 'active', 'focus', 'loading', 'disabled'],
  accessibility: 'Native <button> (Enter/Space activate); loading sets aria-busy and disables; visible focus ring; asChild preserves the child role.',
  related: ['IconButton', 'ButtonGroup', 'Link'],
});
```
`packages/console-ui/src/registry.ts` — import `buttonIntent` and add it to `allIntents`.
`packages/console-ui/src/index.ts` — add:
```ts
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './actions/Button.js';
```

- [ ] **Step 6: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec vitest run packages/console-ui/src/actions/Button.test.tsx && corepack pnpm exec prettier --write "packages/console-ui/src/actions/**/*.{ts,tsx}" packages/console-ui/src/registry.ts packages/console-ui/src/index.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/actions/Button.tsx packages/console-ui/src/actions/Button.intent.ts packages/console-ui/src/actions/Button.test.tsx packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the button component"
```

---

### Task 6: Field + TextField — the proof input (TDD)

**Files:**
- Create: `packages/console-ui/src/inputs/Field.tsx`, `packages/console-ui/src/inputs/TextField.tsx`, `packages/console-ui/src/inputs/Field.intent.ts`, `packages/console-ui/src/inputs/TextField.intent.ts`, `packages/console-ui/src/inputs/Field.test.tsx`, `packages/console-ui/src/inputs/TextField.test.tsx`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `cx`, `focusRing`, `assertIntent`, `radix-ui` `Label`, React `useId`.
- Produces: `<Field label description error children />` (associates label + description + error to the control via ids); `<TextField label? description? error? invalid? …inputProps />` (a Field-wrapped `<input>`). Establishes the label/description/error association pattern every other input reuses.

- [ ] **Step 1: Write the failing Field + TextField tests**

`packages/console-ui/src/inputs/Field.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './Field.js';

describe('Field', () => {
  it('labels the control and wires description + error via aria-describedby', () => {
    render(
      <Field label="Name" description="Your full name" error="Required">
        {(ids) => <input aria-labelledby={ids.labelId} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} />}
      </Field>,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAccessibleName('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Required')).toBeInTheDocument();
    // describedby references both description and error nodes
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ').length).toBe(2);
  });

  it('omits the error node and aria-invalid when there is no error', () => {
    render(
      <Field label="Name">
        {(ids) => <input aria-labelledby={ids.labelId} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} />}
      </Field>,
    );
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid', 'true');
  });
});
```
`packages/console-ui/src/inputs/TextField.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField.js';

describe('TextField', () => {
  it('renders a labelled text input and accepts typing', async () => {
    render(<TextField label="Project" />);
    const input = screen.getByRole('textbox', { name: 'Project' });
    await userEvent.type(input, 'coa');
    expect(input).toHaveValue('coa');
  });

  it('marks itself invalid and shows the error', () => {
    render(<TextField label="Project" error="Too short" />);
    const input = screen.getByRole('textbox', { name: 'Project' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('data-invalid', 'true');
    expect(screen.getByText('Too short')).toBeInTheDocument();
  });

  it('disables the input', () => {
    render(<TextField label="Project" disabled />);
    expect(screen.getByRole('textbox', { name: 'Project' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm exec vitest run packages/console-ui/src/inputs/Field.test.tsx packages/console-ui/src/inputs/TextField.test.tsx`
Expected: FAIL — cannot resolve `./Field.js` / `./TextField.js`.

- [ ] **Step 3: Implement Field**

`packages/console-ui/src/inputs/Field.tsx`:
```tsx
import type { ReactNode } from 'react';
import { useId } from 'react';
import { Label } from 'radix-ui';
import { cx } from '../lib/cx.js';

export interface FieldControlIds {
  labelId: string;
  /** Space-joined ids of the visible description and/or error nodes (or undefined). */
  describedBy: string | undefined;
  invalid: boolean;
}

export interface FieldProps {
  label: string;
  description?: string;
  error?: string;
  className?: string;
  /** Render-prop: receives the ids/flags to spread onto the control. */
  children: (ids: FieldControlIds) => ReactNode;
}

export function Field({ label, description, error, className, children }: FieldProps): React.JSX.Element {
  const base = useId();
  const labelId = `${base}-label`;
  const descId = description !== undefined ? `${base}-desc` : undefined;
  const errId = error !== undefined ? `${base}-err` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(' ') || undefined;
  const invalid = error !== undefined;

  return (
    <div className={cx('flex flex-col gap-1', className)} data-invalid={invalid ? 'true' : undefined}>
      <Label.Root id={labelId} className="text-[12px] font-medium text-fg">
        {label}
      </Label.Root>
      {description !== undefined && (
        <span id={descId} className="text-[11px] text-muted">
          {description}
        </span>
      )}
      {children({ labelId, describedBy, invalid })}
      {error !== undefined && (
        <span id={errId} role="alert" className="text-[11px] text-danger-text">
          {error}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement TextField**

`packages/console-ui/src/inputs/TextField.tsx`:
```tsx
import type { InputHTMLAttributes } from 'react';
import { cx, focusRing } from '../lib/cx.js';
import { Field } from './Field.js';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'aria-invalid'> {
  label: string;
  description?: string;
  error?: string;
}

const inputClass =
  'h-7 rounded-control border border-border-default bg-element px-2 text-[13px] text-fg ' +
  'placeholder:text-faint disabled:opacity-50 disabled:pointer-events-none ' +
  'data-[invalid=true]:border-danger';

export function TextField({ label, description, error, className, ...rest }: TextFieldProps): React.JSX.Element {
  return (
    <Field label={label} {...(description !== undefined ? { description } : {})} {...(error !== undefined ? { error } : {})}>
      {(ids) => (
        <input
          type="text"
          aria-labelledby={ids.labelId}
          aria-describedby={ids.describedBy}
          aria-invalid={ids.invalid || undefined}
          data-invalid={ids.invalid ? 'true' : undefined}
          className={cx(inputClass, focusRing, className)}
          {...rest}
        />
      )}
    </Field>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/console-ui/src/inputs/Field.test.tsx packages/console-ui/src/inputs/TextField.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Add intents + register + export**

`packages/console-ui/src/inputs/Field.intent.ts`:
```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const fieldIntent: ComponentIntent = assertIntent({
  name: 'Field',
  family: 'Inputs',
  intent: 'Wraps a control with an associated label, description, and error.',
  useWhen: ['Building a custom control that needs label/description/error wiring.'],
  dontUseWhen: ['You want a ready-made text input — use TextField.'],
  anatomy: 'Label, optional description, the control (render-prop), optional error alert.',
  variantsStates: ['rest', 'invalid (error present)'],
  accessibility: 'Associates label via id and description/error via aria-describedby; error uses role=alert.',
  related: ['TextField', 'Select', 'Combobox'],
});
```
`packages/console-ui/src/inputs/TextField.intent.ts`:
```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const textFieldIntent: ComponentIntent = assertIntent({
  name: 'TextField',
  family: 'Inputs',
  intent: 'A single-line text input with label, description, and error states.',
  useWhen: ['Collecting a short free-text value (a name, a path, a query).'],
  dontUseWhen: ['Choosing from a fixed set — use Select.', 'Toggling a boolean — use Checkbox/Switch.', 'Multi-line text — use a textarea variant (not in this kit yet).'],
  anatomy: 'A Field wrapping a native <input type=text>.',
  variantsStates: ['rest', 'hover', 'focus', 'disabled', 'error/invalid'],
  accessibility: 'Labelled input; error sets aria-invalid + role=alert message; visible focus ring.',
  related: ['Field', 'Select', 'Combobox'],
});
```
Register both in `registry.ts`; export from `index.ts`:
```ts
export { Field, type FieldProps, type FieldControlIds } from './inputs/Field.js';
export { TextField, type TextFieldProps } from './inputs/TextField.js';
```

- [ ] **Step 7: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec vitest run packages/console-ui/src/inputs && corepack pnpm exec prettier --write "packages/console-ui/src/inputs/**/*.{ts,tsx}" packages/console-ui/src/registry.ts packages/console-ui/src/index.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/inputs/Field.tsx packages/console-ui/src/inputs/TextField.tsx packages/console-ui/src/inputs/Field.intent.ts packages/console-ui/src/inputs/TextField.intent.ts packages/console-ui/src/inputs/Field.test.tsx packages/console-ui/src/inputs/TextField.test.tsx packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the field and text input components"
```

---

### Task 7: Banner + DenyNotice — the feedback + governance proof (TDD)

**Files:**
- Create: `packages/console-ui/src/feedback/Banner.tsx`, `packages/console-ui/src/feedback/DenyNotice.tsx`, `packages/console-ui/src/feedback/Banner.intent.ts`, `packages/console-ui/src/feedback/DenyNotice.intent.ts`, `packages/console-ui/src/feedback/Banner.test.tsx`, `packages/console-ui/src/feedback/DenyNotice.test.tsx`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `cx`, `Icon`, `assertIntent`, Lucide icons.
- Produces: `type Status = 'info' | 'success' | 'warning' | 'danger'`; `<Banner tone title children onDismiss? />`; `type DenyKind = 'close-gate' | 'cost-cap'`; `<DenyNotice kind reason detail? />`. `DenyNotice` renders a deny that the daemon **already** issued — it never blocks anything itself (SC-1).

- [ ] **Step 1: Write the failing tests**

`packages/console-ui/src/feedback/Banner.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Banner } from './Banner.js';

describe('Banner', () => {
  it('renders a status region with tone and title', () => {
    render(<Banner tone="warning" title="Heads up">Disk is low</Banner>);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByText('Disk is low')).toBeInTheDocument();
  });

  it('uses role=alert for the danger tone', () => {
    render(<Banner tone="danger" title="Failed">Build broke</Banner>);
    expect(screen.getByRole('alert')).toHaveAttribute('data-tone', 'danger');
  });

  it('offers a labelled dismiss when onDismiss is given', async () => {
    const onDismiss = vi.fn();
    render(<Banner tone="info" title="FYI" onDismiss={onDismiss}>x</Banner>);
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
```
`packages/console-ui/src/feedback/DenyNotice.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DenyNotice } from './DenyNotice.js';

describe('DenyNotice', () => {
  it('surfaces a cost-cap denial as an alert with the reason', () => {
    render(<DenyNotice kind="cost-cap" reason="Spending cap reached" detail="Raise the cap to continue." />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-deny-kind', 'cost-cap');
    expect(screen.getByText('Spending cap reached')).toBeInTheDocument();
    expect(screen.getByText('Raise the cap to continue.')).toBeInTheDocument();
  });

  it('surfaces a close-gate denial and names the source', () => {
    render(<DenyNotice kind="close-gate" reason="Change blocked at close" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-deny-kind', 'close-gate');
    // it labels which of the two real blocks issued this — it never invents one
    expect(alert).toHaveTextContent(/close/i);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm exec vitest run packages/console-ui/src/feedback/Banner.test.tsx packages/console-ui/src/feedback/DenyNotice.test.tsx`
Expected: FAIL — cannot resolve the modules.

- [ ] **Step 3: Implement Banner**

`packages/console-ui/src/feedback/Banner.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Info, CircleCheck, TriangleAlert, OctagonAlert, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export type Status = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  tone: Status;
  title: string;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const toneIcon: Record<Status, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
};
const toneClass: Record<Status, string> = {
  info: 'bg-info-tint text-info-text border-info/40',
  success: 'bg-success-tint text-success-text border-success/40',
  warning: 'bg-warning-tint text-warning-text border-warning/40',
  danger: 'bg-danger-tint text-danger-text border-danger/40',
};

export function Banner({ tone, title, children, onDismiss, className }: BannerProps): React.JSX.Element {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      data-tone={tone}
      className={cx('flex items-start gap-2 rounded-surface border px-3 py-2 text-[12px]', toneClass[tone], className)}
    >
      <Icon name={toneIcon[tone]} size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="font-medium text-fg">{title}</div>
        {children !== undefined && <div className="text-muted">{children}</div>}
      </div>
      {onDismiss !== undefined && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className={cx('shrink-0 rounded-control p-0.5 hover:bg-element-hover', focusRing)}>
          <Icon name={X} size={14} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement DenyNotice**

`packages/console-ui/src/feedback/DenyNotice.tsx`:
```tsx
import { Ban, CircleDollarSign } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

/** The only two real blocks in the system: the close-gate and the cost-cap. */
export type DenyKind = 'close-gate' | 'cost-cap';

export interface DenyNoticeProps {
  kind: DenyKind;
  /** The daemon-issued reason, rendered verbatim. */
  reason: string;
  /** Optional next step the operator can take. */
  detail?: string;
  className?: string;
}

const kindIcon: Record<DenyKind, LucideIcon> = { 'close-gate': Ban, 'cost-cap': CircleDollarSign };
const kindSource: Record<DenyKind, string> = { 'close-gate': 'Blocked at close', 'cost-cap': 'Cost cap' };

/** Surfaces a deny the daemon already issued. It gates nothing itself. */
export function DenyNotice({ kind, reason, detail, className }: DenyNoticeProps): React.JSX.Element {
  return (
    <div
      role="alert"
      data-deny-kind={kind}
      className={cx('flex items-start gap-2 rounded-surface border border-danger/50 bg-danger-tint px-3 py-2 text-[12px] text-danger-text', className)}
    >
      <Icon name={kindIcon[kind]} size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-faint">{kindSource[kind]}</div>
        <div className="font-medium text-fg">{reason}</div>
        {detail !== undefined && <div className="text-muted">{detail}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/console-ui/src/feedback/Banner.test.tsx packages/console-ui/src/feedback/DenyNotice.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Add intents + register + export**

`packages/console-ui/src/feedback/Banner.intent.ts`:
```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const bannerIntent: ComponentIntent = assertIntent({
  name: 'Banner',
  family: 'Feedback',
  intent: 'Shows a persistent, in-flow status message tied to a region or view.',
  useWhen: ['A condition persists and the operator needs to keep seeing it (degraded mode, stale data).'],
  dontUseWhen: ['The message is transient — use Toast.', 'It is a validation error on a control — use the Field error.', 'It is a system deny — use DenyNotice.'],
  anatomy: 'Tone icon, title, optional body, optional dismiss.',
  variantsStates: ['info', 'success', 'warning', 'danger', 'dismissible'],
  accessibility: 'role=status (danger uses role=alert); dismiss has an accessible label; never color alone (tone icon).',
  related: ['Toast', 'InlineMessage', 'DenyNotice'],
});
```
`packages/console-ui/src/feedback/DenyNotice.intent.ts`:
```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const denyNoticeIntent: ComponentIntent = assertIntent({
  name: 'DenyNotice',
  family: 'Feedback',
  intent: 'Surfaces a denial the daemon already issued — the close-gate or the cost-cap.',
  useWhen: ['Rendering a deny returned by the single deny channel (the only two real blocks).'],
  dontUseWhen: ['You are tempted to block or gate an action in the UI — the console never denies; only the daemon does.', 'The message is a non-blocking warning — use Banner.'],
  anatomy: 'Deny-kind eyebrow, the verbatim reason, optional next-step detail.',
  variantsStates: ['close-gate', 'cost-cap'],
  accessibility: 'role=alert; the kind is named in text, not color alone.',
  related: ['Banner', 'InlineMessage'],
});
```
Register both in `registry.ts`; export from `index.ts`:
```ts
export { Banner, type BannerProps, type Status } from './feedback/Banner.js';
export { DenyNotice, type DenyNoticeProps, type DenyKind } from './feedback/DenyNotice.js';
```

- [ ] **Step 7: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec vitest run packages/console-ui/src/feedback && corepack pnpm exec prettier --write "packages/console-ui/src/feedback/**/*.{ts,tsx}" packages/console-ui/src/registry.ts packages/console-ui/src/index.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/feedback/Banner.tsx packages/console-ui/src/feedback/DenyNotice.tsx packages/console-ui/src/feedback/Banner.intent.ts packages/console-ui/src/feedback/DenyNotice.intent.ts packages/console-ui/src/feedback/Banner.test.tsx packages/console-ui/src/feedback/DenyNotice.test.tsx packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the banner and deny-notice components"
```

---

### Task 8: Actions family — IconButton, ButtonGroup, Link, Menu (TDD)

**Files:**
- Create (each with `.tsx`, `.intent.ts`, `.test.tsx`): `packages/console-ui/src/actions/IconButton`, `ButtonGroup`, `Link`, `Menu`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `cx`, `focusRing`, `Icon`, `assertIntent`, `radix-ui` `DropdownMenu`, Lucide.
- Produces: `<IconButton icon label variant? size? loading? …btn />` (icon-only, label required); `<ButtonGroup>…</ButtonGroup>` (role=group); `type LinkTone = 'default' | 'muted'`; `<Link href tone? external? …anchor />`; `interface MenuItem { id; label; icon?; onSelect?; disabled? }`; `<Menu trigger items />`.

- [ ] **Step 1: Write the failing tests**

`packages/console-ui/src/actions/IconButton.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Play } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton.js';

describe('IconButton', () => {
  it('requires and applies an accessible label', () => {
    render(<IconButton icon={Play} label="Run" />);
    expect(screen.getByRole('button', { name: 'Run' })).toHaveAttribute('data-variant', 'secondary');
  });
  it('blocks click while loading', async () => {
    const onClick = vi.fn();
    render(<IconButton icon={Play} label="Run" loading onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
```
`packages/console-ui/src/actions/ButtonGroup.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ButtonGroup } from './ButtonGroup.js';
import { Button } from './Button.js';

describe('ButtonGroup', () => {
  it('groups its children with a group role and a label', () => {
    render(<ButtonGroup label="Actions"><Button>A</Button><Button>B</Button></ButtonGroup>);
    const group = screen.getByRole('group', { name: 'Actions' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
  });
});
```
`packages/console-ui/src/actions/Link.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Link } from './Link.js';

describe('Link', () => {
  it('renders an anchor with the tone data flag', () => {
    render(<Link href="/x" tone="muted">docs</Link>);
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('data-tone', 'muted');
  });
  it('hardens external links with rel + target and marks them', () => {
    render(<Link href="https://x.test" external>out</Link>);
    const a = screen.getByRole('link', { name: /out/ });
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
```
`packages/console-ui/src/actions/Menu.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Menu } from './Menu.js';

describe('Menu', () => {
  it('opens on trigger and selects an item', async () => {
    const onSelect = vi.fn();
    render(<Menu trigger={<button type="button">More</button>} items={[{ id: 'a', label: 'Rewind', onSelect }, { id: 'b', label: 'Copy' }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const item = await screen.findByRole('menuitem', { name: 'Rewind' });
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm exec vitest run packages/console-ui/src/actions/IconButton.test.tsx packages/console-ui/src/actions/ButtonGroup.test.tsx packages/console-ui/src/actions/Link.test.tsx packages/console-ui/src/actions/Menu.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four components**

`packages/console-ui/src/actions/IconButton.tsx`:
```tsx
import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';
import type { ButtonVariant, ButtonSize } from './Button.js';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: LucideIcon;
  /** Required — the icon has no visible text. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const bySize: Record<ButtonSize, string> = { sm: 'h-6 w-6', md: 'h-7 w-7' };
const byVariant: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'bg-element text-fg border border-border-default hover:bg-element-hover',
  tertiary: 'bg-transparent text-fg hover:bg-element-hover',
  danger: 'bg-danger text-on-accent hover:opacity-90',
};

export function IconButton({ icon, label, variant = 'secondary', size = 'md', loading = false, disabled, type, className, ...rest }: IconButtonProps): React.JSX.Element {
  const isDisabled = disabled === true || loading;
  return (
    <button
      type={type ?? 'button'}
      aria-label={label}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-loading={loading ? 'true' : undefined}
      disabled={isDisabled}
      className={cx('inline-flex items-center justify-center rounded-control disabled:opacity-50 disabled:pointer-events-none', bySize[size], byVariant[variant], focusRing, className)}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  );
}
```
`packages/console-ui/src/actions/ButtonGroup.tsx`:
```tsx
import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface ButtonGroupProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function ButtonGroup({ label, children, className }: ButtonGroupProps): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex items-center gap-1', className)}>
      {children}
    </div>
  );
}
```
`packages/console-ui/src/actions/Link.tsx`:
```tsx
import type { AnchorHTMLAttributes } from 'react';
import { cx, focusRing } from '../lib/cx.js';

export type LinkTone = 'default' | 'muted';

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  tone?: LinkTone;
  /** Opens in a new context with hardened rel. */
  external?: boolean;
}

const byTone: Record<LinkTone, string> = {
  default: 'text-accent hover:underline',
  muted: 'text-muted hover:text-fg hover:underline',
};

export function Link({ tone = 'default', external = false, className, children, ...rest }: LinkProps): React.JSX.Element {
  return (
    <a
      data-tone={tone}
      className={cx('rounded-[2px] underline-offset-2', byTone[tone], focusRing, className)}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}
```
`packages/console-ui/src/actions/Menu.tsx`:
```tsx
import type { ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface MenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  disabled?: boolean;
}

export interface MenuProps {
  trigger: ReactNode;
  items: MenuItem[];
}

export function Menu({ trigger, items }: MenuProps): React.JSX.Element {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          className="z-[200] min-w-40 rounded-surface border border-border-default bg-raised p-1 text-[13px] text-fg shadow-lg"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              disabled={item.disabled ?? false}
              onSelect={item.onSelect ?? (() => {})}
              className={cx(
                'flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none',
                'data-[highlighted]:bg-element-hover data-[disabled]:opacity-50',
              )}
            >
              {item.icon !== undefined && <Icon name={item.icon} size={14} />}
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/console-ui/src/actions/IconButton.test.tsx packages/console-ui/src/actions/ButtonGroup.test.tsx packages/console-ui/src/actions/Link.test.tsx packages/console-ui/src/actions/Menu.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Add intents, register, export**

Create `IconButton.intent.ts`, `ButtonGroup.intent.ts`, `Link.intent.ts`, `Menu.intent.ts`, each `export const <name>Intent = assertIntent({ … })` with family `'Actions'` and complete fields. Use these:
```ts
// IconButton
export const iconButtonIntent = assertIntent({ name: 'IconButton', family: 'Actions', intent: 'An icon-only button for dense toolbars where a text label would not fit.', useWhen: ['A recognizable action fits a compact toolbar (rewind, copy, expand).'], dontUseWhen: ['The action is primary or ambiguous — use a labelled Button.'], anatomy: 'A square button wrapping one Icon; label is the accessible name.', variantsStates: ['primary', 'secondary', 'tertiary', 'danger', 'sizes sm/md', 'hover', 'focus', 'loading', 'disabled'], accessibility: 'label is required and becomes aria-label; native button keyboard model; visible focus ring.', related: ['Button', 'Menu'] });
// ButtonGroup
export const buttonGroupIntent = assertIntent({ name: 'ButtonGroup', family: 'Actions', intent: 'Groups related buttons as one labelled cluster.', useWhen: ['Two or more actions belong together (confirm/cancel, segmented choices).'], dontUseWhen: ['The buttons are unrelated — lay them out separately.'], anatomy: 'A role=group wrapper around Button/IconButton children.', variantsStates: ['rest'], accessibility: 'role=group with an aria-label naming the cluster.', related: ['Button', 'Toolbar'] });
// Link
export const linkIntent = assertIntent({ name: 'Link', family: 'Actions', intent: 'Navigates to another location or resource.', useWhen: ['Moving to a route, doc, or external resource.'], dontUseWhen: ['Committing an action — use Button.'], anatomy: 'A styled anchor, optionally external.', variantsStates: ['default', 'muted', 'hover', 'focus', 'external'], accessibility: 'Native anchor; external links get rel=noopener noreferrer; visible focus ring.', related: ['Button'] });
// Menu
export const menuIntent = assertIntent({ name: 'Menu', family: 'Actions', intent: 'A dropdown of secondary actions behind a trigger.', useWhen: ['Overflow or contextual actions that do not warrant always-visible buttons.'], dontUseWhen: ['Selecting a value from options — use Select.', 'A single primary action — use Button.'], anatomy: 'A trigger and a portalled list of items with optional icons.', variantsStates: ['closed', 'open', 'item hover/highlight', 'item disabled'], accessibility: 'Radix menu semantics: roving focus, Escape closes, arrow keys navigate, type-ahead.', related: ['Button', 'IconButton', 'Select'] });
```
Register all four in `registry.ts`; export from `index.ts`:
```ts
export { IconButton, type IconButtonProps } from './actions/IconButton.js';
export { ButtonGroup, type ButtonGroupProps } from './actions/ButtonGroup.js';
export { Link, type LinkProps, type LinkTone } from './actions/Link.js';
export { Menu, type MenuProps, type MenuItem } from './actions/Menu.js';
```

- [ ] **Step 6: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec vitest run packages/console-ui/src/actions && corepack pnpm exec prettier --write "packages/console-ui/src/actions/**/*.{ts,tsx}" packages/console-ui/src/registry.ts packages/console-ui/src/index.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/actions packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the icon-button, button-group, link, and menu components"
```

---

### Task 9: Selection controls — Checkbox, Radio, Switch (TDD)

**Files:**
- Create (each with `.tsx`, `.intent.ts`, `.test.tsx`): `packages/console-ui/src/inputs/Checkbox`, `Radio`, `Switch`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `cx`, `focusRing`, `Icon`, `assertIntent`, `radix-ui` `Checkbox`/`RadioGroup`/`Switch`, React `useId`.
- Produces: `<Checkbox label checked? defaultChecked? onCheckedChange? disabled? />`; `interface RadioOption { value; label; disabled? }`; `<Radio label options value? onValueChange? name? />`; `<Switch label checked? onCheckedChange? disabled? />`.

- [ ] **Step 1: Write the failing tests**

`packages/console-ui/src/inputs/Checkbox.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox.js';

describe('Checkbox', () => {
  it('renders a labelled checkbox and toggles', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Verbose" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox', { name: 'Verbose' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
  it('disables', () => {
    render(<Checkbox label="Verbose" disabled />);
    expect(screen.getByRole('checkbox', { name: 'Verbose' })).toBeDisabled();
  });
});
```
`packages/console-ui/src/inputs/Radio.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Radio } from './Radio.js';

describe('Radio', () => {
  it('renders a labelled radiogroup and selects a value', async () => {
    const onValueChange = vi.fn();
    render(<Radio label="Mode" options={[{ value: 'a', label: 'Attended' }, { value: 'u', label: 'Unattended' }]} onValueChange={onValueChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Unattended' }));
    expect(onValueChange).toHaveBeenCalledWith('u');
  });
});
```
`packages/console-ui/src/inputs/Switch.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch.js';

describe('Switch', () => {
  it('renders a labelled switch and toggles', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Reduce motion" onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole('switch', { name: 'Reduce motion' });
    await userEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm exec vitest run packages/console-ui/src/inputs/Checkbox.test.tsx packages/console-ui/src/inputs/Radio.test.tsx packages/console-ui/src/inputs/Switch.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three controls**

`packages/console-ui/src/inputs/Checkbox.tsx`:
```tsx
import { useId } from 'react';
import { Checkbox as RxCheckbox } from 'radix-ui';
import { Check } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface CheckboxProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ label, checked, defaultChecked, onCheckedChange, disabled, className }: CheckboxProps): React.JSX.Element {
  const id = useId();
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <RxCheckbox.Root
        id={id}
        {...(checked !== undefined ? { checked } : {})}
        {...(defaultChecked !== undefined ? { defaultChecked } : {})}
        {...(onCheckedChange !== undefined ? { onCheckedChange: (v) => onCheckedChange(v === true) } : {})}
        disabled={disabled ?? false}
        className={cx('flex h-4 w-4 items-center justify-center rounded-[3px] border border-border-default bg-element data-[state=checked]:border-transparent data-[state=checked]:bg-accent disabled:opacity-50', focusRing)}
      >
        <RxCheckbox.Indicator className="text-on-accent">
          <Icon name={Check} size={12} />
        </RxCheckbox.Indicator>
      </RxCheckbox.Root>
      <label htmlFor={id} className="text-[13px] text-fg">{label}</label>
    </div>
  );
}
```
`packages/console-ui/src/inputs/Radio.tsx`:
```tsx
import { useId } from 'react';
import { RadioGroup } from 'radix-ui';
import { cx, focusRing } from '../lib/cx.js';

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioProps {
  label: string;
  options: RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function Radio({ label, options, value, defaultValue, onValueChange, className }: RadioProps): React.JSX.Element {
  const labelId = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <span id={labelId} className="text-[12px] font-medium text-fg">{label}</span>
      <RadioGroup.Root
        aria-labelledby={labelId}
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        {...(onValueChange !== undefined ? { onValueChange } : {})}
        className="flex flex-col gap-1.5"
      >
        {options.map((opt) => {
          const id = `${labelId}-${opt.value}`;
          return (
            <div key={opt.value} className="flex items-center gap-2">
              <RadioGroup.Item
                id={id}
                value={opt.value}
                disabled={opt.disabled ?? false}
                className={cx('flex h-4 w-4 items-center justify-center rounded-full border border-border-default bg-element data-[state=checked]:border-accent disabled:opacity-50', focusRing)}
              >
                <RadioGroup.Indicator className="h-2 w-2 rounded-full bg-accent" />
              </RadioGroup.Item>
              <label htmlFor={id} className="text-[13px] text-fg">{opt.label}</label>
            </div>
          );
        })}
      </RadioGroup.Root>
    </div>
  );
}
```
`packages/console-ui/src/inputs/Switch.tsx`:
```tsx
import { useId } from 'react';
import { Switch as RxSwitch } from 'radix-ui';
import { cx, focusRing } from '../lib/cx.js';

export interface SwitchProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Switch({ label, checked, defaultChecked, onCheckedChange, disabled, className }: SwitchProps): React.JSX.Element {
  const id = useId();
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <RxSwitch.Root
        id={id}
        {...(checked !== undefined ? { checked } : {})}
        {...(defaultChecked !== undefined ? { defaultChecked } : {})}
        {...(onCheckedChange !== undefined ? { onCheckedChange } : {})}
        disabled={disabled ?? false}
        className={cx('relative h-4 w-7 rounded-full border border-border-default bg-element transition-colors duration-fast data-[state=checked]:border-transparent data-[state=checked]:bg-accent disabled:opacity-50', focusRing)}
      >
        <RxSwitch.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-fg transition-transform duration-fast data-[state=checked]:translate-x-3.5 data-[state=checked]:bg-on-accent" />
      </RxSwitch.Root>
      <label htmlFor={id} className="text-[13px] text-fg">{label}</label>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/console-ui/src/inputs/Checkbox.test.tsx packages/console-ui/src/inputs/Radio.test.tsx packages/console-ui/src/inputs/Switch.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Add intents, register, export**

Create the three `*.intent.ts` (family `'Inputs'`), complete fields:
```ts
export const checkboxIntent = assertIntent({ name: 'Checkbox', family: 'Inputs', intent: 'Toggles a single independent boolean.', useWhen: ['One on/off option that stands alone (enable verbose logging).'], dontUseWhen: ['Choosing one of several — use Radio.', 'An immediate-effect setting toggle reads better as a Switch.'], anatomy: 'A Radix checkbox box with a check indicator and a clickable label.', variantsStates: ['unchecked', 'checked', 'focus', 'disabled'], accessibility: 'role=checkbox, Space toggles, label associated by id; visible focus ring.', related: ['Switch', 'Radio'] });
export const radioIntent = assertIntent({ name: 'Radio', family: 'Inputs', intent: 'Chooses exactly one option from a small, visible set.', useWhen: ['2–5 mutually exclusive options that benefit from being all visible.'], dontUseWhen: ['Many options — use Select.', 'Independent booleans — use Checkbox.'], anatomy: 'A labelled radiogroup of labelled radio items.', variantsStates: ['unselected', 'selected', 'focus', 'item disabled'], accessibility: 'role=radiogroup with roving focus; arrow keys move selection; group labelled by id.', related: ['Select', 'Checkbox'] });
export const switchIntent = assertIntent({ name: 'Switch', family: 'Inputs', intent: 'Toggles a setting that takes effect immediately.', useWhen: ['An immediate on/off preference (reduce motion, compact density).'], dontUseWhen: ['The value is only applied on submit — use Checkbox.', 'Choosing among options — use Radio.'], anatomy: 'A Radix switch track and thumb with a clickable label.', variantsStates: ['off', 'on', 'focus', 'disabled'], accessibility: 'role=switch, Space toggles, label associated by id; visible focus ring.', related: ['Checkbox'] });
```
Register all three; export from `index.ts`:
```ts
export { Checkbox, type CheckboxProps } from './inputs/Checkbox.js';
export { Radio, type RadioProps, type RadioOption } from './inputs/Radio.js';
export { Switch, type SwitchProps } from './inputs/Switch.js';
```

- [ ] **Step 6: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec vitest run packages/console-ui/src/inputs && corepack pnpm exec prettier --write "packages/console-ui/src/inputs/**/*.{ts,tsx}" packages/console-ui/src/registry.ts packages/console-ui/src/index.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/inputs/Checkbox.tsx packages/console-ui/src/inputs/Radio.tsx packages/console-ui/src/inputs/Switch.tsx packages/console-ui/src/inputs/Checkbox.intent.ts packages/console-ui/src/inputs/Radio.intent.ts packages/console-ui/src/inputs/Switch.intent.ts packages/console-ui/src/inputs/Checkbox.test.tsx packages/console-ui/src/inputs/Radio.test.tsx packages/console-ui/src/inputs/Switch.test.tsx packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the checkbox, radio, and switch controls"
```

---

### Task 10: Select + Combobox (TDD)

**Files:**
- Create (each with `.tsx`, `.intent.ts`, `.test.tsx`): `packages/console-ui/src/inputs/Select`, `Combobox`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `cx`, `focusRing`, `Icon`, `Field`, `assertIntent`, `radix-ui` `Select`/`Popover`, React `useId`/`useState`.
- Produces: `interface SelectOption { value; label; disabled? }`; `<Select label options value? onValueChange? placeholder? />`; `<Combobox label options value? onValueChange? placeholder? />` (a filterable single-select over an accessible listbox).

- [ ] **Step 1: Write the failing tests**

`packages/console-ui/src/inputs/Select.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select.js';

const options = [{ value: 'pro', label: 'Pro' }, { value: 'max', label: 'Max' }];

describe('Select', () => {
  it('opens and selects an option', async () => {
    const onValueChange = vi.fn();
    render(<Select label="Plan" options={options} placeholder="Choose" onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Plan' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Max' }));
    expect(onValueChange).toHaveBeenCalledWith('max');
  });
});
```
`packages/console-ui/src/inputs/Combobox.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Combobox } from './Combobox.js';

const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'g', label: 'Gamma' }];

describe('Combobox', () => {
  it('filters options by typed text and selects one', async () => {
    const onValueChange = vi.fn();
    render(<Combobox label="Symbol" options={options} onValueChange={onValueChange} />);
    const input = screen.getByRole('combobox', { name: 'Symbol' });
    await userEvent.type(input, 'be');
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Alpha' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(input).toHaveValue('Beta');
  });

  it('sets aria-expanded when options are open', async () => {
    render(<Combobox label="Symbol" options={options} />);
    const input = screen.getByRole('combobox', { name: 'Symbol' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm exec vitest run packages/console-ui/src/inputs/Select.test.tsx packages/console-ui/src/inputs/Combobox.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement Select (Radix)**

`packages/console-ui/src/inputs/Select.tsx`:
```tsx
import { useId } from 'react';
import { Select as RxSelect } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({ label, options, value, defaultValue, onValueChange, placeholder, disabled, className }: SelectProps): React.JSX.Element {
  const labelId = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <span id={labelId} className="text-[12px] font-medium text-fg">{label}</span>
      <RxSelect.Root
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        {...(onValueChange !== undefined ? { onValueChange } : {})}
        disabled={disabled ?? false}
      >
        <RxSelect.Trigger
          aria-labelledby={labelId}
          className={cx('inline-flex h-7 items-center justify-between gap-2 rounded-control border border-border-default bg-element px-2 text-[13px] text-fg disabled:opacity-50', focusRing)}
        >
          <RxSelect.Value placeholder={placeholder ?? 'Select…'} />
          <RxSelect.Icon><Icon name={ChevronDown} size={14} /></RxSelect.Icon>
        </RxSelect.Trigger>
        <RxSelect.Portal>
          <RxSelect.Content className="z-[200] overflow-hidden rounded-surface border border-border-default bg-raised text-[13px] text-fg shadow-lg">
            <RxSelect.Viewport className="p-1">
              {options.map((opt) => (
                <RxSelect.Item
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled ?? false}
                  className="flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none data-[highlighted]:bg-element-hover data-[disabled]:opacity-50"
                >
                  <RxSelect.ItemText>{opt.label}</RxSelect.ItemText>
                  <RxSelect.ItemIndicator className="ml-auto"><Icon name={Check} size={12} /></RxSelect.ItemIndicator>
                </RxSelect.Item>
              ))}
            </RxSelect.Viewport>
          </RxSelect.Content>
        </RxSelect.Portal>
      </RxSelect.Root>
    </div>
  );
}
```

- [ ] **Step 4: Implement Combobox (custom, accessible)**

`packages/console-ui/src/inputs/Combobox.tsx`:
```tsx
import { useId, useMemo, useState } from 'react';
import { cx, focusRing } from '../lib/cx.js';

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  label: string;
  options: ComboboxOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function Combobox({ label, options, value, onValueChange, placeholder, className }: ComboboxProps): React.JSX.Element {
  const labelId = useId();
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const [query, setQuery] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())),
    [options, query],
  );

  function choose(opt: ComboboxOption): void {
    setQuery(opt.label);
    setOpen(false);
    onValueChange?.(opt.value);
  }

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <span id={labelId} className="text-[12px] font-medium text-fg">{label}</span>
      <div className="relative">
        <input
          role="combobox"
          aria-labelledby={labelId}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          placeholder={placeholder ?? ''}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          className={cx('h-7 w-full rounded-control border border-border-default bg-element px-2 text-[13px] text-fg placeholder:text-faint', focusRing)}
        />
        {open && filtered.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-[200] mt-1 max-h-56 w-full overflow-auto rounded-surface border border-border-default bg-raised p-1 text-[13px] text-fg shadow-lg"
          >
            {filtered.map((opt) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                // onMouseDown (not onClick) so it fires before the input blur closes the list
                onMouseDown={(e) => { e.preventDefault(); choose(opt); }}
                className="cursor-default rounded-control px-2 py-1 hover:bg-element-hover aria-selected:bg-element-active"
              >
                {opt.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/console-ui/src/inputs/Select.test.tsx packages/console-ui/src/inputs/Combobox.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Add intents, register, export**

```ts
export const selectIntent = assertIntent({ name: 'Select', family: 'Inputs', intent: 'Chooses one value from a fixed list via a dropdown.', useWhen: ['A single choice from a known, closed set that is too long for Radio.'], dontUseWhen: ['The set is short and worth showing at once — use Radio.', 'The user should be able to filter/type — use Combobox.'], anatomy: 'A labelled trigger showing the current value and a portalled option list.', variantsStates: ['closed', 'open', 'highlighted item', 'selected item', 'disabled'], accessibility: 'Radix select: trigger is role=combobox labelled by id, listbox with role=option, full keyboard + type-ahead.', related: ['Combobox', 'Radio', 'Menu'] });
export const comboboxIntent = assertIntent({ name: 'Combobox', family: 'Inputs', intent: 'Chooses one value from a long list by typing to filter.', useWhen: ['Selecting from many options where filtering by text helps (a symbol, an account).'], dontUseWhen: ['The list is short — use Select or Radio.', 'Free-text with no fixed set — use TextField.'], anatomy: 'A text input (role=combobox) over a filtered listbox of options.', variantsStates: ['collapsed', 'expanded', 'filtered', 'option hover/selected'], accessibility: 'Input is role=combobox with aria-expanded/aria-controls/aria-autocomplete; options are role=option in a role=listbox.', related: ['Select', 'TextField'] });
```
Register both; export from `index.ts`:
```ts
export { Select, type SelectProps, type SelectOption } from './inputs/Select.js';
export { Combobox, type ComboboxProps, type ComboboxOption } from './inputs/Combobox.js';
```

- [ ] **Step 7: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec vitest run packages/console-ui/src/inputs/Select.test.tsx packages/console-ui/src/inputs/Combobox.test.tsx && corepack pnpm exec prettier --write "packages/console-ui/src/inputs/**/*.{ts,tsx}" packages/console-ui/src/registry.ts packages/console-ui/src/index.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/inputs/Select.tsx packages/console-ui/src/inputs/Combobox.tsx packages/console-ui/src/inputs/Select.intent.ts packages/console-ui/src/inputs/Combobox.intent.ts packages/console-ui/src/inputs/Select.test.tsx packages/console-ui/src/inputs/Combobox.test.tsx packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the select and combobox inputs"
```

---

### Task 11: Layout family — Divider, Toolbar, Pane, NavList (TDD)

**Files:**
- Create (each with `.tsx`, `.intent.ts`, `.test.tsx`): `packages/console-ui/src/layout/Divider`, `Toolbar`, `Pane`, `NavList`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `cx`, `focusRing`, `Icon`, `assertIntent`, `radix-ui` `Toolbar`, Lucide.
- Produces: `<Divider orientation? />`; `<Toolbar label>…</Toolbar>`; `<Pane title? actions? children scroll? />`; `interface NavItem { id; label; icon?; }`; `<NavList label items activeId onSelect />`.

- [ ] **Step 1: Write the failing tests**

`packages/console-ui/src/layout/Divider.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Divider } from './Divider.js';

describe('Divider', () => {
  it('is a horizontal separator by default', () => {
    render(<Divider />);
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-orientation', 'horizontal');
  });
  it('can be vertical', () => {
    render(<Divider orientation="vertical" />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });
});
```
`packages/console-ui/src/layout/Toolbar.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Toolbar.js';

describe('Toolbar', () => {
  it('renders a labelled toolbar region', () => {
    render(<Toolbar label="Transcript actions"><button type="button">Copy</button></Toolbar>);
    expect(screen.getByRole('toolbar', { name: 'Transcript actions' })).toBeInTheDocument();
  });
});
```
`packages/console-ui/src/layout/Pane.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Pane } from './Pane.js';

describe('Pane', () => {
  it('renders a titled region with its content', () => {
    render(<Pane title="Cost">body</Pane>);
    const region = screen.getByRole('region', { name: 'Cost' });
    expect(region).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});
```
`packages/console-ui/src/layout/NavList.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NavList } from './NavList.js';

describe('NavList', () => {
  it('marks the active item and reports selection', async () => {
    const onSelect = vi.fn();
    render(<NavList label="Sections" activeId="chat" onSelect={onSelect} items={[{ id: 'chat', label: 'Chat' }, { id: 'log', label: 'Decisions' }]} />);
    const active = screen.getByRole('tab', { name: 'Chat' });
    expect(active).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Decisions' }));
    expect(onSelect).toHaveBeenCalledWith('log');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm exec vitest run packages/console-ui/src/layout`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four layout components**

`packages/console-ui/src/layout/Divider.tsx`:
```tsx
import { cx } from '../lib/cx.js';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export function Divider({ orientation = 'horizontal', className }: DividerProps): React.JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cx(orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', 'bg-hairline', className)}
    />
  );
}
```
`packages/console-ui/src/layout/Toolbar.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Toolbar as RxToolbar } from 'radix-ui';
import { cx } from '../lib/cx.js';

export interface ToolbarProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function Toolbar({ label, children, className }: ToolbarProps): React.JSX.Element {
  return (
    <RxToolbar.Root aria-label={label} className={cx('flex items-center gap-1 rounded-control bg-subtle px-1 py-1', className)}>
      {children}
    </RxToolbar.Root>
  );
}
```
`packages/console-ui/src/layout/Pane.tsx`:
```tsx
import type { ReactNode } from 'react';
import { useId } from 'react';
import { cx } from '../lib/cx.js';

export interface PaneProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** When true the body scrolls within the pane instead of growing it. */
  scroll?: boolean;
  className?: string;
}

export function Pane({ title, actions, children, scroll = false, className }: PaneProps): React.JSX.Element {
  const headingId = useId();
  return (
    <section
      {...(title !== undefined ? { 'aria-labelledby': headingId } : {})}
      className={cx('flex min-h-0 flex-col rounded-surface border border-border-default bg-surface', className)}
    >
      {title !== undefined && (
        <header className="flex items-center justify-between border-b border-hairline px-3 py-2">
          <h2 id={headingId} className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{title}</h2>
          {actions}
        </header>
      )}
      <div className={cx('min-h-0 flex-1 p-3', scroll && 'overflow-auto')}>{children}</div>
    </section>
  );
}
```
`packages/console-ui/src/layout/NavList.tsx`:
```tsx
import type { LucideIcon } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface NavItem {
  id: string;
  label: string;
  icon?: LucideIcon;
}

export interface NavListProps {
  label: string;
  items: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
}

export function NavList({ label, items, activeId, onSelect, className }: NavListProps): React.JSX.Element {
  return (
    <div role="tablist" aria-label={label} aria-orientation="vertical" className={cx('flex flex-col gap-0.5', className)}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active ? 'true' : undefined}
            onClick={() => onSelect(item.id)}
            className={cx('flex items-center gap-2 rounded-control px-2 py-1 text-left text-[13px] text-muted hover:bg-element-hover data-[active=true]:bg-element-active data-[active=true]:text-fg', focusRing)}
          >
            {item.icon !== undefined && <Icon name={item.icon} size={16} />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/console-ui/src/layout`
Expected: PASS (5 tests).

- [ ] **Step 5: Add intents, register, export**

```ts
export const dividerIntent = assertIntent({ name: 'Divider', family: 'Layout', intent: 'Separates content with the lightest visible rule.', useWhen: ['Whitespace and grouping are not enough to separate two regions.'], dontUseWhen: ['Space or a tint already reads as separated — prefer removing the border.'], anatomy: 'A one-pixel hairline, horizontal or vertical.', variantsStates: ['horizontal', 'vertical'], accessibility: 'role=separator with aria-orientation.', related: ['Toolbar', 'Pane'] });
export const toolbarIntent = assertIntent({ name: 'Toolbar', family: 'Layout', intent: 'Groups a row of actions over a content region.', useWhen: ['A pane needs a cluster of buttons/toggles acting on its content.'], dontUseWhen: ['The actions are page-level — use the shell chrome.'], anatomy: 'A Radix toolbar row of buttons/controls.', variantsStates: ['rest'], accessibility: 'role=toolbar with an aria-label; roving focus across controls.', related: ['ButtonGroup', 'IconButton'] });
export const paneIntent = assertIntent({ name: 'Pane', family: 'Layout', intent: 'A titled, bordered content region with an optional scrolling body.', useWhen: ['Framing a surface (cost rail, decision log) as a distinct region.'], dontUseWhen: ['Content needs no frame — compose plainly to reduce chrome.'], anatomy: 'Optional header (title + actions) and a body that can scroll.', variantsStates: ['untitled', 'titled', 'scroll'], accessibility: 'section labelled by its heading id when titled.', related: ['Toolbar', 'Divider'] });
export const navListIntent = assertIntent({ name: 'NavList', family: 'Layout', intent: 'A vertical list of navigable sections with one active.', useWhen: ['Switching between primary sections in a rail (chat, decisions, timeline).'], dontUseWhen: ['Choosing a form value — use Radio/Select.'], anatomy: 'A vertical tablist of icon+label tabs.', variantsStates: ['item rest', 'hover', 'active', 'focus'], accessibility: 'role=tablist/tab with aria-selected and vertical orientation; visible focus ring.', related: ['Pane', 'Menu'] });
```
Register all four; export from `index.ts`:
```ts
export { Divider, type DividerProps } from './layout/Divider.js';
export { Toolbar, type ToolbarProps } from './layout/Toolbar.js';
export { Pane, type PaneProps } from './layout/Pane.js';
export { NavList, type NavListProps, type NavItem } from './layout/NavList.js';
```

- [ ] **Step 6: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec vitest run packages/console-ui/src/layout && corepack pnpm exec prettier --write "packages/console-ui/src/layout/**/*.{ts,tsx}" packages/console-ui/src/registry.ts packages/console-ui/src/index.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/layout packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the divider, toolbar, pane, and nav-list layout components"
```

---

### Task 12: Data-display — Table, List, KeyValue (TDD)

**Files:**
- Create (each with `.tsx`, `.intent.ts`, `.test.tsx`): `packages/console-ui/src/data/Table`, `List`, `KeyValue`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `cx`, `assertIntent`. `EmptyState` is not built until Task 14, so Table takes an `empty?: ReactNode` slot (caller supplies it).
- Produces: `interface Column<T> { key; header; align?; render?: (row: T) => ReactNode }`; `<Table<T> caption columns rows getRowId empty? />`; `<List<T> items renderItem getKey label? />`; `interface KeyValuePair { key; value }`; `<KeyValue pairs />`.

- [ ] **Step 1: Write the failing tests**

`packages/console-ui/src/data/Table.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Table, type Column } from './Table.js';

interface Row { id: string; verb: string; cost: number }
const columns: Column<Row>[] = [
  { key: 'verb', header: 'Verb' },
  { key: 'cost', header: 'Cost', align: 'end', render: (r) => `$${r.cost.toFixed(2)}` },
];

describe('Table', () => {
  it('renders headers and rendered cells', () => {
    render(<Table caption="Ledger" columns={columns} rows={[{ id: '1', verb: 'emit', cost: 2 }]} getRowId={(r) => r.id} />);
    expect(screen.getByRole('columnheader', { name: 'Verb' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '$2.00' })).toBeInTheDocument();
  });
  it('shows the empty slot when there are no rows (states-first)', () => {
    render(<Table caption="Ledger" columns={columns} rows={[]} getRowId={(r) => r.id} empty={<span>No entries yet</span>} />);
    expect(screen.getByText('No entries yet')).toBeInTheDocument();
    expect(screen.queryByRole('row')).toBeNull();
  });
});
```
`packages/console-ui/src/data/List.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { List } from './List.js';

describe('List', () => {
  it('renders each item and labels the list', () => {
    render(<List label="Flags" items={['a', 'b']} getKey={(x) => x} renderItem={(x) => <span>{x.toUpperCase()}</span>} />);
    const list = screen.getByRole('list', { name: 'Flags' });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});
```
`packages/console-ui/src/data/KeyValue.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KeyValue } from './KeyValue.js';

describe('KeyValue', () => {
  it('renders term/description pairs', () => {
    render(<KeyValue pairs={[{ key: 'Model', value: 'opus' }, { key: 'Turns', value: '12' }]} />);
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('opus')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm exec vitest run packages/console-ui/src/data/Table.test.tsx packages/console-ui/src/data/List.test.tsx packages/console-ui/src/data/KeyValue.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three components**

`packages/console-ui/src/data/Table.tsx`:
```tsx
import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'start' | 'end';
  render?: (row: T) => ReactNode;
}

export interface TableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Rendered in place of the body when rows is empty (states-first). */
  empty?: ReactNode;
  className?: string;
}

export function Table<T>({ caption, columns, rows, getRowId, empty, className }: TableProps<T>): React.JSX.Element {
  if (rows.length === 0 && empty !== undefined) {
    return <div role="status" className="p-4 text-center text-[12px] text-muted">{empty}</div>;
  }
  return (
    <table className={cx('w-full border-collapse text-[13px]', className)}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={cx('border-b border-hairline px-2 py-1 font-medium text-faint', c.align === 'end' ? 'text-right' : 'text-left')}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={getRowId(row)}>
            {columns.map((c) => {
              const raw = c.render ? c.render(row) : (row as Record<string, ReactNode>)[c.key];
              return (
                <td key={c.key} className={cx('border-b border-hairline px-2 py-1 text-fg', c.align === 'end' ? 'text-right tabular-nums' : 'text-left')}>
                  {raw}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```
`packages/console-ui/src/data/List.tsx`:
```tsx
import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface ListProps<T> {
  items: T[];
  renderItem: (item: T) => ReactNode;
  getKey: (item: T) => string;
  label?: string;
  className?: string;
}

export function List<T>({ items, renderItem, getKey, label, className }: ListProps<T>): React.JSX.Element {
  return (
    <ul {...(label !== undefined ? { 'aria-label': label } : {})} className={cx('flex flex-col', className)}>
      {items.map((item) => (
        <li key={getKey(item)} className="px-2 py-1 text-[13px] text-fg">{renderItem(item)}</li>
      ))}
    </ul>
  );
}
```
`packages/console-ui/src/data/KeyValue.tsx`:
```tsx
import { cx } from '../lib/cx.js';

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface KeyValueProps {
  pairs: KeyValuePair[];
  className?: string;
}

export function KeyValue({ pairs, className }: KeyValueProps): React.JSX.Element {
  return (
    <dl className={cx('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]', className)}>
      {pairs.map((p) => (
        <div key={p.key} className="contents">
          <dt className="text-muted">{p.key}</dt>
          <dd className="m-0 text-fg">{p.value}</dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/console-ui/src/data/Table.test.tsx packages/console-ui/src/data/List.test.tsx packages/console-ui/src/data/KeyValue.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Add intents, register, export**

```ts
export const tableIntent = assertIntent({ name: 'Table', family: 'Data-display', intent: 'Presents rows of records with aligned columns, empty state first.', useWhen: ['Showing the ledger, decisions, or timeline as scannable rows.'], dontUseWhen: ['Two fields of one record — use KeyValue.', 'A simple sequence — use List.'], anatomy: 'A caption, column headers, and rows with per-column render + alignment; an empty slot.', variantsStates: ['populated', 'empty'], accessibility: 'Semantic table with scoped column headers and an sr-only caption.', related: ['List', 'KeyValue'] });
export const listIntent = assertIntent({ name: 'List', family: 'Data-display', intent: 'Renders a simple sequence of items with a custom item renderer.', useWhen: ['A flat sequence (flags, files) without columnar structure.'], dontUseWhen: ['Records with multiple aligned fields — use Table.'], anatomy: 'A semantic list of rendered items.', variantsStates: ['rest'], accessibility: 'role=list/listitem; optional aria-label.', related: ['Table', 'KeyValue'] });
export const keyValueIntent = assertIntent({ name: 'KeyValue', family: 'Data-display', intent: 'Shows term/value pairs for a single record.', useWhen: ['Displaying metadata of one thing (model, turns, mode).'], dontUseWhen: ['Many records — use Table.'], anatomy: 'A description list of term/description pairs on a two-column grid.', variantsStates: ['rest'], accessibility: 'Semantic dl/dt/dd.', related: ['Table', 'Stat'] });
```
Register all three; export from `index.ts`:
```ts
export { Table, type TableProps, type Column } from './data/Table.js';
export { List, type ListProps } from './data/List.js';
export { KeyValue, type KeyValueProps, type KeyValuePair } from './data/KeyValue.js';
```

- [ ] **Step 6: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec vitest run packages/console-ui/src/data && corepack pnpm exec prettier --write "packages/console-ui/src/data/**/*.{ts,tsx}" packages/console-ui/src/registry.ts packages/console-ui/src/index.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/data/Table.tsx packages/console-ui/src/data/List.tsx packages/console-ui/src/data/KeyValue.tsx packages/console-ui/src/data/Table.intent.ts packages/console-ui/src/data/List.intent.ts packages/console-ui/src/data/KeyValue.intent.ts packages/console-ui/src/data/Table.test.tsx packages/console-ui/src/data/List.test.tsx packages/console-ui/src/data/KeyValue.test.tsx packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the table, list, and key-value data components"
```

---

### Task 13: Data-display — Code, Badge, Stat (TDD)

**Files:**
- Create (each with `.tsx`, `.intent.ts`, `.test.tsx`): `packages/console-ui/src/data/Code`, `Badge`, `Stat`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `cx`, `assertIntent`. `Status` type from `feedback/Banner.js` (reuse the tone union).
- Produces: `<Code block? children />` (byte-faithful monospace); `type BadgeTone = 'neutral' | Status`; `<Badge tone? children />`; `<Stat label value sub? tone? />`.

- [ ] **Step 1: Write the failing tests**

`packages/console-ui/src/data/Code.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Code } from './Code.js';

describe('Code', () => {
  it('renders inline code verbatim', () => {
    render(<Code>M1.emit()</Code>);
    expect(screen.getByText('M1.emit()')).toBeInTheDocument();
  });
  it('preserves whitespace byte-faithfully in block mode', () => {
    const src = '  line1\n    line2';
    const { container } = render(<Code block>{src}</Code>);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(src);
  });
});
```
`packages/console-ui/src/data/Badge.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders a toned label', () => {
    render(<Badge tone="danger">crit</Badge>);
    expect(screen.getByText('crit')).toHaveAttribute('data-tone', 'danger');
  });
});
```
`packages/console-ui/src/data/Stat.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stat } from './Stat.js';

describe('Stat', () => {
  it('renders a labelled metric with value and sub', () => {
    render(<Stat label="Cost" value="$2.14" sub="of $5.00" />);
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('$2.14')).toBeInTheDocument();
    expect(screen.getByText('of $5.00')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm exec vitest run packages/console-ui/src/data/Code.test.tsx packages/console-ui/src/data/Badge.test.tsx packages/console-ui/src/data/Stat.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three components**

`packages/console-ui/src/data/Code.tsx`:
```tsx
import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface CodeProps {
  /** Block renders a <pre> preserving whitespace; otherwise inline <code>. */
  block?: boolean;
  children: ReactNode;
  className?: string;
}

const mono = 'font-mono text-[12px] text-fg';

export function Code({ block = false, children, className }: CodeProps): React.JSX.Element {
  return block ? (
    <pre className={cx(mono, 'overflow-auto whitespace-pre rounded-surface border border-hairline bg-subtle p-2 leading-[1.55]', className)}>
      {children}
    </pre>
  ) : (
    <code className={cx(mono, 'rounded-[3px] bg-subtle px-1 py-0.5', className)}>{children}</code>
  );
}
```
`packages/console-ui/src/data/Badge.tsx`:
```tsx
import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';
import type { Status } from '../feedback/Banner.js';

export type BadgeTone = 'neutral' | Status;

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const byTone: Record<BadgeTone, string> = {
  neutral: 'bg-element text-muted border-border-default',
  info: 'bg-info-tint text-info-text border-transparent',
  success: 'bg-success-tint text-success-text border-transparent',
  warning: 'bg-warning-tint text-warning-text border-transparent',
  danger: 'bg-danger-tint text-danger-text border-transparent',
};

export function Badge({ tone = 'neutral', children, className }: BadgeProps): React.JSX.Element {
  return (
    <span data-tone={tone} className={cx('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none', byTone[tone], className)}>
      {children}
    </span>
  );
}
```
`packages/console-ui/src/data/Stat.tsx`:
```tsx
import { useId } from 'react';
import { cx } from '../lib/cx.js';
import type { Status } from '../feedback/Banner.js';

export interface StatProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | Status;
  className?: string;
}

const valueTone: Record<'default' | Status, string> = {
  default: 'text-fg',
  info: 'text-info-text',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
};

export function Stat({ label, value, sub, tone = 'default', className }: StatProps): React.JSX.Element {
  const labelId = useId();
  return (
    <div className={cx('flex flex-col gap-0.5', className)}>
      <span id={labelId} className="text-[10px] font-medium uppercase tracking-[0.06em] text-faint">{label}</span>
      <span aria-labelledby={labelId} className={cx('text-[18px] font-semibold tabular-nums', valueTone[tone])}>{value}</span>
      {sub !== undefined && <span className="text-[11px] text-muted">{sub}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/console-ui/src/data/Code.test.tsx packages/console-ui/src/data/Badge.test.tsx packages/console-ui/src/data/Stat.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Add intents, register, export**

```ts
export const codeIntent = assertIntent({ name: 'Code', family: 'Data-display', intent: 'Renders code or identifiers verbatim in monospace.', useWhen: ['Showing a symbol, path, command, or byte-faithful block.'], dontUseWhen: ['Prose — use normal text.'], anatomy: 'Inline <code> or a whitespace-preserving <pre> block.', variantsStates: ['inline', 'block'], accessibility: 'Preserves bytes exactly; no truncation or normalization.', related: ['KeyValue'] });
export const badgeIntent = assertIntent({ name: 'Badge', family: 'Data-display', intent: 'A small toned label for a status, count, or category.', useWhen: ['Tagging severity, plan, or a small count next to a heading.'], dontUseWhen: ['It is an interactive filter — use a Button/Toggle.'], anatomy: 'A rounded pill with a tone and short text.', variantsStates: ['neutral', 'info', 'success', 'warning', 'danger'], accessibility: 'Tone is conveyed by text, not color alone; data-tone for styling.', related: ['Stat', 'Icon'] });
export const statIntent = assertIntent({ name: 'Stat', family: 'Data-display', intent: 'A single labelled metric with an optional sub-line.', useWhen: ['Surfacing a headline number (cost, turns) in the dashboard rail.'], dontUseWhen: ['Several related fields — use KeyValue.'], anatomy: 'An eyebrow label, a large tabular value, an optional sub-line.', variantsStates: ['default', 'info', 'success', 'warning', 'danger'], accessibility: 'Value is labelled by its eyebrow id; numbers use tabular figures.', related: ['KeyValue', 'Badge'] });
```
Register all three; export from `index.ts`:
```ts
export { Code, type CodeProps } from './data/Code.js';
export { Badge, type BadgeProps, type BadgeTone } from './data/Badge.js';
export { Stat, type StatProps } from './data/Stat.js';
```

- [ ] **Step 6: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec vitest run packages/console-ui/src/data && corepack pnpm exec prettier --write "packages/console-ui/src/data/**/*.{ts,tsx}" packages/console-ui/src/registry.ts packages/console-ui/src/index.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/data/Code.tsx packages/console-ui/src/data/Badge.tsx packages/console-ui/src/data/Stat.tsx packages/console-ui/src/data/Code.intent.ts packages/console-ui/src/data/Badge.intent.ts packages/console-ui/src/data/Stat.intent.ts packages/console-ui/src/data/Code.test.tsx packages/console-ui/src/data/Badge.test.tsx packages/console-ui/src/data/Stat.test.tsx packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the code, badge, and stat data components"
```

---

### Task 14: Feedback family — Toast, InlineMessage, Progress, Spinner, Skeleton, EmptyState (TDD)

**Files:**
- Create (each with `.tsx`, `.intent.ts`, `.test.tsx`): `packages/console-ui/src/feedback/Toast`, `InlineMessage`, `Progress`, `Spinner`, `Skeleton`, `EmptyState`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `cx`, `Icon`, `assertIntent`, `Status` (from `feedback/Banner.js`), `radix-ui` `Toast`, Lucide (`Loader2`, `Info`, tone icons).
- Produces: `<ToastProvider>…</ToastProvider>` + `<Toast open onOpenChange? tone? title children? />`; `<InlineMessage tone>…</InlineMessage>`; `<Progress value max? label />`; `<Spinner label? size? />`; `<Skeleton className? />`; `<EmptyState icon title description action? />`.

- [ ] **Step 1: Write the failing tests**

`packages/console-ui/src/feedback/Toast.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Toast, ToastProvider } from './Toast.js';

describe('Toast', () => {
  it('renders an open toast inside the provider', async () => {
    render(<ToastProvider><Toast open tone="success" title="Saved">Layout persisted</Toast></ToastProvider>);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Layout persisted')).toBeInTheDocument();
  });
});
```
`packages/console-ui/src/feedback/InlineMessage.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineMessage } from './InlineMessage.js';

describe('InlineMessage', () => {
  it('renders toned inline text', () => {
    render(<InlineMessage tone="warning">Unsaved changes</InlineMessage>);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByTestId('inline-message')).toHaveAttribute('data-tone', 'warning');
  });
});
```
`packages/console-ui/src/feedback/Progress.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Progress } from './Progress.js';

describe('Progress', () => {
  it('exposes a labelled determinate progressbar', () => {
    render(<Progress value={43} label="Uploading" />);
    const bar = screen.getByRole('progressbar', { name: 'Uploading' });
    expect(bar).toHaveAttribute('aria-valuenow', '43');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });
});
```
`packages/console-ui/src/feedback/Spinner.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner.js';

describe('Spinner', () => {
  it('is a labelled live status', () => {
    render(<Spinner label="Loading turns" />);
    expect(screen.getByRole('status', { name: 'Loading turns' })).toBeInTheDocument();
  });
});
```
`packages/console-ui/src/feedback/Skeleton.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton.js';

describe('Skeleton', () => {
  it('is decorative and hidden from assistive tech', () => {
    render(<Skeleton data-testid="sk" />);
    expect(screen.getByTestId('sk')).toHaveAttribute('aria-hidden', 'true');
  });
});
```
`packages/console-ui/src/feedback/EmptyState.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('renders icon, title, description, and an optional action', () => {
    render(<EmptyState icon={Inbox} title="No decisions yet" description="They appear as the agent works." action={<button type="button">Refresh</button>} />);
    expect(screen.getByText('No decisions yet')).toBeInTheDocument();
    expect(screen.getByText('They appear as the agent works.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm exec vitest run packages/console-ui/src/feedback/Toast.test.tsx packages/console-ui/src/feedback/InlineMessage.test.tsx packages/console-ui/src/feedback/Progress.test.tsx packages/console-ui/src/feedback/Spinner.test.tsx packages/console-ui/src/feedback/Skeleton.test.tsx packages/console-ui/src/feedback/EmptyState.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the six components**

`packages/console-ui/src/feedback/Toast.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Toast as RxToast } from 'radix-ui';
import { X } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';
import type { Status } from './Banner.js';

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <RxToast.Provider swipeDirection="right">
      {children}
      <RxToast.Viewport className="fixed bottom-3 right-3 z-[600] flex w-80 flex-col gap-2 outline-none" />
    </RxToast.Provider>
  );
}

export interface ToastProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  tone?: Status;
  title: string;
  children?: ReactNode;
}

const toneClass: Record<Status, string> = {
  info: 'border-info/40',
  success: 'border-success/40',
  warning: 'border-warning/40',
  danger: 'border-danger/50',
};

export function Toast({ open, onOpenChange, tone = 'info', title, children }: ToastProps): React.JSX.Element {
  return (
    <RxToast.Root
      open={open}
      {...(onOpenChange !== undefined ? { onOpenChange } : {})}
      data-tone={tone}
      className={cx('flex items-start gap-2 rounded-surface border bg-raised px-3 py-2 text-[12px] shadow-lg', toneClass[tone])}
    >
      <div className="flex-1">
        <RxToast.Title className="font-medium text-fg">{title}</RxToast.Title>
        {children !== undefined && <RxToast.Description className="text-muted">{children}</RxToast.Description>}
      </div>
      <RxToast.Close aria-label="Dismiss" className={cx('shrink-0 rounded-control p-0.5 hover:bg-element-hover', focusRing)}>
        <Icon name={X} size={14} />
      </RxToast.Close>
    </RxToast.Root>
  );
}
```
`packages/console-ui/src/feedback/InlineMessage.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Info, CircleCheck, TriangleAlert, OctagonAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';
import type { Status } from './Banner.js';

export interface InlineMessageProps {
  tone: Status;
  children: ReactNode;
  className?: string;
}

const toneIcon: Record<Status, LucideIcon> = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: OctagonAlert };
const toneText: Record<Status, string> = {
  info: 'text-info-text',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
};

export function InlineMessage({ tone, children, className }: InlineMessageProps): React.JSX.Element {
  return (
    <span
      data-testid="inline-message"
      data-tone={tone}
      role={tone === 'danger' ? 'alert' : undefined}
      className={cx('inline-flex items-center gap-1 text-[12px]', toneText[tone], className)}
    >
      <Icon name={toneIcon[tone]} size={13} />
      {children}
    </span>
  );
}
```
`packages/console-ui/src/feedback/Progress.tsx`:
```tsx
import { cx } from '../lib/cx.js';

export interface ProgressProps {
  value: number;
  max?: number;
  label: string;
  className?: string;
}

export function Progress({ value, max = 100, label, className }: ProgressProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cx('h-1.5 w-full overflow-hidden rounded-full bg-element', className)}
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-normal" style={{ width: `${pct}%` }} />
    </div>
  );
}
```
`packages/console-ui/src/feedback/Spinner.tsx`:
```tsx
import { Loader2 } from 'lucide-react';
import { cx } from '../lib/cx.js';

export interface SpinnerProps {
  label?: string;
  size?: number;
  className?: string;
}

export function Spinner({ label = 'Loading', size = 16, className }: SpinnerProps): React.JSX.Element {
  return (
    <span role="status" aria-label={label} aria-live="polite" className={cx('inline-flex text-muted', className)}>
      <Loader2 size={size} strokeWidth={2} aria-hidden className="animate-spin motion-reduce:animate-none" />
    </span>
  );
}
```
`packages/console-ui/src/feedback/Skeleton.tsx`:
```tsx
import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx.js';

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...rest }: SkeletonProps): React.JSX.Element {
  return <div aria-hidden className={cx('h-4 w-full rounded-control bg-element animate-pulse motion-reduce:animate-none', className)} {...rest} />;
}
```
`packages/console-ui/src/feedback/EmptyState.tsx`:
```tsx
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps): React.JSX.Element {
  return (
    <div className={cx('flex flex-col items-center gap-2 px-6 py-8 text-center', className)}>
      <span className="text-faint"><Icon name={icon} size={24} /></span>
      <div className="text-[13px] font-medium text-fg">{title}</div>
      <div className="max-w-xs text-[12px] text-muted">{description}</div>
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/console-ui/src/feedback/Toast.test.tsx packages/console-ui/src/feedback/InlineMessage.test.tsx packages/console-ui/src/feedback/Progress.test.tsx packages/console-ui/src/feedback/Spinner.test.tsx packages/console-ui/src/feedback/Skeleton.test.tsx packages/console-ui/src/feedback/EmptyState.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Add intents, register, export**

```ts
export const toastIntent = assertIntent({ name: 'Toast', family: 'Feedback', intent: 'A transient confirmation that auto-dismisses.', useWhen: ['Confirming a completed local action (saved, copied).'], dontUseWhen: ['The condition persists — use Banner.', 'It is a system deny — use DenyNotice.'], anatomy: 'A provider + viewport hosting toast roots with title, body, and close.', variantsStates: ['info', 'success', 'warning', 'danger', 'open/closed'], accessibility: 'Radix toast live region; close has an accessible label.', related: ['Banner', 'InlineMessage'] });
export const inlineMessageIntent = assertIntent({ name: 'InlineMessage', family: 'Feedback', intent: 'A compact toned message shown inline with content.', useWhen: ['A short status next to a control or row (unsaved, syncing).'], dontUseWhen: ['A region-level condition — use Banner.', 'A validation error on a field — use the Field error.'], anatomy: 'A tone icon and short text.', variantsStates: ['info', 'success', 'warning', 'danger'], accessibility: 'Danger uses role=alert; tone carried by icon, not color alone.', related: ['Banner', 'Toast'] });
export const progressIntent = assertIntent({ name: 'Progress', family: 'Feedback', intent: 'A determinate bar for a measurable long operation.', useWhen: ['An operation over ~10s with known completion (>10s triage step).'], dontUseWhen: ['Duration is unknown — use Spinner.', 'A structured region is loading — use Skeleton.'], anatomy: 'A track with a filled bar sized to the value.', variantsStates: ['0–100%'], accessibility: 'role=progressbar with aria-valuenow/min/max and a label.', related: ['Spinner', 'Skeleton'] });
export const spinnerIntent = assertIntent({ name: 'Spinner', family: 'Feedback', intent: 'An indeterminate busy indicator for a single module.', useWhen: ['A short (~1–2s) wait with unknown duration on one control/module.'], dontUseWhen: ['A structured pane is loading — use Skeleton.', 'Completion is measurable — use Progress.'], anatomy: 'A rotating loader glyph in a live status.', variantsStates: ['spinning'], accessibility: 'role=status, aria-live=polite, labelled; honors reduced motion.', related: ['Progress', 'Skeleton'] });
export const skeletonIntent = assertIntent({ name: 'Skeleton', family: 'Feedback', intent: 'A placeholder block for structured content that is loading.', useWhen: ['A pane with known shape (timeline, ledger) is loading 2–10s.'], dontUseWhen: ['A single control is busy — use Spinner.'], anatomy: 'A pulsing rounded block sized to the incoming content.', variantsStates: ['pulsing'], accessibility: 'aria-hidden (decorative); honors reduced motion.', related: ['Spinner', 'EmptyState'] });
export const emptyStateIntent = assertIntent({ name: 'EmptyState', family: 'Feedback', intent: 'Explains why a region is empty and what to do next.', useWhen: ['A list/table/pane has no content yet — designed before the happy path.'], dontUseWhen: ['It is loading — use Skeleton.', 'It is an error — use Banner/InlineMessage.'], anatomy: 'An icon, a title, a description, and an optional action.', variantsStates: ['with action', 'without action'], accessibility: 'Icon is decorative; meaning is in the text.', related: ['Skeleton', 'Banner'] });
```
Register all six; export from `index.ts`:
```ts
export { Toast, ToastProvider, type ToastProps } from './feedback/Toast.js';
export { InlineMessage, type InlineMessageProps } from './feedback/InlineMessage.js';
export { Progress, type ProgressProps } from './feedback/Progress.js';
export { Spinner, type SpinnerProps } from './feedback/Spinner.js';
export { Skeleton, type SkeletonProps } from './feedback/Skeleton.js';
export { EmptyState, type EmptyStateProps } from './feedback/EmptyState.js';
```

- [ ] **Step 6: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec vitest run packages/console-ui/src/feedback && corepack pnpm exec prettier --write "packages/console-ui/src/feedback/**/*.{ts,tsx}" packages/console-ui/src/registry.ts packages/console-ui/src/index.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/feedback/Toast.tsx packages/console-ui/src/feedback/InlineMessage.tsx packages/console-ui/src/feedback/Progress.tsx packages/console-ui/src/feedback/Spinner.tsx packages/console-ui/src/feedback/Skeleton.tsx packages/console-ui/src/feedback/EmptyState.tsx packages/console-ui/src/feedback/Toast.intent.ts packages/console-ui/src/feedback/InlineMessage.intent.ts packages/console-ui/src/feedback/Progress.intent.ts packages/console-ui/src/feedback/Spinner.intent.ts packages/console-ui/src/feedback/Skeleton.intent.ts packages/console-ui/src/feedback/EmptyState.intent.ts packages/console-ui/src/feedback/Toast.test.tsx packages/console-ui/src/feedback/InlineMessage.test.tsx packages/console-ui/src/feedback/Progress.test.tsx packages/console-ui/src/feedback/Spinner.test.tsx packages/console-ui/src/feedback/Skeleton.test.tsx packages/console-ui/src/feedback/EmptyState.test.tsx packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the toast, inline-message, progress, spinner, skeleton, and empty-state components"
```

---

### Task 15: Overlays family — Dialog, Popover, Tooltip, Sheet (TDD)

**Files:**
- Create (each with `.tsx`, `.intent.ts`, `.test.tsx`): `packages/console-ui/src/overlays/Dialog`, `Popover`, `Tooltip`, `Sheet`
- Modify: `packages/console-ui/src/registry.ts`, `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `cx`, `focusRing`, `Icon`, `assertIntent`, `radix-ui` `Dialog`/`Popover`/`Tooltip`, Lucide (`X`).
- Produces: `<Dialog trigger title description? children footer? />`; `<Popover trigger children />`; `<Tooltip content>…</Tooltip>` (+ `TooltipProvider`); `type SheetSide = 'left' | 'right'`; `<Sheet trigger title side? children />`.

- [ ] **Step 1: Write the failing tests**

`packages/console-ui/src/overlays/Dialog.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Dialog } from './Dialog.js';

describe('Dialog', () => {
  it('opens from its trigger and shows a titled modal', async () => {
    render(<Dialog trigger={<button type="button">Open</button>} title="Confirm rewind">Body text</Dialog>);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm rewind' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
  });
  it('closes on Escape', async () => {
    render(<Dialog trigger={<button type="button">Open</button>} title="Confirm">Body</Dialog>);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
```
`packages/console-ui/src/overlays/Popover.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Popover } from './Popover.js';

describe('Popover', () => {
  it('reveals its content on trigger', async () => {
    render(<Popover trigger={<button type="button">Details</button>}><span>Extra info</span></Popover>);
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(await screen.findByText('Extra info')).toBeInTheDocument();
  });
});
```
`packages/console-ui/src/overlays/Tooltip.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip, TooltipProvider } from './Tooltip.js';

describe('Tooltip', () => {
  it('shows its content when the trigger is focused', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="Rewind to this checkpoint"><button type="button">Rewind</button></Tooltip>
      </TooltipProvider>,
    );
    await userEvent.tab();
    expect(await screen.findByRole('tooltip', { name: 'Rewind to this checkpoint' })).toBeInTheDocument();
  });
});
```
`packages/console-ui/src/overlays/Sheet.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Sheet } from './Sheet.js';

describe('Sheet', () => {
  it('opens a side drawer as a titled dialog', async () => {
    render(<Sheet trigger={<button type="button">Settings</button>} title="Settings" side="right">Panel</Sheet>);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveAttribute('data-side', 'right');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm exec vitest run packages/console-ui/src/overlays`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four overlays**

`packages/console-ui/src/overlays/Dialog.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Dialog as RxDialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface DialogProps {
  trigger: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Dialog({ trigger, title, description, children, footer }: DialogProps): React.JSX.Element {
  return (
    <RxDialog.Root>
      <RxDialog.Trigger asChild>{trigger}</RxDialog.Trigger>
      <RxDialog.Portal>
        <RxDialog.Overlay className="fixed inset-0 z-[400] bg-black/50" />
        <RxDialog.Content className="fixed left-1/2 top-1/2 z-[400] w-[28rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-overlay border border-border-default bg-raised p-4 text-[13px] text-fg shadow-xl focus:outline-none">
          <div className="mb-2 flex items-start justify-between gap-4">
            <RxDialog.Title className="text-[14px] font-semibold text-fg">{title}</RxDialog.Title>
            <RxDialog.Close aria-label="Close" className={cx('rounded-control p-0.5 text-muted hover:bg-element-hover', focusRing)}>
              <Icon name={X} size={16} />
            </RxDialog.Close>
          </div>
          {description !== undefined && <RxDialog.Description className="mb-2 text-muted">{description}</RxDialog.Description>}
          <div>{children}</div>
          {footer !== undefined && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
        </RxDialog.Content>
      </RxDialog.Portal>
    </RxDialog.Root>
  );
}
```
`packages/console-ui/src/overlays/Popover.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Popover as RxPopover } from 'radix-ui';

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
}

export function Popover({ trigger, children }: PopoverProps): React.JSX.Element {
  return (
    <RxPopover.Root>
      <RxPopover.Trigger asChild>{trigger}</RxPopover.Trigger>
      <RxPopover.Portal>
        <RxPopover.Content
          sideOffset={6}
          className="z-[500] max-w-xs rounded-surface border border-border-default bg-raised p-3 text-[13px] text-fg shadow-lg focus:outline-none"
        >
          {children}
        </RxPopover.Content>
      </RxPopover.Portal>
    </RxPopover.Root>
  );
}
```
`packages/console-ui/src/overlays/Tooltip.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Tooltip as RxTooltip } from 'radix-ui';

export function TooltipProvider({ children, delayDuration = 300 }: { children: ReactNode; delayDuration?: number }): React.JSX.Element {
  return <RxTooltip.Provider delayDuration={delayDuration}>{children}</RxTooltip.Provider>;
}

export interface TooltipProps {
  content: string;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps): React.JSX.Element {
  return (
    <RxTooltip.Root>
      <RxTooltip.Trigger asChild>{children}</RxTooltip.Trigger>
      <RxTooltip.Portal>
        <RxTooltip.Content
          sideOffset={4}
          className="z-[700] rounded-control bg-raised px-2 py-1 text-[12px] text-fg shadow-md"
        >
          {content}
          <RxTooltip.Arrow className="fill-[var(--color-bg-raised)]" />
        </RxTooltip.Content>
      </RxTooltip.Portal>
    </RxTooltip.Root>
  );
}
```
`packages/console-ui/src/overlays/Sheet.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Dialog as RxDialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export type SheetSide = 'left' | 'right';

export interface SheetProps {
  trigger: ReactNode;
  title: string;
  side?: SheetSide;
  children: ReactNode;
}

export function Sheet({ trigger, title, side = 'right', children }: SheetProps): React.JSX.Element {
  return (
    <RxDialog.Root>
      <RxDialog.Trigger asChild>{trigger}</RxDialog.Trigger>
      <RxDialog.Portal>
        <RxDialog.Overlay className="fixed inset-0 z-[400] bg-black/50" />
        <RxDialog.Content
          data-side={side}
          className={cx(
            'fixed inset-y-0 z-[400] w-80 max-w-[92vw] border-border-default bg-raised p-4 text-[13px] text-fg shadow-xl focus:outline-none',
            side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          )}
        >
          <div className="mb-2 flex items-start justify-between gap-4">
            <RxDialog.Title className="text-[14px] font-semibold text-fg">{title}</RxDialog.Title>
            <RxDialog.Close aria-label="Close" className={cx('rounded-control p-0.5 text-muted hover:bg-element-hover', focusRing)}>
              <Icon name={X} size={16} />
            </RxDialog.Close>
          </div>
          <div>{children}</div>
        </RxDialog.Content>
      </RxDialog.Portal>
    </RxDialog.Root>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/console-ui/src/overlays`
Expected: PASS (5 tests).

- [ ] **Step 5: Add intents, register, export**

```ts
export const dialogIntent = assertIntent({ name: 'Dialog', family: 'Overlays', intent: 'A focused modal for a confirmation or a small focused task.', useWhen: ['Confirming a consequential action (rewind) or a short focused edit.'], dontUseWhen: ['A large side surface fits better — use Sheet.', 'A hint suffices — use Tooltip/Popover.'], anatomy: 'A trigger, an overlay, and a titled content box with optional footer actions.', variantsStates: ['closed', 'open'], accessibility: 'Radix dialog: focus trap, Escape closes, labelled by its title; overlay scrim.', related: ['Sheet', 'Popover'] });
export const popoverIntent = assertIntent({ name: 'Popover', family: 'Overlays', intent: 'Non-modal floating content anchored to a trigger.', useWhen: ['Showing supplemental detail or a small control cluster on demand.'], dontUseWhen: ['The interaction is modal/blocking — use Dialog.', 'A one-line hint suffices — use Tooltip.'], anatomy: 'A trigger and a portalled, anchored content panel.', variantsStates: ['closed', 'open'], accessibility: 'Radix popover: focus management, Escape/outside-click dismiss.', related: ['Tooltip', 'Dialog', 'Menu'] });
export const tooltipIntent = assertIntent({ name: 'Tooltip', family: 'Overlays', intent: 'A brief hint revealed on hover or focus.', useWhen: ['Labelling an icon-only control or clarifying a term.'], dontUseWhen: ['The content is interactive — use Popover.', 'It is essential info — put it in the UI, not a hover.'], anatomy: 'A provider, a trigger, and a small floating label.', variantsStates: ['hidden', 'visible'], accessibility: 'role=tooltip, shows on focus as well as hover; provider controls delay.', related: ['Popover'] });
export const sheetIntent = assertIntent({ name: 'Sheet', family: 'Overlays', intent: 'A side drawer for a larger secondary surface.', useWhen: ['Settings, detail inspectors, or side forms that need room.'], dontUseWhen: ['A small confirmation — use Dialog.'], anatomy: 'A trigger and a side-anchored titled dialog with a scrim.', variantsStates: ['left', 'right', 'closed', 'open'], accessibility: 'Built on Radix dialog: focus trap, Escape closes, labelled by title.', related: ['Dialog', 'Pane'] });
```
Register all four; export from `index.ts`:
```ts
export { Dialog, type DialogProps } from './overlays/Dialog.js';
export { Popover, type PopoverProps } from './overlays/Popover.js';
export { Tooltip, TooltipProvider, type TooltipProps } from './overlays/Tooltip.js';
export { Sheet, type SheetProps, type SheetSide } from './overlays/Sheet.js';
```

- [ ] **Step 6: Gates + commit**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && corepack pnpm exec vitest run packages/console-ui/src/overlays && corepack pnpm exec prettier --write "packages/console-ui/src/overlays/**/*.{ts,tsx}" packages/console-ui/src/registry.ts packages/console-ui/src/index.ts && pnpm_config_verify_deps_before_run=false corepack pnpm format && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-ui/src/overlays packages/console-ui/src/registry.ts packages/console-ui/src/index.ts
git commit -m "feat: add the dialog, popover, tooltip, and sheet overlays"
```

---

### Task 16: Intent coverage, generated catalogue, and the design-system doc (TDD + docs)

**Files:**
- Create: `packages/console-ui/src/registry.test.ts`, `packages/console-ui/COMPONENTS.md` (generated), `packages/console-ui/scripts/gen-catalog.ts`
- Modify: `docs/UI.md`, `docs/REPO_LAYOUT.md`, `C:\Users\Zander\.claude\projects\c--Users-Zander-Documents-Side-Projects-coa\memory\m10-status.md`, `…\memory\MEMORY.md`

**Interfaces:**
- Consumes: `allIntents` (Task 3, now fully populated), `assertIntent`, `generateCatalog`.
- Produces: the coverage guarantee (every registered intent is valid + unique) and a committed, diff-checked `COMPONENTS.md`.

- [ ] **Step 1: Write the coverage + catalogue-freshness test**

`packages/console-ui/src/registry.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allIntents } from './registry.js';
import { assertIntent } from './lib/intent.js';
import { generateCatalog } from './lib/catalog.js';

describe('component registry', () => {
  it('holds a valid, complete intent for every registered component', () => {
    for (const intent of allIntents) expect(() => assertIntent(intent)).not.toThrow();
  });

  it('has no duplicate component names', () => {
    const names = allIntents.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers every built family', () => {
    const families = new Set(allIntents.map((i) => i.family));
    for (const f of ['Foundations', 'Actions', 'Inputs', 'Layout', 'Data-display', 'Feedback', 'Overlays']) {
      expect(families.has(f)).toBe(true);
    }
  });

  it('COMPONENTS.md is regenerated from the current intents (run gen-catalog if this fails)', () => {
    const path = fileURLToPath(new URL('../COMPONENTS.md', import.meta.url));
    const onDisk = readFileSync(path, 'utf8');
    expect(onDisk).toBe(generateCatalog(allIntents));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm exec vitest run packages/console-ui/src/registry.test.ts`
Expected: FAIL — `COMPONENTS.md` does not exist yet.

- [ ] **Step 3: Add the generator script + generate the catalogue**

`packages/console-ui/scripts/gen-catalog.ts`:
```ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allIntents } from '../src/registry.js';
import { generateCatalog } from '../src/lib/catalog.js';

const out = fileURLToPath(new URL('../COMPONENTS.md', import.meta.url));
writeFileSync(out, generateCatalog(allIntents), 'utf8');
process.stdout.write(`wrote ${allIntents.length} components to COMPONENTS.md\n`);
```
Run it to produce the file:
```bash
corepack pnpm exec tsx packages/console-ui/scripts/gen-catalog.ts
```
(If `tsx` is unavailable, run via vitest: add a temporary `it` that writes the file, or `corepack pnpm exec vite-node packages/console-ui/scripts/gen-catalog.ts`. The committed artifact is what matters.)

- [ ] **Step 4: Run the coverage test to verify it passes**

Run: `corepack pnpm exec vitest run packages/console-ui/src/registry.test.ts`
Expected: PASS (4 tests) — all ~34 intents valid, unique, every family present, and `COMPONENTS.md` matches.

- [ ] **Step 5: Replace the UI.md placeholder + finalize REPO_LAYOUT**

`docs/UI.md` — replace the body with the durable design-system doc: point to the spec (`docs/superpowers/specs/2026-06-30-console-frontend-foundation-design.md`) as the authority for principles/tokens/layout; note that the component kit now lives in `packages/console-ui` with per-component intent declarations compiled into `packages/console-ui/COMPONENTS.md`; keep the standing invariants summary (SC-1 single-deny-channel via `DenyNotice`, coa-raw sacred, catalogue-only, byte-faithful, accessibility floor). Update the `_Last reviewed_` footer to 2026-06-30.
`docs/REPO_LAYOUT.md` — confirm the `console-ui/` row notes it owns "design tokens + the component kit + COMPONENTS.md". Update the `_Last reviewed_` footer.

- [ ] **Step 6: Full-suite gates**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck && pnpm_config_verify_deps_before_run=false corepack pnpm lint && pnpm_config_verify_deps_before_run=false corepack pnpm test && pnpm_config_verify_deps_before_run=false corepack pnpm depcruise && corepack pnpm exec prettier --write "packages/console-ui/**/*.{ts,tsx,md}" docs/UI.md docs/REPO_LAYOUT.md && pnpm_config_verify_deps_before_run=false corepack pnpm format`
Expected: all pass — the full suite (648 baseline + all component tests) green.
Optional (manual): `pnpm_config_verify_deps_before_run=false corepack pnpm --filter @coa/desktop exec electron-vite build` — the app builds consuming the kit, and Tailwind generates utilities for the package sources.

- [ ] **Step 7: Update the M10 status memory**

Update `m10-status.md` to record: the component kit is BUILT (`packages/console-ui` owns tokens + the six families + Foundations Icon, ~34 components, each with a typed intent + tests; enforcement = presence/completeness via `assertIntent` + the registry coverage test; `COMPONENTS.md` is the generated catalogue). Tokens MOVED out of `apps/desktop` into the package. Note what is still deferred: Dense/Viz (P11) family and the AppShell/layout abstraction (Plan 3). Update the `MEMORY.md` index line accordingly.

- [ ] **Step 8: Commit**

```bash
git add packages/console-ui/src/registry.test.ts packages/console-ui/scripts/gen-catalog.ts packages/console-ui/COMPONENTS.md docs/UI.md docs/REPO_LAYOUT.md
git commit -m "feat: add component catalogue coverage and the design-system doc"
```

---

## Self-Review

**Spec coverage (§7 families):** Foundations (tokens Task 1; Icon Task 4) · Actions (Button T5; IconButton/ButtonGroup/Link/Menu T8) · Inputs (Field/TextField T6; Checkbox/Radio/Switch T9; Select/Combobox T10) · Layout (Divider/Toolbar/Pane/NavList T11) · Data-display (Table/List/KeyValue T12; Code/Badge/Stat T13) · Feedback (Banner/DenyNotice T7; Toast/InlineMessage/Progress/Spinner/Skeleton/EmptyState T14) · Overlays (Dialog/Popover/Tooltip/Sheet T15). Intent contract (§7) → Task 3 + every component. Feedback-contract states (§8) → `data-*`/ARIA per component + tests. Tokens-from-Tailwind (§4/§6) → Task 4. A11y floor (§15) → Radix + `focusRing` + redundant encoding, asserted in tests. SC-1 (§3) → `DenyNotice` (T7) surfaces only, gates nothing. Anti-slop/no-emoji (§14) → Lucide-only `Icon`, no emoji in any string. **Out of scope (by the locked decision):** Dense/Viz P11 family, AppShell + the layout abstraction (Plan 3), light-theme fine-tuning, `dockview`.

**Placeholder scan:** none — every component ships its interface, implementation, tests, and intent inline. The three verification notes (Task 1 Step 4 `radix-ui`/`lucide-react` resolved majors; Task 4 Step 2 `@source` depth; Task 16 Step 3 `tsx` availability) are checks against the real toolchain, not deferred work.

**Type consistency:** `ComponentIntent`/`assertIntent`/`generateCatalog`/`allIntents` (T3) reused in every task + T16. `ButtonVariant`/`ButtonSize` (T5) reused by `IconButton` (T8). `Status` (T7 Banner) reused by `Badge`/`Stat` (T13), `InlineMessage`/`Toast` (T14). `cx`/`focusRing` (T4) + `Icon` (T4) used throughout. `Field`/`FieldControlIds` (T6) reused by `TextField`; `Select` and `Combobox` (T10) provide their own labelling. Registry `allIntents` (T3) appended by every component task and asserted complete in T16.

**Motion/property allowlist:** only `transform`/`opacity` animate — `Spinner` (`animate-spin`), `Skeleton` (`animate-pulse`), `Switch` thumb (`translate`), transitions on `background-color`/`border-color`/`color`/`width` for non-layout feedback; all honor `motion-reduce`.

---

_Last reviewed: 2026-06-30_
