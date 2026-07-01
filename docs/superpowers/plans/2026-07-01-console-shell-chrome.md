# Console Shell Chrome & Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the built console shell into compliance with the design principles (spec §22) — floating panes with gutters, a seamless title bar with no native menu, a fixed-width nav, honored resize minimums, and themed scrollbars.

**Architecture:** Three parts, three commits. (1) **Layout engine** (`console-layout`): the descriptor gains `fixedPx` + `minPx` on a leaf; the `StaticEngine` renders a `fixedPx` leaf as `flex: 0 0 Npx` (never proportional), applies `minPx` as a CSS min on the region's main axis, reads gutter/padding CSS variables (default 0 → no behavior change), tags the resize handle with a class, and floors the resizable split's minimum higher than the old flat 5%. (2) **Shell chrome** (`apps/desktop`): a pure `titleBarConfig(platform)` drives frameless windows with the OS controls overlaid (Windows) / traffic lights (macOS); `main` removes the native menu and sets a window minimum size; the default descriptor makes the nav a fixed 48px region and gives dock panes min heights. (3) **Visual cohesion** (`globals.css`): the recessed-canvas gutter variables, themed scrollbars, and the brass-on-hover resize grip.

**Tech Stack:** TypeScript (strict), React 19, `@coa/console-layout` (StaticEngine + descriptor + `react-resizable-panels` ^3), Electron (`electron-vite`, `BrowserWindow`, `Menu`, `titleBarOverlay`), Tailwind-from-tokens CSS custom properties, Vitest + jsdom.

## Global Constraints

- **TypeScript `strict`, no `any`.** `exactOptionalPropertyTypes` is ON — type omittable optionals `x?: T | undefined`.
- **`console-layout` stays a pure, Electron-free, jsdom-testable core** (enforced: `console-layout-no-electron-core`) — it imports only `react`/`react-resizable-panels`/`zod`. The new fields/vars must not couple it to `apps/desktop`; gutter sizing enters via CSS variables the shell sets, so the engine's defaults leave existing behavior unchanged.
- **Descriptor is console-local, validate-on-read, never-throw** (spec §11.2/§11.6): new fields are **optional and backward-compatible**; a descriptor without them parses exactly as before. `LAYOUT_VERSION` stays `1` (optional additions need no migration); the shell's `LAYOUT_EPOCH` bumps so a stale persisted arrangement is ignored.
- **Seamless title bar is the only chrome (spec §9/§22.2):** frameless + OS-control overlay (Windows) / hidden + traffic lights (macOS); **native application menu removed**; flat surface (no gradient, §14); `cursor: default` on chrome.
- **P6 never-weird responsive (spec §22.3):** the nav is a **fixed-px** region (not a flex ratio); the resizable boundary floors each pane well above the old 5%; the window has a `minWidth`/`minHeight`; static dock panes carry min heights. (True per-pixel minimums on the resizable boundary are a percentage floor here — the classic `react-resizable-panels` API sizes in percent — plus the window minimum; this honors "min sizes, not a flat 5%".)
- **Themed scrollbars from tokens (spec §22.4):** a global `::-webkit-scrollbar` rule using the real runtime token vars (`--color-border`, `--color-fg-faint`), not a per-component style. (Electron is Chromium; `-webkit-` is the effective rule.)
- **Runtime token vars** (injected by `tokensToCss`, confirmed in `tokens/semantic.ts`): `--color-bg-base`, `--color-bg-surface`, `--color-border`, `--color-hairline`, `--color-fg-default`, `--color-fg-muted`, `--color-fg-faint`, `--color-accent` (brass). Forge dark values used in `main` (which can't read CSS vars): subtle `#1b1511`, muted `#a89180`.
- **NO emoji** — Lucide only. **WAI-ARIA + visible focus.**
- **pnpm quirk:** PowerShell `$env:pnpm_config_verify_deps_before_run='false'` once, then `corepack pnpm <cmd>`. Run gates individually. Single test from repo root: `corepack pnpm exec vitest run <path>`.
- **DOM tests** start with `// @vitest-environment jsdom`.
- **Commits: subject-only Conventional Commits** — no body/trailers, no internal identifiers (module IDs / plan numbers / decision codes) in the subject. **Stage files by name.** One commit per Part (three total). **Same-commit doc rule:** the schema change updates the `console-layout` descriptor doc note where one exists; no new package is added.

---

## File structure

```
packages/console-layout/
  src/descriptor/schema.ts            modify (P1) — LeafRegion gains fixedPx + minPx; schema validates them
  src/descriptor/schema.test.ts       modify (P1) — parse/reject the new fields
  src/engine/static-engine.tsx        modify (P1) — honor fixedPx/minPx; gutter/pad CSS vars; handle class; resize min
  src/engine/static-engine.test.tsx   modify (P1) — fixedPx→flex, minPx→min-*, gap var present

apps/desktop/
  src/main/titlebar.ts                new (P2) — pure titleBarConfig(platform)
  src/main/titlebar.test.ts           new (P2) — per-platform config
  src/main/index.ts                   modify (P2) — spread titleBarConfig; Menu.setApplicationMenu(null); min window size
  src/renderer/panels/routing.ts      modify (P2) — nav fixedPx:48; dock minPx; LAYOUT_EPOCH → 4
  src/renderer/panels/routing.test.ts modify (P2) — epoch 4; nav is fixed-width
  src/renderer/globals.css            modify (P3) — canvas gutter vars; themed scrollbars; resize grip; cursor
```

No `console-ui` change (the `AppShell` title bar is already flat `bg-subtle`; `Pane` is already a surface card — the floating look comes from the engine gutters + canvas).

---

# Part 1 — Layout engine: fixed-size, min-size, gutters

Extend the descriptor + `StaticEngine` so a leaf can be a fixed-px region with a min size, and so the shell can opt into gutters via CSS variables. All changes are backward-compatible and jsdom-tested; the engine stays Electron-free.

### Task 1.1: Descriptor schema — `fixedPx` + `minPx`

**Files:**
- Modify: `packages/console-layout/src/descriptor/schema.ts`
- Modify: `packages/console-layout/src/descriptor/schema.test.ts`

**Interfaces:**
- Produces: `LeafRegion` gains `fixedPx?: number | undefined` and `minPx?: number | undefined`; `LeafRegionSchema` validates both as positive optionals.

- [ ] **Step 1: Write the failing test.** In `packages/console-layout/src/descriptor/schema.test.ts`, add:

```ts
import { LayoutDescriptorSchema, LAYOUT_VERSION } from './schema.js';

describe('fixed-size and min-size leaves', () => {
  it('accepts a leaf with fixedPx and minPx', () => {
    const d = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'static',
        children: [
          { type: 'leaf', panelId: 'nav', fixedPx: 48 },
          { type: 'leaf', panelId: 'main', minPx: 240 },
        ],
      },
    };
    expect(LayoutDescriptorSchema.parse(d)).toEqual(d);
  });

  it('rejects a non-positive fixedPx', () => {
    const d = {
      version: LAYOUT_VERSION,
      root: { type: 'leaf', panelId: 'nav', fixedPx: 0 },
    };
    expect(() => LayoutDescriptorSchema.parse(d)).toThrow();
  });
});
```

> If `schema.test.ts` does not already import `describe`, add it to the existing `vitest` import line.

- [ ] **Step 2: Run it and confirm it fails**

Run: `corepack pnpm exec vitest run packages/console-layout/src/descriptor/schema.test.ts`
Expected: FAIL (fixedPx is stripped, so the `toEqual` for the first test fails; the reject test may pass vacuously).

- [ ] **Step 3: Implement.** In `packages/console-layout/src/descriptor/schema.ts`, extend the `LeafRegion` interface and its schema:

```ts
/** A leaf hosts exactly one panel. `size` is its proportional size within its parent
 *  split (percent under a resizable split, flex weight under a static one). `fixedPx`
 *  makes it a fixed pixel region instead (nav rail); `minPx` is a min size along the
 *  parent's main axis so it stops before its content crushes. */
export interface LeafRegion {
  type: 'leaf';
  panelId: string;
  size?: number | undefined;
  fixedPx?: number | undefined;
  minPx?: number | undefined;
}
```

```ts
const LeafRegionSchema: z.ZodType<LeafRegion> = z.object({
  type: z.literal('leaf'),
  panelId: z.string().min(1),
  size: z.number().positive().optional(),
  fixedPx: z.number().positive().optional(),
  minPx: z.number().positive().optional(),
});
```

- [ ] **Step 4: Run and confirm pass**

Run: `corepack pnpm exec vitest run packages/console-layout/src/descriptor/schema.test.ts`
Expected: PASS.

### Task 1.2: StaticEngine — honor `fixedPx`/`minPx` + gutter/pad vars + handle class + resize floor

**Files:**
- Modify: `packages/console-layout/src/engine/static-engine.tsx`
- Modify: `packages/console-layout/src/engine/static-engine.test.tsx`

**Interfaces:**
- Consumes: `LeafRegion.fixedPx`, `LeafRegion.minPx`.
- Produces: a `MIN_RESIZE_PERCENT` constant used as each resizable `Panel`'s `minSize`; static-flex children sized by `fixedPx` (else `size` weight); `minPx` applied as `minWidth`/`minHeight` per parent direction; static flex containers get `gap: var(--layout-gap, 0)`; the root gets `padding: var(--layout-pad, 0)` with `box-sizing: border-box`; each `PanelResizeHandle` gets `className="resize-handle"`.

- [ ] **Step 1: Write the failing test.** In `packages/console-layout/src/engine/static-engine.test.tsx`, add a describe block (reuse the existing `mountInto` + `LAYOUT_VERSION`):

```ts
describe('StaticEngine fixed + min sizing', () => {
  it('renders a fixedPx leaf as a non-growing fixed-basis flex child', () => {
    const d: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'static',
        children: [
          { type: 'leaf', panelId: 'nav', fixedPx: 48 },
          { type: 'leaf', panelId: 'chat', minPx: 200 },
        ],
      },
    };
    const { container } = mountInto(d);
    const navWrap = container.querySelector('[data-panel-id="nav"]')?.parentElement as HTMLElement;
    expect(navWrap.style.flex).toContain('48px');
    expect(navWrap.style.flexGrow === '0' || navWrap.style.flex.startsWith('0 0')).toBe(true);
    const chatWrap = container.querySelector('[data-panel-id="chat"]')?.parentElement as HTMLElement;
    expect(chatWrap.style.minWidth).toBe('200px'); // row split → min on the width axis
  });

  it('applies the gutter variable to a static flex container', () => {
    const { container } = mountInto(staticSplit);
    const navWrap = container.querySelector('[data-panel-id="nav"]')?.parentElement as HTMLElement;
    const flexRow = navWrap.parentElement as HTMLElement;
    expect(flexRow.style.gap).toContain('--layout-gap');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `corepack pnpm exec vitest run packages/console-layout/src/engine/static-engine.test.tsx`
Expected: FAIL (no fixedPx handling; no gap var).

- [ ] **Step 3: Implement.** In `packages/console-layout/src/engine/static-engine.tsx`:

Add the constant near the top (after `SUPPORTED`):

```ts
/** Floor each resizable pane well above the old flat 5% so a pane can't collapse into
 *  nonsense; combined with the window min size and fixed static regions (spec §22.3). */
const MIN_RESIZE_PERCENT = 20;
```

Replace the **static (`!resizable`) branch** of `renderRegion` with:

```ts
  if (!resizable) {
    const isRow = region.direction === 'row';
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: isRow ? 'row' : 'column',
          minWidth: 0,
          minHeight: 0,
          height: '100%',
          width: '100%',
          gap: 'var(--layout-gap, 0)',
        }}
      >
        {region.children.map((child, i) => {
          const leaf = child.type === 'leaf' ? child : undefined;
          const style: React.CSSProperties = { minWidth: 0, minHeight: 0 };
          style.flex =
            leaf?.fixedPx !== undefined
              ? `0 0 ${leaf.fixedPx}px`
              : leaf?.size
                ? `${leaf.size} 1 0`
                : '1 1 0';
          if (leaf?.minPx !== undefined) {
            if (isRow) style.minWidth = leaf.minPx;
            else style.minHeight = leaf.minPx;
          }
          return (
            <div key={i} style={style}>
              {renderRegion(child, ctx, `${path}.${i}`)}
            </div>
          );
        })}
      </div>
    );
  }
```

In the **resizable branch**, give the handle a class and floor the panel min. Change the `PanelResizeHandle` and `Panel`:

```ts
          {i > 0 && (
            <PanelResizeHandle
              className="resize-handle"
              aria-label={separatorLabel(ctx, region.children[i - 1] as Region, child)}
            />
          )}
          <Panel
            defaultSize={child.type === 'leaf' ? child.size : undefined}
            minSize={MIN_RESIZE_PERCENT}
          >
```

In `StaticRoot`, add the canvas padding to the outer div:

```ts
  return (
    <div style={{ height: '100%', width: '100%', padding: 'var(--layout-pad, 0)', boxSizing: 'border-box' }}>
      {renderRegion(ctx.store.current.root, ctx, 'root')}
    </div>
  );
```

- [ ] **Step 4: Run the engine tests and confirm pass**

Run: `corepack pnpm exec vitest run packages/console-layout/src/engine/static-engine.test.tsx`
Expected: PASS (existing tests unchanged — default descriptors have no fixedPx/minPx, `var(--layout-gap, 0)`/`var(--layout-pad, 0)` resolve to 0 with no shell variables set; the old `minSize={5}` was not asserted anywhere).

> If jsdom does not round-trip `style.flex`, assert on `navWrap.style.cssText` containing `48px` instead — adjust the one assertion.

### Task 1.3: Part 1 gate sweep + commit

- [ ] **Step 1: Run the gates**

```
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:write
corepack pnpm format
corepack pnpm exec vitest run packages/console-layout
corepack pnpm depcruise
```
Expected: all PASS; depcruise 0 violations.

- [ ] **Step 2: Commit Part 1** (stage by name; subject-only)

```bash
git add packages/console-layout/src/descriptor/schema.ts packages/console-layout/src/descriptor/schema.test.ts \
  packages/console-layout/src/engine/static-engine.tsx packages/console-layout/src/engine/static-engine.test.tsx
git commit -m "feat: support fixed-width and minimum-size regions in the layout engine"
```

---

# Part 2 — Shell chrome: seamless title bar, no menu, fixed nav, window minimum

Make the custom title bar the only chrome, remove the native menu, floor the window size, and rewire the default descriptor so the nav is a fixed 48px region and the dock panes carry min heights.

### Task 2.1: Pure `titleBarConfig(platform)`

**Files:**
- Create: `apps/desktop/src/main/titlebar.ts`
- Test: `apps/desktop/src/main/titlebar.test.ts`

**Interfaces:**
- Produces: `function titleBarConfig(platform: NodeJS.Platform): BrowserWindowConstructorOptions` — frameless + overlay per platform.

- [ ] **Step 1: Write the failing test** `apps/desktop/src/main/titlebar.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { titleBarConfig } from './titlebar.js';

describe('titleBarConfig', () => {
  it('hides the frame and overlays the window controls on Windows', () => {
    const c = titleBarConfig('win32');
    expect(c.titleBarStyle).toBe('hidden');
    expect(c.titleBarOverlay).toMatchObject({ color: '#1b1511', symbolColor: '#a89180', height: 36 });
  });

  it('hides the frame and keeps traffic lights on macOS', () => {
    const c = titleBarConfig('darwin');
    expect(c.titleBarStyle).toBe('hidden');
    expect(c.trafficLightPosition).toBeDefined();
    expect(c.titleBarOverlay).toBeUndefined();
  });

  it('is a plain window elsewhere', () => {
    expect(titleBarConfig('linux')).toEqual({});
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `corepack pnpm exec vitest run apps/desktop/src/main/titlebar.test.ts`
Expected: FAIL (cannot resolve `./titlebar.js`).

- [ ] **Step 3: Implement** `apps/desktop/src/main/titlebar.ts`

```ts
import type { BrowserWindowConstructorOptions } from 'electron';

/** Window chrome per platform (spec §9/§22.2). The custom AppShell title bar is the
 *  only chrome: macOS hides the frame and keeps traffic lights (inset to clear our
 *  wordmark); Windows hides the frame and overlays the native controls into our bar,
 *  matching AppShell's `env(titlebar-area-*)` right inset and 36px (h-9) height.
 *  Colors are the forge dark tokens (main cannot read CSS vars). */
export function titleBarConfig(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 11 } };
  }
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#1b1511', symbolColor: '#a89180', height: 36 },
    };
  }
  return {};
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `corepack pnpm exec vitest run apps/desktop/src/main/titlebar.test.ts`
Expected: PASS (3 tests).

### Task 2.2: Wire the chrome in `main`

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- Consumes: `titleBarConfig`; Electron `Menu`.

- [ ] **Step 1: Import `Menu` and `titleBarConfig`.** In `apps/desktop/src/main/index.ts`, extend the electron import and add the titlebar import:

```ts
import { app, BrowserWindow, ipcMain, Menu, session } from 'electron';
```
```ts
import { contentSecurityPolicy } from './csp.js';
import { titleBarConfig } from './titlebar.js';
```

- [ ] **Step 2: Apply the config + window minimum.** In `createWindow`, replace the `BrowserWindow` construction so it spreads the platform config, floors the size, and drops the ad-hoc `titleBarStyle`:

```ts
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 860,
    minHeight: 540,
    show: false,
    ...titleBarConfig(process.platform),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
```

- [ ] **Step 3: Remove the native application menu.** Immediately inside `app.whenReady().then(() => {` (before the `onHeadersReceived` block), add:

```ts
    // The custom AppShell title bar is the only chrome — no File/Edit/View menu (§22.2).
    Menu.setApplicationMenu(null);
```

- [ ] **Step 4: Confirm main still builds + typechecks**

Run: `corepack pnpm typecheck`
Expected: PASS. (There is no unit test for `createWindow` — it constructs a real `BrowserWindow`; the pure config is covered by `titlebar.test.ts`, and the wiring is verified by the build in Task 2.4.)

### Task 2.3: Default descriptor — fixed nav + dock minimums + epoch

**Files:**
- Modify: `apps/desktop/src/renderer/panels/routing.ts`
- Modify: `apps/desktop/src/renderer/panels/routing.test.ts`

**Interfaces:**
- Produces: the `nav` leaf is `{ panelId: 'nav', fixedPx: 48 }`; dock leaves carry `minPx`; `LAYOUT_EPOCH = 4`.

- [ ] **Step 1: Update the descriptor + epoch.** In `apps/desktop/src/renderer/panels/routing.ts`, bump the epoch and rewrite the nav + dock leaves:

```ts
export const LAYOUT_EPOCH = 4;
```
Change the nav leaf (remove the `size: 0.06`, make it fixed):
```ts
        { type: 'leaf', panelId: 'nav', fixedPx: 48 },
```
Change the dock column children to carry min heights (keep the chat-weighted sizes):
```ts
              children: [
                { type: 'leaf', panelId: 'conversation', size: 3, minPx: 160 },
                { type: 'leaf', panelId: 'agent', size: 1, minPx: 88 },
                { type: 'leaf', panelId: 'account', size: 1, minPx: 64 },
              ],
```

- [ ] **Step 2: Update the routing test.** In `apps/desktop/src/renderer/panels/routing.test.ts`, change the epoch assertion and assert the nav is fixed-width:

```ts
    expect(LAYOUT_EPOCH).toBe(4);
```
Add, inside the first `it('builds the inspector tree …')`:
```ts
    expect(leaves).toContain('"fixedPx":48');
    expect(leaves).not.toContain('"panelId":"nav","size"');
```

- [ ] **Step 3: Run the routing test**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/panels/routing.test.ts`
Expected: PASS (4 tests).

### Task 2.4: Part 2 gate sweep + commit

- [ ] **Step 1: Run the gates**

```
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:write
corepack pnpm format
corepack pnpm test
corepack pnpm depcruise
corepack pnpm --filter @coa/desktop build
```
Expected: all PASS; depcruise 0 violations; build green.

- [ ] **Step 2: Commit Part 2** (stage by name; subject-only)

```bash
git add apps/desktop/src/main/titlebar.ts apps/desktop/src/main/titlebar.test.ts \
  apps/desktop/src/main/index.ts apps/desktop/src/renderer/panels/routing.ts \
  apps/desktop/src/renderer/panels/routing.test.ts
git commit -m "feat: make the console title bar seamless and the nav a fixed width"
```

---

# Part 3 — Visual cohesion: recessed canvas, themed scrollbars, resize grip

Turn on the gutters the engine now reads, theme the scrollbars from tokens, and give the resize handle a visible brass-on-hover grip. This part is CSS-only, verified by the desktop build and a manual reload.

### Task 3.1: globals.css — gutters, scrollbars, grip, cursor

**Files:**
- Modify: `apps/desktop/src/renderer/globals.css`

- [ ] **Step 1: Add the canvas gutter variables + native-feel cursor.** In `apps/desktop/src/renderer/globals.css`, extend the `:root` block (after `font-size: 13px;`):

```css
  /* floating-panes canvas: 8px gutters/padding the layout engine reads (§22.1) */
  --layout-gap: 8px;
  --layout-pad: 8px;
  cursor: default; /* native desktop feel (§9); text/inputs re-enable their own */
```

- [ ] **Step 2: Add themed scrollbars + the resize grip.** Append to `apps/desktop/src/renderer/globals.css`:

```css
/* Themed scrollbars (spec §22.4) — cohesive with the forge tokens, not the OS default. */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}
*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 6px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
*::-webkit-scrollbar-thumb:hover {
  background: var(--color-fg-faint);
  background-clip: padding-box;
}

/* The main<->dock resize handle: an 8px gutter with a brass-on-hover grip (§22.3, P5). */
.resize-handle {
  position: relative;
  width: var(--layout-gap);
  align-self: stretch;
}
.resize-handle::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 3px;
  height: 34px;
  border-radius: 3px;
  background: var(--color-border);
}
.resize-handle:hover::after {
  background: var(--color-accent);
}
```

- [ ] **Step 2b: Re-enable a text cursor where content is selectable.** Append:

```css
input,
textarea,
[contenteditable],
pre,
code,
[role='log'] {
  cursor: auto;
}
```

- [ ] **Step 3: Build the desktop app**

Run: `corepack pnpm --filter @coa/desktop build`
Expected: build green (CSS compiles; Tailwind picks up the file).

### Task 3.2: Part 3 gate sweep + commit

- [ ] **Step 1: Run the gates**

```
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:write
corepack pnpm format
corepack pnpm test
corepack pnpm depcruise
corepack pnpm --filter @coa/desktop build
```
Expected: all PASS; depcruise 0 violations; build green.

- [ ] **Step 2: Commit Part 3** (stage by name; subject-only)

```bash
git add apps/desktop/src/renderer/globals.css
git commit -m "feat: give the console floating panes, themed scrollbars, and a visible resize grip"
```

- [ ] **Step 3: Manual verification (human step).** Reload the dev window (Ctrl+R). Confirm: no native title bar or File/Edit menu (window controls sit in our bar on Windows); panes float with gutters on a darker canvas; the main↔dock divider shows a grip that turns brass on hover; scrollbars are thin and tinted; widening the window does **not** widen the nav rail; shrinking stops at a sane minimum without crushing.

---

## Self-review checklist

- **Spec coverage (§22):** §22.1 floating panes → Part 1 gutters + Part 3 canvas/scrollbars; §22.2 seamless title bar + no menu → Part 2 (`titleBarConfig` + `Menu.setApplicationMenu(null)`); §22.3 fixed nav + resize limits → Part 1 (`fixedPx`/`minPx`/`MIN_RESIZE_PERCENT`) + Part 2 (descriptor + window min); §22.4 scrollbars → Part 3. ✔
- **Placeholder scan:** none. ✔
- **Type consistency:** `fixedPx`/`minPx` optional-positive in both the interface and the Zod schema; the engine reads the same names; `MIN_RESIZE_PERCENT` defined once; `LAYOUT_EPOCH` bumped to 4 in both `routing.ts` and its test; token var names match `tokens/semantic.ts`. ✔
- **Backward-compat:** new descriptor fields optional (old layouts parse); engine defaults (`var(--layout-gap, 0)`, no fixedPx/minPx) leave existing `console-layout` tests unchanged; `LAYOUT_VERSION` stays 1. ✔

_Last reviewed: 2026-07-01_
