# Console App Shell — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a navigable direction-B desktop console shell over the real daemon, with the cost/cap surface live end-to-end, proving every seam of the composition (AppShell chrome → StaticEngine mount → PanelRegistry → panel → shared-registry IPC bridge → pure view-model → main-process layout persistence).

**Architecture:** Three parts, three commits. (A) A small live-data extension to `@coa/console-layout` — `LayoutHandle.setDaemonState` — so a mounted engine can receive fresh daemon data without remounting (React context cannot cross the engine's own root). (B) The `AppShell` chrome in `@coa/console-ui` (the deferred Layout member): a custom title bar + a content slot; the nav rail is a descriptor region, not chrome. (C) The desktop shell in `apps/desktop`: a shared Zod method registry driving the preload/main IPC bridge, main-process `layout.json` persistence, three concrete panels (nav, conversation placeholder, cost live), the default descriptor, and the `App` composition that mounts the engine into `AppShell` and polls the daemon.

**Tech Stack:** TypeScript (strict), React 19, `@coa/console-layout` (StaticEngine + registry + descriptor), `@coa/console-ui` (kit), `@coa/console-viewmodel` (pure selectors + edge schemas), Electron (electron-vite), Zod 4, Vitest + jsdom + @testing-library/react, Lucide icons.

## Global Constraints

- **TypeScript `strict`, no `any`.** Use `unknown` + internal casts where a heterogeneous value is unavoidable. (AGENTS.md Constitution.)
- **`exactOptionalPropertyTypes` is ON.** For an optional interface field that may be omitted, type it `x?: T | undefined`.
- **SC-1 — help, never cage.** The console adds NO block. Nothing in this plan denies or gates anything. (spec §3)
- **`coa raw` is sacred (D85).** The `AppShell` title bar carries a persistent, always-focusable `raw` affordance. (spec §3, §13)
- **M10 is a leaf; talks only to M8.** The renderer computes nothing authoritative; every daemon read is an existing M8 verb reached through the main-process pipe client. Layout persistence is console-local, non-authoritative, and lives on the Electron **main** side (no new daemon verb). (spec §21)
- **Renderer isolation (D128).** The sandboxed renderer imports no `electron` and no `packages/core` (enforced: `renderer-isolation`). Privileged work (pipe client, filesystem) is main-only.
- **Zod at the edges (§10.2).** Every IPC payload is Zod-validated; the shared method registry is the single source of the params/result schemas. The persisted descriptor is validated at the renderer edge via `parseDescriptor` (main persists it opaquely).
- **WAI-ARIA + visible focus surviving Windows High-Contrast.** Real `outline` focus (the kit's `focusRing`), keyboard-reachable controls, labelled regions. (spec §15)
- **NO emoji anywhere** — Lucide icons only, in labels/statuses/empty states too. (spec §14)
- **States-first (§5.1 #12).** Design empty/loading/error with real content BEFORE the happy path. The cost panel ships loading + error + value states.
- **pnpm PATH quirk:** prefix every pnpm command with `pnpm_config_verify_deps_before_run=false corepack pnpm …`. The composite `pnpm check` fails (it calls bare `pnpm`) — run each gate individually via `corepack pnpm <gate>` (typecheck · lint · format:write / format · test · depcruise).
- **Single test from the repo ROOT:** `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run <path>`.
- **DOM tests opt into jsdom** with a `// @vitest-environment jsdom` docblock as the FIRST line (node is the default env). `vitest.setup.ts` already polyfills pointer-capture/scrollIntoView/ResizeObserver.
- **Commits: subject-only Conventional Commits** — no body, no trailers/`Co-Authored-By`/"Generated with", **no internal identifiers** (no module IDs / plan numbers / decision codes) in the subject. **Stage files by name** (never `git add -A`). **Developer-sized commits** — this plan commits at the three Part boundaries, NOT per task.
- **Same-commit doc rule:** Part C updates `docs/REPO_LAYOUT.md`, `apps/desktop/tsconfig.json`, and `apps/desktop/electron.vite.config.ts` in the Part C commit.

---

## File structure

```
packages/console-layout/
  src/engine/port.ts                 modify — add setDaemonState to LayoutHandle
  src/engine/static-engine.tsx       modify — daemonState store slot + version trigger + setDaemonState; PanelBody reads live
  src/engine/static-engine.test.tsx  modify — live-data tests (re-render, no-remount)

packages/console-ui/
  src/layout/AppShell.tsx            new — the title-bar + content-slot chrome
  src/layout/AppShell.intent.ts      new — the intent declaration
  src/layout/AppShell.test.tsx       new — jsdom render/focus/inset/raw tests
  src/registry.ts                    modify — register appShellIntent
  src/index.ts                       modify — export AppShell
  COMPONENTS.md                      regenerated (catalogue is diff-checked)

apps/desktop/
  src/shared/methods.ts              new — shared Zod method registry (replaces ipc.ts)
  src/shared/methods.test.ts         new — registry schemas both directions
  src/shared/ipc.ts                  delete — superseded by methods.ts
  src/shared/ipc.test.ts             delete — superseded by methods.test.ts
  src/main/persistence.ts            new — layout.json read/write (pure, injectable path)
  src/main/persistence.test.ts       new — roundtrip + missing/corrupt -> undefined
  src/main/index.ts                  modify — registry-driven ipcMain handlers + persistence + platform
  src/preload/index.ts               modify — generate named bridge methods from the registry + platform
  src/preload/api.d.ts               modify — the new window.coa typing
  src/renderer/panels/state.ts       new — DaemonState aggregate + Remote<T>
  src/renderer/panels/CostPanel.tsx  new — cost panel (selectVm + states-first render)
  src/renderer/panels/CostPanel.test.tsx new — selector + three-state render
  src/renderer/panels/NavPanel.tsx   new — the activity-bar rail panel
  src/renderer/panels/PlaceholderPanel.tsx new — reusable honest-mock panel
  src/renderer/panels/registry.ts    new — buildPanelRegistry + DEFAULT_DESCRIPTOR
  src/renderer/panels/registry.test.ts new — registry resolves + default descriptor parses
  src/renderer/console.ts            new — startConsole controller (mount + poll + persist)
  src/renderer/console.test.tsx      new — controller: loading -> data; corrupt layout -> default
  src/renderer/App.tsx               replace — compose AppShell + mount engine + poll
  package.json                       modify — add @coa/console-layout + lucide-react deps
  tsconfig.json                      modify — add console-layout reference
  electron.vite.config.ts            modify — renderer aliases for console-layout + console-viewmodel
docs/REPO_LAYOUT.md                  modify — note the desktop shell composition
```

No new package → no new `.dependency-cruiser.cjs` rule and no root `tsconfig.json`/`vitest.config.ts` change (`@coa/console-layout` is already in both from Plan 3). `console-layout` uses inline styles (no Tailwind), so `globals.css` needs no new `@source`; `AppShell` lives under `console-ui/src`, already `@source`d.

---

# Part A — the live-data seam (`@coa/console-layout`)

The imperative engine owns its own React root, so React context can't reach panels; live daemon data must flow through the handle. Add a `daemonState` store slot and a `setDaemonState` handle method. Critically, use a **separate render-trigger counter** (`version`) so a data tick re-renders panels **without** bumping `layoutRevision` (the `PanelGroup` key) — otherwise every data update would remount the resize group and reset drag positions.

### Task A1: Extend the engine port

**Files:**
- Modify: `packages/console-layout/src/engine/port.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `LayoutHandle.setDaemonState(state: unknown): void`.

- [ ] **Step 1: Add the method to the `LayoutHandle` interface.** In `packages/console-layout/src/engine/port.ts`, replace the `LayoutHandle` interface with:

```ts
export interface LayoutHandle {
  serialize(): LayoutDescriptor;
  applyDescriptor(descriptor: LayoutDescriptor): void;
  /** Push fresh daemon state into the mounted panels. Re-runs each panel's
   *  pure selectVm and re-renders WITHOUT remounting the resize groups (drag
   *  state is preserved). */
  setDaemonState(state: unknown): void;
  focusPanel(id: string): void;
  dispose(): void;
}
```

(No commit yet — Part A commits after Task A3.)

### Task A2: Implement the store slot + trigger split

**Files:**
- Modify: `packages/console-layout/src/engine/static-engine.tsx`

**Interfaces:**
- Consumes: `LayoutHandle` (with `setDaemonState`) from `./port.js`.
- Produces: `createStaticEngine()` whose handle implements `setDaemonState`; `daemonState` read live by panels.

- [ ] **Step 1: Rework the store, render context, and render path.** In `packages/console-layout/src/engine/static-engine.tsx`, make these edits:

Replace the `LayoutStore` interface and `RenderCtx` interface:

```ts
/** Mutable, React-external state so the imperative handle can drive/read the tree
 *  without React re-rendering on every drag (which would fight the resize lib).
 *  `layoutRevision` keys the resize groups (bumped only on a descriptor swap);
 *  `version` is the render trigger (bumped on ANY change, incl. a data tick), so
 *  fresh data re-renders panels without remounting — and resetting — the groups. */
interface LayoutStore {
  current: LayoutDescriptor;
  daemonState: unknown;
  layoutRevision: number;
  version: number;
  focusTargets: Map<string, HTMLElement>;
  listeners: Set<() => void>;
}

function notify(store: LayoutStore): void {
  for (const l of store.listeners) l();
}

interface RenderCtx {
  store: LayoutStore;
  registry: PanelRegistry;
  onChange: (d: LayoutDescriptor) => void;
}
```

In `PanelBody`, read daemon state live from the store:

```ts
  const vm = def.selectVm(ctx.store.daemonState);
```

In `renderRegion`, change the resizable `PanelGroup` key to use `layoutRevision`:

```ts
      key={`${path}:${ctx.store.layoutRevision}`}
```

In `StaticRoot`, subscribe to `version` (a number changes on every notify) and read the descriptor from the store:

```ts
function StaticRoot({ ctx }: { ctx: RenderCtx }): React.JSX.Element {
  useSyncExternalStore(
    (cb) => {
      ctx.store.listeners.add(cb);
      return () => ctx.store.listeners.delete(cb);
    },
    () => ctx.store.version,
  );
  return (
    <div style={{ height: '100%', width: '100%' }}>
      {renderRegion(ctx.store.current.root, ctx, 'root')}
    </div>
  );
}
```

In `createStaticEngine().mount`, initialize the new slots, drop `daemonState` from `RenderCtx`, and add `setDaemonState`:

```ts
    mount({
      container,
      descriptor,
      registry,
      daemonState,
      onChange,
    }: LayoutMountArgs): LayoutHandle {
      const store: LayoutStore = {
        current: descriptor,
        daemonState,
        layoutRevision: 0,
        version: 0,
        focusTargets: new Map(),
        listeners: new Set(),
      };
      const ctx: RenderCtx = { store, registry, onChange };
      const root = createRoot(container);
      root.render(<StaticRoot ctx={ctx} />);
      return {
        serialize: () => store.current,
        applyDescriptor: (d) => {
          store.current = d;
          store.layoutRevision += 1;
          store.version += 1;
          notify(store);
        },
        setDaemonState: (state) => {
          store.daemonState = state;
          store.version += 1;
          notify(store);
        },
        focusPanel: (id) => store.focusTargets.get(id)?.focus(),
        dispose: () => root.unmount(),
      };
    },
```

Also update the `onLayout` handler inside `renderRegion` — it currently reads `ctx.store.current`; that is unchanged and still correct. No edit needed there.

- [ ] **Step 2: Typecheck the package quickly**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck`
Expected: PASS (the `RenderCtx.daemonState` removal is consistent — `PanelBody` now reads `ctx.store.daemonState`).

### Task A3: Test the live-data seam

**Files:**
- Modify: `packages/console-layout/src/engine/static-engine.test.tsx`

**Interfaces:**
- Consumes: `createStaticEngine`, `createPanelRegistry`, `LAYOUT_VERSION`, the existing `staticSplit` / `resizableSplit` fixtures already defined in this test file.
- Produces: coverage of `setDaemonState` (data re-render + no-remount).

- [ ] **Step 1: Append the failing tests** to `packages/console-layout/src/engine/static-engine.test.tsx` (the imports `act`, `vi`, `createPanelRegistry`, `type PanelDefinition`, `type LayoutDescriptor`, and the `staticSplit`/`resizableSplit` fixtures already exist at the top of the file):

```tsx
describe('StaticEngine live data (setDaemonState)', () => {
  function dataPanel(id: string): PanelDefinition<number, { n: number }> {
    return {
      id,
      displayName: id.toUpperCase(),
      selectVm: (s) => s.n,
      render: ({ vm }: { vm: number; host: PanelHostApi }) => <div>value:{vm}</div>,
    };
  }

  function mountData(descriptor: LayoutDescriptor, initial: { n: number }) {
    const registry = createPanelRegistry();
    registry.register(dataPanel('nav'));
    registry.register(dataPanel('chat'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const engine = createStaticEngine();
    let handle!: ReturnType<typeof engine.mount>;
    act(() => {
      handle = engine.mount({
        container,
        descriptor,
        registry,
        daemonState: initial,
        onChange: vi.fn(),
      });
    });
    return { container, handle };
  }

  it('re-renders panels when daemon state changes', () => {
    const { container, handle } = mountData(staticSplit, { n: 1 });
    expect(container.textContent).toContain('value:1');
    act(() => handle.setDaemonState({ n: 2 }));
    expect(container.textContent).toContain('value:2');
    expect(container.textContent).not.toContain('value:1');
  });

  it('does not remount the resizable group on a data tick (drag state preserved)', () => {
    const { container, handle } = mountData(resizableSplit, { n: 1 });
    const before = container.querySelector('[role="separator"]');
    expect(before).not.toBeNull();
    act(() => handle.setDaemonState({ n: 2 }));
    const after = container.querySelector('[role="separator"]');
    // Same DOM node identity => React reconciled in place => group not remounted.
    expect(after).toBe(before);
  });
});
```

`PanelHostApi` is already imported at the top of the file (used by `textPanel`); if it is not, add it to the existing `../panel/registry.js` import.

- [ ] **Step 2: Run the engine test file and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-layout/src/engine/static-engine.test.tsx`
Expected: PASS (existing 10 + 2 new = 12 tests).

- [ ] **Step 3: Run the full Part A gate sweep**

```
pnpm_config_verify_deps_before_run=false corepack pnpm typecheck
pnpm_config_verify_deps_before_run=false corepack pnpm lint
pnpm_config_verify_deps_before_run=false corepack pnpm format:write
pnpm_config_verify_deps_before_run=false corepack pnpm format
pnpm_config_verify_deps_before_run=false corepack pnpm test
pnpm_config_verify_deps_before_run=false corepack pnpm depcruise
```
Expected: all PASS; test total = previous + 2; depcruise 0 violations.

- [ ] **Step 4: Commit Part A** (stage by name; subject-only)

```bash
git add packages/console-layout/src/engine/port.ts \
  packages/console-layout/src/engine/static-engine.tsx \
  packages/console-layout/src/engine/static-engine.test.tsx
git commit -m "feat: let a mounted layout engine receive live data"
```

---

# Part B — the `AppShell` chrome (`@coa/console-ui`)

The deferred Layout member: a custom title bar (platform-inset wordmark, account context, persistent `raw` affordance) above a single content slot. The nav rail is NOT here — it is a descriptor region built in Part C.

### Task B1: AppShell component

**Files:**
- Create: `packages/console-ui/src/layout/AppShell.tsx`
- Modify: `packages/console-ui/src/index.ts`

**Interfaces:**
- Consumes: `../lib/cx.js` (`cx`), `../actions/Button.js` (`Button`).
- Produces:
  - `interface AppShellProps { platform: string; workspaceName: string; account?: string | undefined; onRaw: () => void; children: ReactNode; className?: string | undefined }`
  - `function AppShell(props: AppShellProps): React.JSX.Element`

- [ ] **Step 1: Implement** `packages/console-ui/src/layout/AppShell.tsx`

```tsx
import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';
import { Button } from '../actions/Button.js';

export interface AppShellProps {
  /** 'darwin' | 'win32' | other; injected main->renderer so insets apply without `process`. */
  platform: string;
  /** The active workspace label shown next to the wordmark. */
  workspaceName: string;
  /** The active account/session context, when known. */
  account?: string | undefined;
  /** The persistent D85 `raw` escape — always present and focusable. */
  onRaw: () => void;
  /** The content slot; the layout engine mounts here. */
  children: ReactNode;
  className?: string | undefined;
}

/** Traffic-light safe area (macOS) / window-controls inset (Windows). `-webkit-app-region`
 *  is not part of the CSSProperties type, so it is wrapped once here. */
function titleBarStyle(platform: string): React.CSSProperties {
  const inset =
    platform === 'darwin'
      ? { paddingLeft: 78, paddingRight: 8 }
      : { paddingLeft: 8, paddingRight: 140 };
  return { WebkitAppRegion: 'drag', ...inset } as React.CSSProperties;
}

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export function AppShell({
  platform,
  workspaceName,
  account,
  onRaw,
  children,
  className,
}: AppShellProps): React.JSX.Element {
  return (
    <div className={cx('flex h-full min-h-0 flex-col bg-base text-fg', className)}>
      <header
        aria-label="Application title bar"
        style={titleBarStyle(platform)}
        className="flex h-9 shrink-0 select-none items-center gap-3 border-b border-hairline bg-subtle text-[12px]"
      >
        <span className="font-semibold tracking-[-0.01em] text-fg">co&middot;a</span>
        <span className="text-muted">{workspaceName}</span>
        <div className="ml-auto flex items-center gap-2" style={noDrag}>
          {account !== undefined && (
            <span data-testid="account-context" className="text-muted">
              {account}
            </span>
          )}
          <Button variant="tertiary" size="sm" onClick={onRaw}>
            raw
          </Button>
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
```

Note: `co&middot;a` renders `co·a`; no emoji anywhere.

- [ ] **Step 2: Export it.** In `packages/console-ui/src/index.ts`, add after the `NavList` export line:

```ts
export { AppShell, type AppShellProps } from './layout/AppShell.js';
```

- [ ] **Step 3: Write the failing test** `packages/console-ui/src/layout/AppShell.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell.js';

describe('AppShell', () => {
  it('renders the wordmark, workspace name, and the content slot', () => {
    render(
      <AppShell platform="win32" workspaceName="myproject" onRaw={() => {}}>
        <div data-testid="slot">content</div>
      </AppShell>,
    );
    expect(screen.getByText('co·a')).toBeTruthy();
    expect(screen.getByText('myproject')).toBeTruthy();
    expect(screen.getByTestId('slot')).toBeTruthy();
  });

  it('always exposes a focusable raw affordance that fires onRaw', async () => {
    const onRaw = vi.fn();
    render(
      <AppShell platform="win32" workspaceName="p" onRaw={onRaw}>
        <div />
      </AppShell>,
    );
    const raw = screen.getByRole('button', { name: 'raw' });
    raw.focus();
    expect(document.activeElement).toBe(raw);
    await userEvent.click(raw);
    expect(onRaw).toHaveBeenCalledTimes(1);
  });

  it('applies the macOS traffic-light inset', () => {
    const { container } = render(
      <AppShell platform="darwin" workspaceName="p" onRaw={() => {}}>
        <div />
      </AppShell>,
    );
    const header = container.querySelector('header');
    expect(header?.style.paddingLeft).toBe('78px');
  });

  it('shows account context only when provided', () => {
    const { rerender } = render(
      <AppShell platform="win32" workspaceName="p" onRaw={() => {}}>
        <div />
      </AppShell>,
    );
    expect(screen.queryByTestId('account-context')).toBeNull();
    rerender(
      <AppShell platform="win32" workspaceName="p" account="Pro·acct-1" onRaw={() => {}}>
        <div />
      </AppShell>,
    );
    expect(screen.getByText('Pro·acct-1')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-ui/src/layout/AppShell.test.tsx`
Expected: PASS (4 tests).

### Task B2: Intent declaration + catalogue

**Files:**
- Create: `packages/console-ui/src/layout/AppShell.intent.ts`
- Modify: `packages/console-ui/src/registry.ts`
- Regenerate: `packages/console-ui/COMPONENTS.md`

**Interfaces:**
- Consumes: `../lib/intent.js` (`assertIntent`, `ComponentIntent`).
- Produces: `appShellIntent` appended to `allIntents`.

- [ ] **Step 1: Create** `packages/console-ui/src/layout/AppShell.intent.ts`

```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const appShellIntent: ComponentIntent = assertIntent({
  name: 'AppShell',
  family: 'Layout',
  intent: 'The window chrome: a custom title bar above a content slot the layout engine mounts into.',
  useWhen: ['Framing the desktop console — the one top-level shell around the panel layout.'],
  dontUseWhen: ['Arranging content regions — that is the layout descriptor and engine, not the shell.'],
  anatomy:
    'A draggable custom title bar (platform-inset wordmark, workspace label, account context, persistent raw affordance) above a single content slot.',
  variantsStates: ['darwin (traffic-light inset)', 'win32 (window-controls inset)', 'with-account', 'without-account'],
  accessibility:
    'The title bar is a labelled banner; the raw control is a real focusable button; the content slot is the main region.',
  related: ['Pane', 'Toolbar', 'NavList'],
});
```

- [ ] **Step 2: Register it.** In `packages/console-ui/src/registry.ts`, add the import after the `navListIntent` import:

```ts
import { appShellIntent } from './layout/AppShell.intent.js';
```

and add `appShellIntent,` to the `allIntents` array (after `navListIntent,`).

- [ ] **Step 3: Confirm the catalogue test now fails** (COMPONENTS.md is stale)

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-ui/src/registry.test.ts`
Expected: FAIL on "COMPONENTS.md is regenerated from the current intents".

- [ ] **Step 4: Regenerate COMPONENTS.md via a throwaway test** (no `tsx`/`vite-node` in repo — this is the blessed pattern). Create `packages/console-ui/src/_regen-catalog.test.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { allIntents } from './registry.js';
import { generateCatalog } from './lib/catalog.js';

it('regenerates COMPONENTS.md', () => {
  const out = fileURLToPath(new URL('../COMPONENTS.md', import.meta.url));
  writeFileSync(out, generateCatalog(allIntents), 'utf8');
});
```

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-ui/src/_regen-catalog.test.ts`
Expected: PASS (writes the file).

- [ ] **Step 5: Delete the throwaway test**

```bash
rm packages/console-ui/src/_regen-catalog.test.ts
```

- [ ] **Step 6: Confirm the real catalogue test now passes**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-ui/src/registry.test.ts`
Expected: PASS (4 tests; COMPONENTS.md now matches).

- [ ] **Step 7: Run the full Part B gate sweep**

```
pnpm_config_verify_deps_before_run=false corepack pnpm typecheck
pnpm_config_verify_deps_before_run=false corepack pnpm lint
pnpm_config_verify_deps_before_run=false corepack pnpm format:write
pnpm_config_verify_deps_before_run=false corepack pnpm format
pnpm_config_verify_deps_before_run=false corepack pnpm test
pnpm_config_verify_deps_before_run=false corepack pnpm depcruise
```
Expected: all PASS; depcruise 0 violations; `_regen-catalog.test.ts` is gone.

- [ ] **Step 8: Commit Part B** (stage by name; subject-only)

```bash
git add packages/console-ui/src/layout/AppShell.tsx \
  packages/console-ui/src/layout/AppShell.intent.ts \
  packages/console-ui/src/layout/AppShell.test.tsx \
  packages/console-ui/src/registry.ts packages/console-ui/src/index.ts \
  packages/console-ui/COMPONENTS.md
git commit -m "feat: add the console application shell chrome"
```

---

# Part C — the desktop walking shell (`apps/desktop`)

Wire the shared method registry + bridge, main-process persistence, the three panels, the default descriptor, and the `App` composition. Every gate green at the end; the app builds via `electron-vite build`. One commit.

### Task C1: The shared method registry

**Files:**
- Create: `apps/desktop/src/shared/methods.ts`
- Create: `apps/desktop/src/shared/methods.test.ts`
- Delete: `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/ipc.test.ts`

**Interfaces:**
- Consumes: `@coa/console-viewmodel` (`CapStateSchema`), `zod`.
- Produces:
  - `interface MethodSpec { params?: z.ZodType | undefined; result: z.ZodType }`
  - `const METHODS: Record<MethodName, MethodSpec>` with keys `capState`, `getLayout`, `saveLayout`
  - `type MethodName = 'capState' | 'getLayout' | 'saveLayout'`
  - `function channel(m: MethodName): string`

- [ ] **Step 1: Create** `apps/desktop/src/shared/methods.ts`

```ts
import { CapStateSchema } from '@coa/console-viewmodel';
import { z } from 'zod';

/**
 * The single source of truth for the IPC bridge: each verb -> its params/result
 * Zod schemas, consumed by BOTH the preload/main validation and the renderer.
 * `capState` proxies the daemon read verb; `getLayout`/`saveLayout` are main-local
 * file ops. The layout descriptor is console-local and re-validated at the renderer
 * edge (parseDescriptor), so main persists it opaquely (z.unknown).
 */
export interface MethodSpec {
  params?: z.ZodType | undefined;
  result: z.ZodType;
}

export const METHODS = {
  capState: { result: CapStateSchema },
  getLayout: { result: z.unknown() },
  saveLayout: { params: z.unknown(), result: z.void() },
} satisfies Record<string, MethodSpec>;

export type MethodName = keyof typeof METHODS;

/** The ipcRenderer/ipcMain channel name for a verb. */
export function channel(m: MethodName): string {
  return `coa:${m}`;
}
```

- [ ] **Step 2: Write the failing test** `apps/desktop/src/shared/methods.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { METHODS, channel } from './methods.js';

describe('IPC method registry', () => {
  it('names channels per verb', () => {
    expect(channel('capState')).toBe('coa:capState');
    expect(channel('saveLayout')).toBe('coa:saveLayout');
  });

  it('validates a cap result and rejects a malformed one', () => {
    expect(METHODS.capState.result.parse({ remaining: null, capHit: false })).toBeTruthy();
    expect(() => METHODS.capState.result.parse({})).toThrow();
  });

  it('accepts an opaque layout for save and read', () => {
    expect(() => METHODS.saveLayout.params?.parse({ any: 'json' })).not.toThrow();
    expect(METHODS.getLayout.result.parse({ any: 'json' })).toBeTruthy();
  });
});
```

- [ ] **Step 3: Delete the superseded files**

```bash
rm apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/ipc.test.ts
```

- [ ] **Step 4: Run the new test** (main/preload still import the old `ipc.ts` — that is fixed in C3/C4; run just this file for now)

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/shared/methods.test.ts`
Expected: PASS (3 tests).

### Task C2: Main-process layout persistence

**Files:**
- Create: `apps/desktop/src/main/persistence.ts`
- Create: `apps/desktop/src/main/persistence.test.ts`

**Interfaces:**
- Consumes: `node:fs`, `node:path`.
- Produces:
  - `function readLayout(file: string): unknown` — parsed JSON, or `undefined` on missing/corrupt.
  - `function writeLayout(file: string, descriptor: unknown): void` — creates parent dir, writes JSON.

- [ ] **Step 1: Write the failing test** `apps/desktop/src/main/persistence.test.ts`

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLayout, writeLayout } from './persistence.js';

describe('layout persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-layout-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a descriptor through a nested path', () => {
    const file = join(dir, 'console', 'layout.json');
    const value = { version: 1, root: { type: 'leaf', panelId: 'cost' } };
    writeLayout(file, value);
    expect(readLayout(file)).toEqual(value);
  });

  it('returns undefined for a missing file', () => {
    expect(readLayout(join(dir, 'nope.json'))).toBeUndefined();
  });

  it('returns undefined for corrupt JSON (renderer falls back to default)', () => {
    const file = join(dir, 'corrupt.json');
    writeLayout(file, undefined); // writes the string "undefined" is invalid JSON below; force corrupt instead
    // overwrite with genuine garbage:
    // eslint-disable-next-line no-restricted-syntax
    require('node:fs').writeFileSync(file, '{ not json', 'utf8');
    expect(readLayout(file)).toBeUndefined();
  });
});
```

Simplify the corrupt case to avoid `require` (ESM): rewrite the third test as:

```ts
  it('returns undefined for corrupt JSON (renderer falls back to default)', () => {
    const file = join(dir, 'corrupt.json');
    writeFileSync(file, '{ not json', 'utf8');
    expect(readLayout(file)).toBeUndefined();
  });
```

and add `writeFileSync` to the `node:fs` import at the top of the test.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/main/persistence.test.ts`
Expected: FAIL (cannot resolve `./persistence.js`).

- [ ] **Step 3: Implement** `apps/desktop/src/main/persistence.ts`

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Read the persisted layout descriptor as opaque JSON. Returns `undefined` on a
 *  missing or corrupt file; the renderer validates the shape via `parseDescriptor`
 *  and falls back to its default, so persistence never throws on bad input. */
export function readLayout(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Persist the descriptor opaquely (creating its parent directory). */
export function writeLayout(file: string, descriptor: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(descriptor), 'utf8');
}
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/main/persistence.test.ts`
Expected: PASS (3 tests).

### Task C3: Wire the main process to the registry + persistence

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- Consumes: `METHODS`, `channel`, `MethodName` from `../shared/methods.js`; `readLayout`, `writeLayout` from `./persistence.js`; the existing `ensureClient` / `DaemonError`.
- Produces: an `ipcMain.handle` per registry method; a `layout.json` under `app.getPath('userData')`.

- [ ] **Step 1: Replace the IPC section of** `apps/desktop/src/main/index.ts`. Remove the `import { IPC_GET_CAP, CapResultSchema } from '../shared/ipc.js';` line and the single `ipcMain.handle(IPC_GET_CAP, …)` block. Add these imports near the top:

```ts
import { join } from 'node:path';
import { METHODS, channel, type MethodName } from '../shared/methods.js';
import { readLayout, writeLayout } from './persistence.js';
```

(`join` is already imported — keep a single import.) Then add, after the `ensureClient` definition:

```ts
/** The per-user layout file. Per-workspace keying lands when the app gains a
 *  workspace-open flow; today the daemon is a single fixed pipe. */
function layoutFile(): string {
  return join(app.getPath('userData'), 'coa', 'layout.json');
}

async function runMethod(name: MethodName, params: unknown): Promise<unknown> {
  switch (name) {
    case 'capState': {
      const res = await (await ensureClient()).request('capState');
      if ('error' in res && res.error) throw new DaemonError(res.error.message, res.error.code);
      return res.result;
    }
    case 'getLayout':
      return readLayout(layoutFile());
    case 'saveLayout':
      writeLayout(layoutFile(), params);
      return undefined;
  }
}

for (const name of Object.keys(METHODS) as MethodName[]) {
  ipcMain.handle(channel(name), async (_event, rawParams: unknown) => {
    const spec = METHODS[name];
    const params = spec.params ? spec.params.parse(rawParams) : undefined;
    const result = await runMethod(name, params);
    return spec.result.parse(result);
  });
}
```

- [ ] **Step 2: Typecheck** (renderer/preload not yet updated, but main should compile)

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck`
Expected: may FAIL only on preload/renderer (fixed in C4/C7). Main-side errors (missing symbols) must be zero. If the only errors are in `preload/index.ts` / `renderer/App.tsx`, proceed.

### Task C4: Generate the preload bridge from the registry

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/api.d.ts`

**Interfaces:**
- Consumes: `METHODS`, `channel`, `MethodName` from `../shared/methods.js`; `electron` (`contextBridge`, `ipcRenderer`); `process.platform`.
- Produces: `window.coa` = `{ platform, capState(), getLayout(), saveLayout(d) }`.

- [ ] **Step 1: Replace** `apps/desktop/src/preload/index.ts`

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { METHODS, channel, type MethodName } from '../shared/methods.js';

// One named method per verb, generated from the shared registry; no raw
// ipcRenderer is exposed. `process.platform` is available in the sandboxed
// preload and is injected so the renderer applies title-bar insets without
// touching `process` (spec §9).
const api: Record<string, unknown> = { platform: process.platform };
for (const name of Object.keys(METHODS) as MethodName[]) {
  api[name] = (params?: unknown): Promise<unknown> => ipcRenderer.invoke(channel(name), params);
}

contextBridge.exposeInMainWorld('coa', api);
```

- [ ] **Step 2: Replace** `apps/desktop/src/preload/api.d.ts`

```ts
import type { CapState } from '@coa/console-viewmodel';

export {};
declare global {
  interface Window {
    coa: {
      /** 'darwin' | 'win32' | other. */
      platform: string;
      capState(): Promise<CapState>;
      getLayout(): Promise<unknown>;
      saveLayout(descriptor: unknown): Promise<void>;
    };
  }
}
```

### Task C5: The daemon-state aggregate + panels

**Files:**
- Create: `apps/desktop/src/renderer/panels/state.ts`
- Create: `apps/desktop/src/renderer/panels/PlaceholderPanel.tsx`
- Create: `apps/desktop/src/renderer/panels/NavPanel.tsx`
- Create: `apps/desktop/src/renderer/panels/CostPanel.tsx`
- Create: `apps/desktop/src/renderer/panels/CostPanel.test.tsx`

**Interfaces:**
- Consumes: `@coa/console-layout` (`PanelDefinition`, `PanelHostApi`), `@coa/console-ui` (`Pane`, `Skeleton`, `InlineMessage`, `IconButton`), `@coa/console-viewmodel` (`CapState`, `CapViewModel`, `toCapViewModel`), `lucide-react`.
- Produces: `Remote<T>`, `DaemonState`, `INITIAL_STATE`; `makePlaceholderPanel`; `navPanel`; `costPanel`, `selectCostVm`, `CostVm`.

- [ ] **Step 1: Create** `apps/desktop/src/renderer/panels/state.ts`

```ts
import type { CapState } from '@coa/console-viewmodel';

/** A single async read's UI state — carries loading/error/value through the
 *  pure selector so panels can render states-first. */
export type Remote<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: T };

/** The aggregate the app polls and pushes into the engine. Widened in later plans. */
export interface DaemonState {
  cap: Remote<CapState>;
}

export const INITIAL_STATE: DaemonState = { cap: { status: 'loading' } };
```

- [ ] **Step 2: Create** `apps/desktop/src/renderer/panels/PlaceholderPanel.tsx` (the reusable honest-mock surface)

```tsx
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import type { DaemonState } from './state.js';

/** A registered-but-not-yet-wired surface: real chrome, honest "arrives later"
 *  copy, no emoji. Swapped for a live panel when its M8 seam lands (spec §16). */
export function makePlaceholderPanel(
  id: string,
  displayName: string,
  note: string,
): PanelDefinition<string, DaemonState> {
  function View({ vm }: { vm: string; host: PanelHostApi }): React.JSX.Element {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <div className="text-[13px] font-medium text-muted">{displayName}</div>
          <div className="mt-1 text-[12px] text-faint">{vm}</div>
        </div>
      </div>
    );
  }
  return { id, displayName, render: View, selectVm: () => note };
}
```

- [ ] **Step 3: Create** `apps/desktop/src/renderer/panels/NavPanel.tsx` (the activity-bar rail — real, accessible chrome; section switching is a stub)

```tsx
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { IconButton } from '@coa/console-ui';
import { GitGraph, MessagesSquare, ScrollText, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DaemonState } from './state.js';

export interface NavVm {
  activeId: string;
}

/** 4a has one section's worth of content, so the active section is fixed;
 *  real routing lands when a second surface exists. */
export function selectNavVm(_state: DaemonState): NavVm {
  return { activeId: 'conversation' };
}

const SECTIONS: ReadonlyArray<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'conversation', label: 'Conversation', icon: MessagesSquare },
  { id: 'decisions', label: 'Decisions', icon: ScrollText },
  { id: 'graph', label: 'Graph', icon: GitGraph },
];

function NavRail({ vm }: { vm: NavVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <nav
      aria-label="Sections"
      className="flex h-full flex-col items-center gap-1 border-r border-hairline bg-subtle py-2"
    >
      <div className="flex flex-col gap-1">
        {SECTIONS.map((s) => (
          <IconButton
            key={s.id}
            icon={s.icon}
            label={s.label}
            variant="tertiary"
            aria-current={s.id === vm.activeId ? 'page' : undefined}
            data-active={s.id === vm.activeId ? 'true' : undefined}
          />
        ))}
      </div>
      <div className="mt-auto">
        <IconButton icon={Settings} label="Settings" variant="tertiary" />
      </div>
    </nav>
  );
}

export const navPanel: PanelDefinition<NavVm, DaemonState> = {
  id: 'nav',
  displayName: 'Navigation',
  render: NavRail,
  selectVm: selectNavVm,
};
```

- [ ] **Step 4: Create** `apps/desktop/src/renderer/panels/CostPanel.tsx` (the one live surface, states-first)

```tsx
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { InlineMessage, Pane, Skeleton } from '@coa/console-ui';
import { toCapViewModel, type CapViewModel } from '@coa/console-viewmodel';
import type { DaemonState } from './state.js';

export type CostVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; vm: CapViewModel };

/** Pure: maps the polled cap read into a render state. */
export function selectCostVm(state: DaemonState): CostVm {
  const r = state.cap;
  if (r.status === 'ok') return { status: 'ok', vm: toCapViewModel(r.value) };
  return r;
}

function CostView({ vm }: { vm: CostVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <Pane title="Cost">
      {vm.status === 'loading' && (
        <div className="flex flex-col gap-2">
          <Skeleton className="w-24" />
          <Skeleton className="w-16" />
        </div>
      )}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {vm.status === 'ok' && (
        <div>
          <div
            className={
              vm.vm.tone === 'danger'
                ? 'text-[18px] font-semibold text-danger-text'
                : 'text-[18px] font-semibold text-fg'
            }
          >
            {vm.vm.headline}
          </div>
          <div className="text-[11px] text-muted">{vm.vm.sub}</div>
        </div>
      )}
    </Pane>
  );
}

export const costPanel: PanelDefinition<CostVm, DaemonState> = {
  id: 'cost',
  displayName: 'Cost',
  render: CostView,
  selectVm: selectCostVm,
};
```

- [ ] **Step 5: Write the failing test** `apps/desktop/src/renderer/panels/CostPanel.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { costPanel, selectCostVm, type CostVm } from './CostPanel.js';
import type { DaemonState } from './state.js';

const CostView = costPanel.render;

describe('selectCostVm', () => {
  it('passes loading and error through unchanged', () => {
    expect(selectCostVm({ cap: { status: 'loading' } })).toEqual({ status: 'loading' });
    expect(selectCostVm({ cap: { status: 'error', message: 'boom' } })).toEqual({
      status: 'error',
      message: 'boom',
    });
  });

  it('maps an ok cap read to a cost view-model', () => {
    const state: DaemonState = { cap: { status: 'ok', value: { remaining: 2.5, capHit: false } } };
    const vm = selectCostVm(state);
    expect(vm.status).toBe('ok');
    if (vm.status === 'ok') expect(vm.vm.headline).toBe('$2.50 left');
  });
});

const host = {
  title: 'Cost',
  setTitle: () => {},
  onVisibilityChange: () => () => {},
  requestFocus: () => {},
};

describe('CostView states-first', () => {
  it('shows skeletons while loading', () => {
    const { container } = render(<CostView vm={{ status: 'loading' }} host={host} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows an alert on error', () => {
    render(<CostView vm={{ status: 'error', message: 'daemon down' }} host={host} />);
    expect(screen.getByRole('alert').textContent).toContain('daemon down');
  });

  it('shows the headline on success', () => {
    const vm: CostVm = { status: 'ok', vm: { headline: '$2.50 left', sub: 'under cap', tone: 'neutral' } };
    render(<CostView vm={vm} host={host} />);
    expect(screen.getByText('$2.50 left')).toBeTruthy();
    expect(screen.getByText('under cap')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/CostPanel.test.tsx`
Expected: PASS (5 tests). (`InlineMessage` with `tone="danger"` renders `role="alert"`.)

### Task C6: The panel registry + default descriptor

**Files:**
- Create: `apps/desktop/src/renderer/panels/registry.ts`
- Create: `apps/desktop/src/renderer/panels/registry.test.ts`

**Interfaces:**
- Consumes: `@coa/console-layout` (`createPanelRegistry`, `parseDescriptor`, `LAYOUT_VERSION`, `PanelRegistry`, `LayoutDescriptor`); `navPanel`, `costPanel`, `makePlaceholderPanel`.
- Produces: `buildPanelRegistry(): PanelRegistry`; `DEFAULT_DESCRIPTOR: LayoutDescriptor`.

- [ ] **Step 1: Create** `apps/desktop/src/renderer/panels/registry.ts`

```ts
import {
  createPanelRegistry,
  LAYOUT_VERSION,
  type LayoutDescriptor,
  type PanelRegistry,
} from '@coa/console-layout';
import { costPanel } from './CostPanel.js';
import { navPanel } from './NavPanel.js';
import { makePlaceholderPanel } from './PlaceholderPanel.js';

/** The 4a surfaces: the activity-bar rail, a conversation placeholder, and the
 *  one live surface (cost). Later plans register the remaining surfaces here. */
export function buildPanelRegistry(): PanelRegistry {
  const registry = createPanelRegistry();
  registry.register(navPanel);
  registry.register(
    makePlaceholderPanel(
      'conversation',
      'Conversation',
      'The live conversation stream arrives with a later build.',
    ),
  );
  registry.register(costPanel);
  return registry;
}

/**
 * Direction B (spec §21): a static outer split places the narrow nav rail beside
 * the workbench body; the single draggable boundary is conversation <-> cost.
 * The dashboard rail grows into a column-static split of multiple cards in a
 * later plan; for the skeleton the right pane is the cost surface.
 *
 * `nav`'s small fractional size gives the narrow activity-bar width under the
 * StaticEngine's flex-ratio model (body always has flex-grow 1); a fixed-pixel
 * rail width is a later engine refinement.
 */
export const DEFAULT_DESCRIPTOR: LayoutDescriptor = {
  version: LAYOUT_VERSION,
  root: {
    type: 'split',
    direction: 'row',
    adjustability: 'static',
    children: [
      { type: 'leaf', panelId: 'nav', size: 0.06 },
      {
        type: 'split',
        direction: 'row',
        adjustability: 'resizable',
        children: [
          { type: 'leaf', panelId: 'conversation', size: 70 },
          { type: 'leaf', panelId: 'cost', size: 30 },
        ],
      },
    ],
  },
};
```

- [ ] **Step 2: Write the failing test** `apps/desktop/src/renderer/panels/registry.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseDescriptor } from '@coa/console-layout';
import { DEFAULT_DESCRIPTOR, buildPanelRegistry } from './registry.js';

describe('panel registry', () => {
  it('registers the three skeleton panels', () => {
    const reg = buildPanelRegistry();
    for (const id of ['nav', 'conversation', 'cost']) expect(reg.has(id)).toBe(true);
  });

  it('the default descriptor survives parseDescriptor unchanged (all panels known)', () => {
    const reg = buildPanelRegistry();
    expect(parseDescriptor(DEFAULT_DESCRIPTOR, reg, DEFAULT_DESCRIPTOR)).toEqual(DEFAULT_DESCRIPTOR);
  });
});
```

- [ ] **Step 3: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/registry.test.ts`
Expected: PASS (2 tests).

### Task C7: The console controller + App composition

**Files:**
- Create: `apps/desktop/src/renderer/console.ts`
- Create: `apps/desktop/src/renderer/console.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

**Interfaces:**
- Consumes: `@coa/console-layout` (`createStaticEngine`, `parseDescriptor`, `LayoutHandle`); `buildPanelRegistry`, `DEFAULT_DESCRIPTOR`; `INITIAL_STATE`, `DaemonState`; `@coa/console-ui` (`AppShell`); `window.coa`.
- Produces: `interface ConsoleBridge`; `startConsole(container, bridge): Promise<ConsoleController>`; `ConsoleController { refresh(); dispose() }`; the rewritten `App`.

- [ ] **Step 1: Create** `apps/desktop/src/renderer/console.ts`

```ts
import { createStaticEngine, parseDescriptor, type LayoutHandle } from '@coa/console-layout';
import type { CapState } from '@coa/console-viewmodel';
import { buildPanelRegistry, DEFAULT_DESCRIPTOR } from './panels/registry.js';
import { INITIAL_STATE, type DaemonState } from './panels/state.js';

/** The subset of `window.coa` the controller needs (injected for testing). */
export interface ConsoleBridge {
  capState(): Promise<CapState>;
  getLayout(): Promise<unknown>;
  saveLayout(descriptor: unknown): Promise<void>;
}

export interface ConsoleController {
  /** Poll the daemon once and push the result into the mounted panels. */
  refresh(): Promise<void>;
  dispose(): void;
}

/** Mount the layout engine into `container`, restore the persisted layout (falling
 *  back to the default on any corruption), and return a controller that polls the
 *  daemon and persists layout changes. */
export async function startConsole(
  container: HTMLElement,
  bridge: ConsoleBridge,
): Promise<ConsoleController> {
  const registry = buildPanelRegistry();
  const raw = await bridge.getLayout();
  const descriptor = parseDescriptor(raw, registry, DEFAULT_DESCRIPTOR);
  let state: DaemonState = INITIAL_STATE;
  const engine = createStaticEngine();
  const handle: LayoutHandle = engine.mount({
    container,
    descriptor,
    registry,
    daemonState: state,
    onChange: (d) => {
      void bridge.saveLayout(d);
    },
  });
  async function refresh(): Promise<void> {
    try {
      const value = await bridge.capState();
      state = { ...state, cap: { status: 'ok', value } };
    } catch (e) {
      state = { ...state, cap: { status: 'error', message: e instanceof Error ? e.message : String(e) } };
    }
    handle.setDaemonState(state);
  }
  return { refresh, dispose: () => handle.dispose() };
}
```

- [ ] **Step 2: Write the failing test** `apps/desktop/src/renderer/console.test.tsx`

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startConsole, type ConsoleBridge } from './console.js';

function fakeBridge(over: Partial<ConsoleBridge> = {}): ConsoleBridge {
  return {
    capState: vi.fn().mockResolvedValue({ remaining: 2.5, capHit: false }),
    getLayout: vi.fn().mockResolvedValue(undefined),
    saveLayout: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('startConsole', () => {
  it('mounts the default layout and shows the cost surface loading, then live', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let controller!: Awaited<ReturnType<typeof startConsole>>;
    await act(async () => {
      controller = await startConsole(container, fakeBridge());
    });
    // nav + conversation placeholder + cost pane all present; cost starts loading.
    expect(container.querySelector('[data-panel-id="cost"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="nav"]')).not.toBeNull();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    await act(async () => {
      await controller.refresh();
    });
    expect(container.textContent).toContain('$2.50 left');
  });

  it('falls back to the default layout when persisted layout is corrupt', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      await startConsole(container, fakeBridge({ getLayout: vi.fn().mockResolvedValue('{ not json') }));
    });
    // still the full default tree (conversation + cost present).
    expect(container.querySelector('[data-panel-id="conversation"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="cost"]')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/console.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 4: Replace** `apps/desktop/src/renderer/App.tsx`

```tsx
import { useEffect, useRef } from 'react';
import { AppShell } from '@coa/console-ui';
import { startConsole, type ConsoleController } from './console.js';

const POLL_MS = 2000;

export function App(): React.JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = slotRef.current;
    if (!container) return;
    let controller: ConsoleController | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    void (async () => {
      controller = await startConsole(container, window.coa);
      if (disposed) {
        controller.dispose();
        return;
      }
      await controller.refresh();
      timer = setInterval(() => void controller?.refresh(), POLL_MS);
    })();
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      controller?.dispose();
    };
  }, []);

  return (
    <AppShell
      platform={window.coa.platform}
      workspaceName="myproject"
      onRaw={() => {
        // The `coa raw` transparency view is a later surface; the affordance is
        // always present and focusable in the chrome (D85).
      }}
    >
      <div ref={slotRef} style={{ height: '100%' }} />
    </AppShell>
  );
}
```

### Task C8: Consumption wiring + docs

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/tsconfig.json`
- Modify: `apps/desktop/electron.vite.config.ts`
- Modify: `docs/REPO_LAYOUT.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: `apps/desktop` resolves `@coa/console-layout` + `lucide-react` at runtime/type time.

- [ ] **Step 1: Add dependencies.** In `apps/desktop/package.json`, add to `dependencies` (alphabetical):

```json
    "@coa/console-layout": "workspace:*",
    "lucide-react": "^0.400.0",
```

- [ ] **Step 2: Add the tsconfig reference.** In `apps/desktop/tsconfig.json` `references`, add after the `console-ui` line:

```json
    { "path": "../../packages/console-layout" },
```

- [ ] **Step 3: Add the renderer aliases.** In `apps/desktop/electron.vite.config.ts`, extend the renderer `resolve.alias` so the app bundles the layout core + view-model from source (mirroring `console-ui`):

```ts
    resolve: {
      alias: {
        '@coa/console-ui': fileURLToPath(
          new URL('../../packages/console-ui/src/index.ts', import.meta.url),
        ),
        '@coa/console-viewmodel': fileURLToPath(
          new URL('../../packages/console-viewmodel/src/index.ts', import.meta.url),
        ),
        '@coa/console-layout': fileURLToPath(
          new URL('../../packages/console-layout/src/index.ts', import.meta.url),
        ),
      },
    },
```

- [ ] **Step 4: Install** (registers the new workspace dep + lucide-react for the app)

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm install`
Expected: success.

- [ ] **Step 5: Update `docs/REPO_LAYOUT.md`.** In the M10 Console notes for `apps/desktop`, append a sentence noting the shell composition — e.g. after the existing desktop description add:

```
The renderer composes the AppShell chrome + the StaticEngine (from console-layout) + concrete panels
(nav rail, conversation placeholder, live cost) in `src/renderer/panels/`; the IPC bridge is generated from a
shared Zod method registry (`src/shared/methods.ts`) and layout is persisted per-user by the main process
(`src/main/persistence.ts`).
```

(Match the file's existing prose style; keep it to the M10 row/section.)

### Task C9: Full build + gate sweep + commit

- [ ] **Step 1: Verify the app builds** (the un-bootable-GUI stand-in for a smoke test)

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm --filter @coa/desktop build`
Expected: `electron-vite build` completes for main/preload/renderer with no unresolved imports.

- [ ] **Step 2: Run the full gate sweep**

```
pnpm_config_verify_deps_before_run=false corepack pnpm typecheck
pnpm_config_verify_deps_before_run=false corepack pnpm lint
pnpm_config_verify_deps_before_run=false corepack pnpm format:write
pnpm_config_verify_deps_before_run=false corepack pnpm format
pnpm_config_verify_deps_before_run=false corepack pnpm test
pnpm_config_verify_deps_before_run=false corepack pnpm depcruise
```
Expected: all PASS. depcruise 0 violations (renderer imports only console-ui/console-layout/console-viewmodel/lucide-react + react — no electron/core; `renderer-isolation` holds). Test total = Part B total + (methods 3 + persistence 3 + CostPanel 5 + registry 2 + console 2) = +15.

- [ ] **Step 3: Commit Part C** (stage by name; subject-only)

```bash
git add apps/desktop/src/shared/methods.ts apps/desktop/src/shared/methods.test.ts \
  apps/desktop/src/main/persistence.ts apps/desktop/src/main/persistence.test.ts \
  apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/preload/api.d.ts \
  apps/desktop/src/renderer/panels/state.ts apps/desktop/src/renderer/panels/PlaceholderPanel.tsx \
  apps/desktop/src/renderer/panels/NavPanel.tsx apps/desktop/src/renderer/panels/CostPanel.tsx \
  apps/desktop/src/renderer/panels/CostPanel.test.tsx apps/desktop/src/renderer/panels/registry.ts \
  apps/desktop/src/renderer/panels/registry.test.ts apps/desktop/src/renderer/console.ts \
  apps/desktop/src/renderer/console.test.tsx apps/desktop/src/renderer/App.tsx \
  apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/electron.vite.config.ts \
  docs/REPO_LAYOUT.md pnpm-lock.yaml
git rm apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/ipc.test.ts
git commit -m "feat: compose the desktop console shell over the daemon"
```

---

## Post-plan: memory upkeep (not a code commit)

After all three parts land green, update `C:\Users\Zander\.claude\projects\c--Users-Zander-Documents-Side-Projects-coa\memory\m10-status.md` and the `MEMORY.md` index: 4a is BUILT — `console-layout` gained `setDaemonState`; `console-ui` gained `AppShell`; `apps/desktop` now composes the direction-B shell (AppShell + StaticEngine + nav/conversation/cost panels) with cost live over the daemon, a shared-Zod-registry IPC bridge, and main-process `layout.json` persistence. Next: 4b (remaining buildable-now surfaces) then 4c (mock surfaces).

## Self-review

**Spec coverage (§21 + §12/§13/§16):**
- 4a walking-skeleton scope → Parts A–C. AppShell = title bar + content slot, nav rail as descriptor region → Part B (chrome) + C6 (nav panel + descriptor). Live-data seam (`setDaemonState`) → Part A. Shared-Zod-registry bridge → C1/C3/C4. Main-file persistence, no daemon verb → C2/C3. Default direction-B descriptor → C6. Panels in `apps/desktop` → C5–C6. States-first (loading/error/value) → C5 (CostPanel). `coa raw` always reachable → B1 (persistent focusable button). No emoji / Lucide only → B1, C5. WAI-ARIA + focus → B1 (labelled banner/main, focusable raw), C5 (alert on error), nav labelled. Renderer isolation → C9 depcruise.
- §12 buildable-now cost/cap live → C5/C7 over the real `capState` verb. Mock conversation → C5 placeholder. §16 no-refactor (mock→verb via registry) → the registry + selectVm seam (C5–C7) swaps data source with no shell change.

**Placeholder scan:** none — every step carries real code/commands. The C2 corrupt-JSON test note replaces the `require` sketch with the ESM `writeFileSync` form (follow the second snippet).

**Type consistency:** `LayoutHandle.setDaemonState(state: unknown)` identical in A1 (port) and A2 (impl) and consumed in A3/C7. `DaemonState`/`Remote<T>`/`INITIAL_STATE` identical across C5 (state.ts), CostPanel, NavPanel, registry, console. `PanelDefinition<VM, S>` usages (`navPanel`, `costPanel`, `makePlaceholderPanel`) match the console-layout signature. `METHODS`/`channel`/`MethodName` identical across C1/C3/C4. `ConsoleBridge` (C7) is the structural subset of `window.coa` (C4 api.d.ts). `AppShellProps` identical B1↔C7 usage (`platform`, `workspaceName`, `onRaw`, `children`).

**Deferred (out of 4a scope, confirmed):** per-workspace layout keying (single per-user file today); fixed-pixel nav width (flex-ratio approximation); nav section-routing (stub); the dashboard rail's additional cards, and every 4b/4c surface.
