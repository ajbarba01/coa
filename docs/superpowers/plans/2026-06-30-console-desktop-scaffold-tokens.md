# Console Desktop Scaffold + Design Tokens + Testable Seams — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `apps/desktop` (Electron) as a themed shell that boots, connects to (or spawns) the coa daemon, and renders one real read verb (`capState`) through a pure, unit-tested view-model — the D85 floor's foundation.

**Architecture:** Three-layer seam per the spec — the **main** process holds the JSON-RPC pipe client to the daemon (`@coa/core`), a **preload** bridge exposes one Zod-validated method per channel over `contextBridge`, and the sandboxed **renderer** (React) maps daemon results to render props via a pure `@coa/console-viewmodel` package and paints them with CSS-custom-property design tokens. Only pure modules (tokens, view-model, IPC schemas, daemon-resolver) are TDD-unit-tested; the Electron wiring is verified by booting the app.

**Tech Stack:** Electron + electron-vite + React 19 + Tailwind v4 (configured from tokens) + Zod 4 · pnpm workspaces · Vitest 4 · TypeScript 6 (strict).

**Spec:** `docs/superpowers/specs/2026-06-30-console-frontend-foundation-design.md` (§4 stack, §6 tokens, §10 app-shell, §13 visual direction, §17 testability).

## Global Constraints

_Every task's requirements implicitly include these._

- **TypeScript `strict`, no `any`.** All new packages extend `tsconfig.base.json` (composite, NodeNext, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- **Node ≥ 22.20.0 · pnpm 11.9.0** (`packageManager` pins it — invoke via `corepack pnpm …`).
- **Gates (all must pass before each commit):** `corepack pnpm typecheck · lint · format · test · depcruise`. `format` is a check — fix with `corepack pnpm exec prettier --write <files>`. Run a single test file from the repo root: `corepack pnpm exec vitest run <path>` (the per-package `--filter` does not match the root include glob).
- **Supply-chain hygiene.** New dependencies default to `--ignore-scripts`; only the native-addon allowlist in `pnpm-workspace.yaml` (`allowBuilds`) may run install scripts. A new dep newer than the minimum-release-age window must be added to `pnpm-workspace.yaml`'s `minimumReleaseAgeExclude` (mirror the existing entries). Electron/React/Tailwind carry **no** native addons that load in the daemon — the renderer is sandboxed and loads none; native addons (`better-sqlite3`) stay in the **daemon** (`@coa/core`, main-process import) and are rebuilt for **Node's** ABI, never Electron's.
- **Renderer isolation (hard).** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`; a restrictive CSP with `connect-src 'none'`. The renderer imports **no** `@coa/core` and **no** `electron` — only `@coa/console-viewmodel`, `@coa/shared` types, React, and the token module.
- **`@coa/console-viewmodel` is pure.** It imports only `zod` (+ `@coa/shared` types if needed). It must never import `electron`, `react`, or `@coa/core` — enforced by a dependency-cruiser rule (Task 6).
- **Byte-faithful / no emoji.** No emoji in any UI string, label, or state. Renders show bytes as-is; no silent truncation.
- **Commits:** subject-only Conventional Commits — **no body, no trailers, no `Co-Authored-By`, no "Generated with"**, and **no internal identifiers** (no `M10`, `D114`, etc.) in the subject. Stage files **by name** (never `git add -A`). One logical unit per commit.
- **Same-commit doc rule:** adding a package/app updates `docs/REPO_LAYOUT.md` and the dependency-cruiser ruleset in the **same** commit (Task 6 bundles the docs with the wiring it describes; earlier tasks that add a package include their own map/rule edits).

---

## File Structure

```
packages/console-viewmodel/            NEW · @coa/console-viewmodel — pure daemon-result→props (Task 3)
  package.json · tsconfig.json · tsdown.config.ts
  src/index.ts                         barrel
  src/cap.ts                           CapStateSchema + CapViewModel + toCapViewModel
  src/cap.test.ts

apps/desktop/                          NEW · @coa/desktop — Electron app (Tasks 1,2,4,5)
  package.json · tsconfig.json · electron.vite.config.ts · electron-builder.yml
  src/main/index.ts                    main: window + pipe client (connect-or-spawn) + IPC handlers
  src/main/daemon.ts                   resolveDaemon() connect-or-spawn (Task 4, TDD)
  src/main/daemon.test.ts
  src/preload/index.ts                 contextBridge: window.coa.getCap()
  src/shared/ipc.ts                    IPC channel names + Zod payload schemas (Task 4, TDD)
  src/shared/ipc.test.ts
  src/tokens/palette.ts                Tier-1 primitives (Task 2)
  src/tokens/semantic.ts               Tier-2 semantic map (light/dark/density)
  src/tokens/tokens.ts                 resolveTokens() + tokensToCss()
  src/tokens/tokens.test.ts
  src/renderer/index.html
  src/renderer/main.tsx                React entry: applies tokens, renders <App/>
  src/renderer/App.tsx                 boot screen: themed cost card via view-model
  src/renderer/globals.css             @import "tailwindcss" + :root token vars

vitest.config.ts                       MODIFY · add @coa/console-viewmodel alias (Task 3)
tsconfig.json (root)                   MODIFY · add references to the new package + app (Tasks 1,3)
.dependency-cruiser.cjs                MODIFY · viewmodel-no-electron rule (Task 6)
docs/REPO_LAYOUT.md                    MODIFY · logical→physical map + note (Task 6)
docs/UI.md                             MODIFY · replace placeholder with pointer to the design spec (Task 6)
```

---

### Task 1: Scaffold `apps/desktop` — Electron boots a blank secure window

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/electron-builder.yml`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/index.html`, `apps/desktop/src/renderer/main.tsx`, `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/globals.css`
- Modify: root `tsconfig.json` (add `{ "path": "apps/desktop" }` to `references`)

**Interfaces:**
- Produces: a runnable `dev` script (`corepack pnpm --filter @coa/desktop dev`) that opens a window. No unit test (Electron wiring — verified by boot).

- [ ] **Step 1: Create the package manifest**

`apps/desktop/package.json`:
```json
{
  "name": "@coa/desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc -b"
  },
  "dependencies": {
    "@coa/core": "workspace:*",
    "@coa/shared": "workspace:*",
    "@coa/console-viewmodel": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^26.0.1",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "electron": "^34.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^3.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0"
  }
}
```

- [ ] **Step 2: Install deps (allowlist scripts only for the daemon's native addons)**

Run: `corepack pnpm --filter @coa/desktop install`
If pnpm blocks a package on minimum-release-age, add that exact `name@version` to `pnpm-workspace.yaml` → `minimumReleaseAgeExclude` (mirror existing entries) and re-run.
Expected: installs with no `postinstall` scripts run for Electron/React/Tailwind.

- [ ] **Step 3: TypeScript project config**

`apps/desktop/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "composite": false
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```
Then add `{ "path": "apps/desktop" }` to the `references` array in the **root** `tsconfig.json` (mirror the existing package entries).

- [ ] **Step 4: electron-vite config**

`apps/desktop/electron.vite.config.ts`:
```ts
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  main: { build: { outDir: 'dist/main' } },
  preload: { build: { outDir: 'dist/preload' } },
  renderer: {
    root: 'src/renderer',
    build: { outDir: 'dist/renderer' },
    plugins: [react(), tailwind()],
  },
});
```

- [ ] **Step 5: Main process — secure blank window**

`apps/desktop/src/main/index.ts`:
```ts
import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.once('ready-to-show', () => win.show());

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'",
        ],
      },
    });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 6: Minimal preload (expanded in Task 5)**

`apps/desktop/src/preload/index.ts`:
```ts
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('coa', {});
```

- [ ] **Step 7: Renderer entry + boot screen + tokens css**

`apps/desktop/src/renderer/index.html`:
```html
<!doctype html>
<html lang="en" data-theme="dark" data-density="compact">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'" />
    <title>coa</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/renderer/globals.css`:
```css
@import 'tailwindcss';

:root {
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
}
body { margin: 0; }
```

`apps/desktop/src/renderer/App.tsx`:
```tsx
export function App(): React.JSX.Element {
  return <div style={{ padding: 16 }}>coa</div>;
}
```

`apps/desktop/src/renderer/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './globals.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
```

- [ ] **Step 8: Boot-verify + gates**

Run: `corepack pnpm --filter @coa/desktop dev`
Expected: an Electron window opens showing "coa" on a default background; no console errors about node integration or CSP script violations. Close it.
Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm exec prettier --write "apps/desktop/**/*.{ts,tsx,css,json,html}" && corepack pnpm format`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop tsconfig.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat: scaffold desktop console app shell"
```

---

### Task 2: Design token system (TDD)

**Files:**
- Create: `apps/desktop/src/tokens/palette.ts`, `apps/desktop/src/tokens/semantic.ts`, `apps/desktop/src/tokens/tokens.ts`, `apps/desktop/src/tokens/tokens.test.ts`
- Modify: `apps/desktop/src/renderer/main.tsx` (apply tokens on boot), `apps/desktop/src/renderer/globals.css`

**Interfaces:**
- Produces: `type Theme = 'dark' | 'light'`; `type Density = 'comfortable' | 'compact'`; `resolveTokens(theme: Theme, density: Density): Record<string, string>` (semantic-token → CSS value); `tokensToCss(theme: Theme, density: Density): string` (a `:root{…}` block); `SEMANTIC_TOKEN_NAMES: readonly string[]`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/tokens/tokens.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { resolveTokens, tokensToCss, SEMANTIC_TOKEN_NAMES } from './tokens.js';

describe('design tokens', () => {
  it('resolves every semantic token to a non-empty value in both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      const map = resolveTokens(theme, 'compact');
      for (const name of SEMANTIC_TOKEN_NAMES) {
        expect(map[name], `${theme}/${name}`).toBeTruthy();
      }
    }
  });

  it('pins the locked forge/brass dark values', () => {
    const dark = resolveTokens('dark', 'compact');
    expect(dark['--color-bg-base']).toBe('#14100d');
    expect(dark['--color-accent']).toBe('#c39a3e');
    expect(dark['--color-danger']).toBe('#c0432f');
  });

  it('emits a :root block containing the accent var', () => {
    expect(tokensToCss('dark', 'compact')).toContain('--color-accent: #c39a3e;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run apps/desktop/src/tokens/tokens.test.ts`
Expected: FAIL — cannot resolve `./tokens.js`.

- [ ] **Step 3: Write the primitives (Tier 1)**

`apps/desktop/src/tokens/palette.ts`:
```ts
/** Tier-1 primitives — raw values, never consumed by components directly. */
export const palette = {
  // warm-dark "forge" neutrals
  brown0: '#14100d', brown1: '#1b1511', brown2: '#221a15', brown3: '#2c211b',
  brownBorder: '#3a2c24', brownHair: '#2e231d',
  cream: '#ece0d0', cream2: '#a89180', cream3: '#6e5d50',
  brass: '#c39a3e',
  danger: '#c0432f', warning: '#cf9a4e', success: '#7c9a6b',
  // light theme (starter values; tuned later per spec §6.5)
  paper0: '#f6f1e9', paper1: '#efe8dd', paper2: '#e7ddce', paperBorder: '#d8cbb6',
  ink: '#241c14', ink2: '#5c5142', ink3: '#8a7d6b', brassInk: '#8a6a1f',
} as const;
```

- [ ] **Step 4: Write the semantic map (Tier 2) + resolver**

`apps/desktop/src/tokens/semantic.ts`:
```ts
import { palette } from './palette.js';

export type Theme = 'dark' | 'light';
export type Density = 'comfortable' | 'compact';

/** Tier-2 semantic tokens — the only tier components consume. */
const dark = {
  '--color-bg-base': palette.brown0, '--color-bg-subtle': palette.brown1,
  '--color-bg-surface': palette.brown2, '--color-bg-raised': palette.brown3,
  '--color-border': palette.brownBorder, '--color-hairline': palette.brownHair,
  '--color-fg-default': palette.cream, '--color-fg-muted': palette.cream2, '--color-fg-faint': palette.cream3,
  '--color-accent': palette.brass,
  '--color-danger': palette.danger, '--color-warning': palette.warning, '--color-success': palette.success,
} as const;

const light = {
  '--color-bg-base': palette.paper0, '--color-bg-subtle': palette.paper1,
  '--color-bg-surface': palette.paper2, '--color-bg-raised': palette.paper1,
  '--color-border': palette.paperBorder, '--color-hairline': palette.paperBorder,
  '--color-fg-default': palette.ink, '--color-fg-muted': palette.ink2, '--color-fg-faint': palette.ink3,
  '--color-accent': palette.brassInk,
  '--color-danger': palette.danger, '--color-warning': palette.warning, '--color-success': palette.success,
} as const;

/** Density remaps spacing/type steps (compact = dev-tool dense default). */
const density = {
  compact: { '--text-body': '13px', '--space-inset': '8px' },
  comfortable: { '--text-body': '14px', '--space-inset': '12px' },
} as const;

export const SEMANTIC_TOKEN_NAMES = [
  ...Object.keys(dark), ...Object.keys(density.compact),
] as const;

export const themes: Record<Theme, Record<string, string>> = { dark, light };
export const densities: Record<Density, Record<string, string>> = density;
```

`apps/desktop/src/tokens/tokens.ts`:
```ts
import { densities, themes, SEMANTIC_TOKEN_NAMES, type Density, type Theme } from './semantic.js';

export { SEMANTIC_TOKEN_NAMES };
export type { Theme, Density };

export function resolveTokens(theme: Theme, density: Density): Record<string, string> {
  return { ...themes[theme], ...densities[density] };
}

export function tokensToCss(theme: Theme, density: Density): string {
  const entries = Object.entries(resolveTokens(theme, density))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `:root {\n${entries}\n}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm exec vitest run apps/desktop/src/tokens/tokens.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Apply tokens on boot**

Edit `apps/desktop/src/renderer/main.tsx` — inject the resolved token block before render:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { tokensToCss } from '../tokens/tokens.js';
import './globals.css';

const style = document.createElement('style');
style.textContent = tokensToCss('dark', 'compact');
document.head.appendChild(style);

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
```
Edit `apps/desktop/src/renderer/globals.css` — use the tokens for the base surface:
```css
body { margin: 0; background: var(--color-bg-base); color: var(--color-fg-default); }
```

- [ ] **Step 7: Gates + commit**

Run: `corepack pnpm typecheck && corepack pnpm exec vitest run apps/desktop/src/tokens/tokens.test.ts && corepack pnpm lint && corepack pnpm exec prettier --write "apps/desktop/src/**/*.{ts,tsx,css}" && corepack pnpm format`
Expected: all pass.
```bash
git add apps/desktop/src/tokens apps/desktop/src/renderer/main.tsx apps/desktop/src/renderer/globals.css
git commit -m "feat: add design token system for the console"
```

---

### Task 3: `@coa/console-viewmodel` package + cost mapper (TDD)

**Files:**
- Create: `packages/console-viewmodel/package.json`, `packages/console-viewmodel/tsconfig.json`, `packages/console-viewmodel/tsdown.config.ts`, `packages/console-viewmodel/src/index.ts`, `packages/console-viewmodel/src/cap.ts`, `packages/console-viewmodel/src/cap.test.ts`
- Modify: `vitest.config.ts` (add alias), root `tsconfig.json` (add reference)

**Interfaces:**
- Produces: `CapStateSchema` (Zod); `interface CapViewModel { headline: string; sub: string; tone: 'neutral' | 'danger' }`; `toCapViewModel(raw: unknown): CapViewModel`.

- [ ] **Step 1: Scaffold the package (manifest, tsconfig, tsdown, barrel)**

`packages/console-viewmodel/package.json`:
```json
{
  "name": "@coa/console-viewmodel",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": { "build": "tsdown", "typecheck": "tsc -b" },
  "dependencies": { "zod": "^4.4.3" }
}
```
`packages/console-viewmodel/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "tsBuildInfoFile": "dist/.tsbuildinfo" },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```
`packages/console-viewmodel/tsdown.config.ts`:
```ts
import { defineConfig } from 'tsdown';
export default defineConfig({ entry: ['src/index.ts'], format: ['esm'], dts: true, clean: true, unbundle: true, fixedExtension: false });
```
`packages/console-viewmodel/src/index.ts`:
```ts
export * from './cap.js';
```
Add to `vitest.config.ts` `workspaceAlias`:
```ts
  '@coa/console-viewmodel': fileURLToPath(new URL('./packages/console-viewmodel/src/index.ts', import.meta.url)),
```
Add `{ "path": "packages/console-viewmodel" }` to the root `tsconfig.json` `references`. Run `corepack pnpm install` to link the workspace package.

- [ ] **Step 2: Write the failing test**

`packages/console-viewmodel/src/cap.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { toCapViewModel } from './cap.js';

describe('toCapViewModel', () => {
  it('renders the subscription model (unbounded) as neutral', () => {
    const vm = toCapViewModel({ remaining: null, capHit: false });
    expect(vm).toEqual({ headline: 'No ceiling', sub: 'subscription', tone: 'neutral' });
  });

  it('formats a remaining dollar amount', () => {
    const vm = toCapViewModel({ remaining: 2.5, capHit: false });
    expect(vm.headline).toBe('$2.50 left');
    expect(vm.tone).toBe('neutral');
  });

  it('marks a hit cap danger', () => {
    const vm = toCapViewModel({ remaining: 0, capHit: true });
    expect(vm.tone).toBe('danger');
    expect(vm.headline).toBe('Cap reached');
  });

  it('rejects a malformed payload', () => {
    expect(() => toCapViewModel({ remaining: 'lots' })).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/console-viewmodel/src/cap.test.ts`
Expected: FAIL — cannot resolve `./cap.js`.

- [ ] **Step 4: Implement the mapper**

`packages/console-viewmodel/src/cap.ts`:
```ts
import { z } from 'zod';

/** Edge schema for the daemon's `capState` result (parse untrusted JSON-RPC output). */
export const CapStateSchema = z.object({
  remaining: z.number().nullable(),
  capHit: z.boolean(),
});
export type CapState = z.infer<typeof CapStateSchema>;

export interface CapViewModel {
  headline: string;
  sub: string;
  tone: 'neutral' | 'danger';
}

export function toCapViewModel(raw: unknown): CapViewModel {
  const s = CapStateSchema.parse(raw);
  if (s.capHit) return { headline: 'Cap reached', sub: 'spending paused', tone: 'danger' };
  if (s.remaining === null) return { headline: 'No ceiling', sub: 'subscription', tone: 'neutral' };
  return { headline: `$${s.remaining.toFixed(2)} left`, sub: 'under cap', tone: 'neutral' };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm exec vitest run packages/console-viewmodel/src/cap.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Gates + commit**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm exec prettier --write "packages/console-viewmodel/**/*.{ts,json}" vitest.config.ts && corepack pnpm format && corepack pnpm depcruise`
Expected: all pass.
```bash
git add packages/console-viewmodel vitest.config.ts tsconfig.json pnpm-lock.yaml
git commit -m "feat: add pure console view-model package with cost mapper"
```

---

### Task 4: IPC contract + connect-or-spawn daemon resolver (TDD)

**Files:**
- Create: `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/ipc.test.ts`, `apps/desktop/src/main/daemon.ts`, `apps/desktop/src/main/daemon.test.ts`

**Interfaces:**
- Consumes: `connectClient`, `defaultDaemonPath` from `@coa/core` (main-side); `CapStateSchema` from `@coa/console-viewmodel`.
- Produces: `IPC_GET_CAP` (channel const); `type DaemonClient = { request(method: string, params?: unknown): Promise<{ result?: unknown; error?: { message: string } }>; close(): Promise<void> }`; `resolveDaemon(deps): Promise<DaemonClient>`.

- [ ] **Step 1: Write the failing IPC-schema test**

`apps/desktop/src/shared/ipc.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { IPC_GET_CAP, CapResultSchema } from './ipc.js';

describe('ipc contract', () => {
  it('names the cap channel', () => {
    expect(IPC_GET_CAP).toBe('coa:getCap');
  });
  it('validates a cap result payload', () => {
    expect(CapResultSchema.parse({ remaining: null, capHit: false })).toBeTruthy();
    expect(() => CapResultSchema.parse({})).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm exec vitest run apps/desktop/src/shared/ipc.test.ts`
Expected: FAIL — cannot resolve `./ipc.js`.

- [ ] **Step 3: Implement the IPC contract**

`apps/desktop/src/shared/ipc.ts`:
```ts
import { CapStateSchema } from '@coa/console-viewmodel';

/** One channel name per bridged method. */
export const IPC_GET_CAP = 'coa:getCap';

/** Payload validated at the IPC boundary (both sides). */
export const CapResultSchema = CapStateSchema;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm exec vitest run apps/desktop/src/shared/ipc.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing daemon-resolver test**

`apps/desktop/src/main/daemon.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { resolveDaemon } from './daemon.js';

const okClient = { request: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };

describe('resolveDaemon', () => {
  it('returns a client when the daemon is already up', async () => {
    const connect = vi.fn().mockResolvedValue(okClient);
    const spawn = vi.fn();
    const client = await resolveDaemon({ connect, spawn, path: '\\\\.\\pipe\\coa' });
    expect(client).toBe(okClient);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('spawns the daemon then connects when first connect fails', async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(okClient);
    const spawn = vi.fn();
    const client = await resolveDaemon({ connect, spawn, path: '\\\\.\\pipe\\coa' });
    expect(spawn).toHaveBeenCalledOnce();
    expect(client).toBe(okClient);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `corepack pnpm exec vitest run apps/desktop/src/main/daemon.test.ts`
Expected: FAIL — cannot resolve `./daemon.js`.

- [ ] **Step 7: Implement the resolver (dependency-injected connect/spawn)**

`apps/desktop/src/main/daemon.ts`:
```ts
export interface DaemonClient {
  request(method: string, params?: unknown): Promise<{ result?: unknown; error?: { message: string } }>;
  close(): Promise<void>;
}

export interface ResolveDaemonDeps {
  connect: (path: string) => Promise<DaemonClient>;
  spawn: () => void;
  path: string;
}

/** Connect to a running daemon; if none is up, spawn `coa serve` and retry once. */
export async function resolveDaemon(deps: ResolveDaemonDeps): Promise<DaemonClient> {
  try {
    return await deps.connect(deps.path);
  } catch {
    deps.spawn();
    return await deps.connect(deps.path);
  }
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `corepack pnpm exec vitest run apps/desktop/src/main/daemon.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Gates + commit**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm exec prettier --write "apps/desktop/src/**/*.ts" && corepack pnpm format`
Expected: all pass.
```bash
git add apps/desktop/src/shared apps/desktop/src/main/daemon.ts apps/desktop/src/main/daemon.test.ts
git commit -m "feat: add console ipc contract and daemon connect-or-spawn resolver"
```

---

### Task 5: Wire main → preload → renderer; render live cost (integration, boot-verified)

**Files:**
- Modify: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/App.tsx`
- Create: `apps/desktop/src/preload/api.d.ts` (renderer-visible `window.coa` type)

**Interfaces:**
- Consumes: `resolveDaemon`, `IPC_GET_CAP`, `CapResultSchema`, `toCapViewModel`, `connectClient`/`defaultDaemonPath` (`@coa/core`).

- [ ] **Step 1: Main — resolve the daemon and answer `getCap` over IPC**

Edit `apps/desktop/src/main/index.ts` — add, inside `app.whenReady().then(...)` after `createWindow()`:
```ts
import { spawn } from 'node:child_process';
import { ipcMain } from 'electron';
import { connectClient, defaultDaemonPath } from '@coa/core';
import { resolveDaemon, type DaemonClient } from './daemon.js';
import { IPC_GET_CAP, CapResultSchema } from '../shared/ipc.js';

let client: DaemonClient | undefined;

async function ensureClient(): Promise<DaemonClient> {
  if (!client) {
    client = await resolveDaemon({
      connect: (path) => connectClient(path),
      spawn: () => spawn(process.execPath, [process.env['COA_CLI'] ?? 'coa', 'serve'], { detached: true, stdio: 'ignore' }).unref(),
      path: defaultDaemonPath(),
    });
  }
  return client;
}

ipcMain.handle(IPC_GET_CAP, async () => {
  const res = await (await ensureClient()).request('capState');
  if ('error' in res && res.error) throw new Error(res.error.message);
  return CapResultSchema.parse(res.result);
});
```
(Confirm `connectClient` returns an object with `request`/`close` matching `DaemonClient`; if the shapes differ, adapt in a thin wrapper here — the renderer contract does not change.)

- [ ] **Step 2: Preload — expose exactly one method**

`apps/desktop/src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_GET_CAP } from '../shared/ipc.js';

contextBridge.exposeInMainWorld('coa', {
  getCap: (): Promise<unknown> => ipcRenderer.invoke(IPC_GET_CAP),
});
```
`apps/desktop/src/preload/api.d.ts`:
```ts
export {};
declare global {
  interface Window {
    coa: { getCap(): Promise<unknown> };
  }
}
```

- [ ] **Step 3: Renderer — map + render the themed cost card**

`apps/desktop/src/renderer/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { toCapViewModel, type CapViewModel } from '@coa/console-viewmodel';

export function App(): React.JSX.Element {
  const [vm, setVm] = useState<CapViewModel | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    window.coa.getCap()
      .then((raw) => setVm(toCapViewModel(raw)))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <div style={{
        background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
        borderRadius: 6, padding: 16, maxWidth: 260,
      }}>
        <div style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-fg-faint)' }}>Cost</div>
        {err && <div style={{ color: 'var(--color-danger)' }}>{err}</div>}
        {vm && (
          <div style={{ color: vm.tone === 'danger' ? 'var(--color-danger)' : 'var(--color-fg-default)', fontSize: 18, fontWeight: 600 }}>
            {vm.headline}
          </div>
        )}
        {vm && <div style={{ color: 'var(--color-fg-muted)', fontSize: 11 }}>{vm.sub}</div>}
      </div>
    </div>
  );
}
```
Add `/// <reference path="../preload/api.d.ts" />` at the top of `App.tsx` so `window.coa` typechecks.

- [ ] **Step 4: Boot-verify end-to-end**

In one terminal: `corepack pnpm --filter @coa/cli exec coa serve` (or start the daemon however the CLI runs it). In another: `corepack pnpm --filter @coa/desktop dev`.
Expected: the window shows a **Cost** card reading "No ceiling / subscription" (subscription model) in cream on the warm-dark surface. Kill the daemon and relaunch the app → it auto-spawns and still renders (connect-or-spawn path). No CSP/script errors in devtools.

- [ ] **Step 5: Gates + commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint && corepack pnpm exec prettier --write "apps/desktop/src/**/*.{ts,tsx}" && corepack pnpm format`
Expected: all pass.
```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/preload apps/desktop/src/renderer/App.tsx
git commit -m "feat: render live daemon cost in the console over the ipc bridge"
```

---

### Task 6: Docs + dependency rule (same-commit obligations)

**Files:**
- Modify: `docs/REPO_LAYOUT.md`, `docs/UI.md`, `.dependency-cruiser.cjs`

- [ ] **Step 1: Add the dependency-cruiser rule (view-model stays pure)**

In `.dependency-cruiser.cjs` `forbidden`, add:
```js
{
  name: 'viewmodel-no-electron-react',
  severity: 'error',
  comment: 'The pure console view-model maps daemon data to props; it never imports electron, react, or core.',
  from: { path: '^packages/console-viewmodel/src' },
  to: { path: 'node_modules/(electron|react|react-dom)/|^packages/core/' },
},
```
Run: `corepack pnpm depcruise`
Expected: PASS (no violation — the package imports only zod).

- [ ] **Step 2: Update REPO_LAYOUT.md**

In `docs/REPO_LAYOUT.md`, in the logical→physical map row for M10, note the concrete packages now exist, and under the top-level tree add:
```
    console-viewmodel/       M10 — @coa/console-viewmodel (pure daemon-result→render-props; no electron/react/core)
  apps/
    desktop/                 M10 — the Electron console (electron-vite; main pipe-client, isolated renderer, tokens)
```
Add one line under the dependency rules: "`console-viewmodel` imports only `zod`/`@coa/shared` — never electron/react/core (enforced: `viewmodel-no-electron-react`)." Update the `_Last reviewed_` footer date.

- [ ] **Step 3: Replace the UI.md placeholder**

Replace the body of `docs/UI.md` with a short pointer: the console design system is now specified in `docs/superpowers/specs/2026-06-30-console-frontend-foundation-design.md` (principles, tokens, families, layout architecture, visual direction); keep the standing invariants list (SC-1, coa-raw-sacred, catalogue-only, byte-faithful, accessibility floor) as a summary and link the spec as the authority. Update the `_Last reviewed_` footer date.

- [ ] **Step 4: Gates + commit**

Run: `corepack pnpm depcruise && corepack pnpm format`
Expected: pass.
```bash
git add .dependency-cruiser.cjs docs/REPO_LAYOUT.md docs/UI.md
git commit -m "docs: record the desktop console app and view-model in the repo layout"
```

---

## Self-Review

**Spec coverage:** §4 stack → Task 1 (electron-vite/React/Tailwind) + Task 3 (Zod pure package). §6 tokens (three-tier, locked values, theming/density) → Task 2. §10.1 secure baseline (contextIsolation/sandbox/CSP connect-src none) → Task 1. §10.2 three-layer seam (transport main / preload Zod bridge / pure view-model) → Tasks 3–5. §10.3 connect-or-spawn → Task 4/5. §13 locked palette → Task 2 (asserted in test). §17 testability (token map, view-model, IPC schema, resolver unit-tested; shell boot-verified) → Tasks 2–5. §19 same-commit docs → Task 6. **Deferred (not this plan, by design):** component families (Plan 2), layout abstraction/panels (Plan 3), the full shell + buildable-now surfaces (Plan 4), light-theme tuning, full Tailwind-token mapping, packaging/signing.

**Placeholder scan:** none — every step ships the file content or the exact command. The two "confirm the shape" notes (Task 5 Step 1 `connectClient` return shape; Task 1 min-release-age) are verification instructions against the real codebase, not deferred work.

**Type consistency:** `CapStateSchema` defined in Task 3 (`@coa/console-viewmodel`), reused in Task 4 (`CapResultSchema = CapStateSchema`) and Task 5 (`toCapViewModel`). `DaemonClient` defined in Task 4, consumed in Task 5. `resolveTokens`/`tokensToCss`/`SEMANTIC_TOKEN_NAMES` defined in Task 2, consumed in Task 2 Step 6. `IPC_GET_CAP` defined in Task 4, consumed in Tasks 5. Consistent.

---

_Last reviewed: 2026-06-30_
