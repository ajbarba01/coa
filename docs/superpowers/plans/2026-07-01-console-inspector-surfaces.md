# Console Inspector Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 4a walking skeleton into the inspector-first console — the nav rail drives the main region, a persistent right dock holds chat/agent/account, and the remaining buildable-now surfaces (flags, timeline, account selector, settings) run live over the daemon.

**Architecture:** Three parts, three commits. (1) **Reshape** — a single `ConsoleState { data, ui, actions }` pushed through the existing `setDaemonState` seam; the nav rail routes by swapping the main leaf's `panelId` (sizes survive because they live in the descriptor as `defaultSize`); Cost re-homes into a nav window. (2) **Read surfaces** — Flags + Timeline panels + their edge schemas + IPC proxies. (3) **Interactive + persistence** — the Account selector (auth verbs) and a dedicated, extensible `ConsoleSettings` (theme/density/motion) persisted per-user by the main process. No `console-layout` or `console-ui` changes — every surface uses existing kit components and the existing engine handle.

**Tech Stack:** TypeScript (strict), React 19, `@coa/console-layout` (StaticEngine + registry + descriptor), `@coa/console-ui` (kit + tokens), `@coa/console-viewmodel` (pure edge schemas + selectors), `@coa/shared` (the `FeedView` wire type), Electron (electron-vite), Zod 4, Vitest + jsdom + @testing-library/react, Lucide icons.

## Global Constraints

- **TypeScript `strict`, no `any`.** Use `unknown` + narrow casts where unavoidable.
- **`exactOptionalPropertyTypes` is ON.** Type an omittable optional field `x?: T | undefined`.
- **SC-1 — help, never cage.** Nothing in this plan denies or gates. A cap-hit is surfaced honestly in the Cost window; the SC-1 DenyNotice *banner* wires with the live deny channel in 4c. (spec §3, §21.1)
- **`coa raw` stays reachable (D85).** The 4a title-bar `raw` affordance is untouched; its real content is deferred to 4c. (spec §21.1)
- **M10 is a leaf; talks only to M8.** Every daemon read is an existing bound verb (`capState`/`flagsForUser`/`listTimeline`/`listAccounts`/`currentAccount`/`useAccount`). Layout + settings persist console-locally on the Electron **main** side — no new daemon verb. (spec §21/§21.1/§21.2)
- **Renderer isolation (D128).** The renderer imports no `electron` and no `packages/core` (enforced: `renderer-isolation`). Edge types reach the renderer via `@coa/console-viewmodel` (pure) — never `@coa/core` (where `Checkpoint`/`Account` live). Privileged work (pipe client, filesystem) is main-only.
- **Zod at the edges (§10.2).** Every IPC result/param is Zod-validated through the shared method registry; the edge schemas live in `@coa/console-viewmodel`.
- **States-first (§5.1 #12).** Every panel ships loading + empty + error with real content before the happy path.
- **NO emoji anywhere** — Lucide icons only. **WAI-ARIA + visible focus.** **Byte-faithful renders (D128).**
- **pnpm PATH quirk:** prefix every pnpm command with `pnpm_config_verify_deps_before_run=false corepack pnpm …`. Run gates individually via `corepack pnpm <gate>` (the composite `check` calls bare `pnpm` and fails).
- **Single test from the repo ROOT:** `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run <path>`.
- **DOM tests** start with a `// @vitest-environment jsdom` docblock (node is default). `vitest.setup.ts` polyfills pointer-capture/scrollIntoView/ResizeObserver for Radix.
- **Commits: subject-only Conventional Commits** — no body/trailers, **no internal identifiers** (module IDs / plan numbers / decision codes) in the subject. **Stage files by name.** **Developer-sized commits** — one per Part (three total), NOT per task.
- **Same-commit doc rule:** the Part that adds the `@coa/shared` dependency to `console-viewmodel` updates that package's `package.json` + `tsconfig.json` in the same commit; `REPO_LAYOUT.md` gets a note in Part 3.

---

## File structure

```
packages/console-viewmodel/
  src/reads.ts                       new (P2) — FeedView re-export + Checkpoint schema; (P3) account schemas
  src/index.ts                       modify (P2) — export reads
  package.json                       modify (P2) — add @coa/shared dep
  tsconfig.json                      modify (P2) — reference ../shared

apps/desktop/
  src/renderer/panels/state.ts       modify (P1 ConsoleState; P2 +flags/timeline; P3 +accounts/settings)
  src/renderer/panels/routing.ts     new (P1) — setMainPanelId + ROUTABLE_IDS + makeDescriptor
  src/renderer/panels/routing.test.ts new (P1)
  src/renderer/panels/NavPanel.tsx   modify (P1 setRoute+highlight; P2/P3 add sections)
  src/renderer/panels/CostPanel.tsx  modify (P1) — selectVm reads ConsoleState.data.cap
  src/renderer/panels/CostPanel.test.tsx modify (P1)
  src/renderer/panels/registry.ts    modify (P1 inspector descriptor; P2/P3 register panels + dock)
  src/renderer/panels/registry.test.ts modify (P1)
  src/renderer/panels/FlagsPanel.tsx new (P2)
  src/renderer/panels/FlagsPanel.test.tsx new (P2)
  src/renderer/panels/TimelinePanel.tsx new (P2)
  src/renderer/panels/TimelinePanel.test.tsx new (P2)
  src/renderer/panels/AccountPanel.tsx new (P3)
  src/renderer/panels/AccountPanel.test.tsx new (P3)
  src/renderer/panels/SettingsPanel.tsx new (P3)
  src/renderer/panels/SettingsPanel.test.tsx new (P3)
  src/renderer/console.ts            modify (P1 ConsoleState+routing+epoch; P2 poll flags/timeline; P3 accounts+settings)
  src/renderer/console.test.tsx      modify (P1; P2; P3)
  src/renderer/theme.ts              new (P3) — applySettings (tokens/color-scheme/motion)
  src/renderer/theme.test.ts         new (P3)
  src/renderer/main.tsx              modify (P3) — id the tokens <style>
  src/renderer/globals.css           modify (P3) — [data-motion='reduce'] reset
  src/shared/methods.ts              modify (P2 flags/timeline; P3 accounts/settings)
  src/shared/methods.test.ts         modify (P2; P3)
  src/shared/settings.ts             new (P3) — ConsoleSettings schema/defaults/parse
  src/shared/settings.test.ts        new (P3)
  src/main/index.ts                  modify (P2 runMethod cases; P3 cases + settings file)
  src/main/persistence.ts            modify (P3) — rename to generic readJson/writeJson
  src/main/persistence.test.ts       modify (P3)
  src/preload/api.d.ts               modify (P2; P3) — extend window.coa typing
  electron.vite.config.ts            modify (P2) — add @coa/shared renderer alias
docs/REPO_LAYOUT.md                  modify (P3) — note the inspector surfaces
```

No `@coa/console-layout` or `@coa/console-ui` change. The preload `index.ts` needs no change — it generates one method per `METHODS` entry, so new verbs appear automatically.

---

# Part 1 — the inspector-first reshape

Generalize the pushed state to `ConsoleState { data, ui, actions }`, add nav routing (swap the main leaf's `panelId`), re-home Cost into a nav window, and stand up the right dock with chat + agent placeholders. Only Cost is live; Flags/Timeline/Account/Settings arrive in Parts 2–3.

### Task 1.1: ConsoleState

**Files:**
- Modify: `apps/desktop/src/renderer/panels/state.ts`

**Interfaces:**
- Consumes: `@coa/console-viewmodel` (`CapState`).
- Produces:
  - `type Remote<T>` (unchanged from 4a)
  - `interface ConsoleData { cap: Remote<CapState> }`
  - `interface ConsoleUi { activeMainPanelId: string }`
  - `interface ConsoleActions { setRoute: (panelId: string) => void; refresh: () => void }`
  - `interface ConsoleState { data: ConsoleData; ui: ConsoleUi; actions: ConsoleActions }`
  - `function initialState(actions: ConsoleActions): ConsoleState`

- [ ] **Step 1: Replace** `apps/desktop/src/renderer/panels/state.ts`

```ts
import type { CapState } from '@coa/console-viewmodel';

/** A single async read's UI state — carries loading/error/value through the
 *  pure selectors so panels can render states-first. */
export type Remote<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: T };

/** The daemon reads the console has fetched. Widened in later parts. */
export interface ConsoleData {
  cap: Remote<CapState>;
}

/** Local view state (not daemon data). Widened in later parts. */
export interface ConsoleUi {
  /** Which surface panel currently fills the nav-driven main region. */
  activeMainPanelId: string;
}

/** App-owned callbacks panels invoke to drive the console. Widened in later parts. */
export interface ConsoleActions {
  setRoute: (panelId: string) => void;
  refresh: () => void;
}

/** The single object pushed into the engine via setDaemonState: data down,
 *  actions up. Every panel's pure selectVm reads only what it needs. */
export interface ConsoleState {
  data: ConsoleData;
  ui: ConsoleUi;
  actions: ConsoleActions;
}

/** The default main surface when nothing is persisted. */
export const DEFAULT_MAIN_PANEL_ID = 'cost';

export function initialState(actions: ConsoleActions): ConsoleState {
  return {
    data: { cap: { status: 'loading' } },
    ui: { activeMainPanelId: DEFAULT_MAIN_PANEL_ID },
    actions,
  };
}
```

### Task 1.2: Routing helpers

**Files:**
- Create: `apps/desktop/src/renderer/panels/routing.ts`
- Test: `apps/desktop/src/renderer/panels/routing.test.ts`

**Interfaces:**
- Consumes: `@coa/console-layout` (`LayoutDescriptor`, `Region`, `LAYOUT_VERSION`).
- Produces:
  - `const ROUTABLE_IDS: ReadonlySet<string>` — panel ids that occupy the main region.
  - `function makeDescriptor(mainPanelId: string): LayoutDescriptor` — the inspector-first tree.
  - `function setMainPanelId(descriptor: LayoutDescriptor, mainPanelId: string): LayoutDescriptor` — swap the routable leaf's panelId, preserving all sizes.
  - `const LAYOUT_EPOCH = 2` — bump so a persisted 4a arrangement is ignored.

- [ ] **Step 1: Write the failing test** `apps/desktop/src/renderer/panels/routing.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { LAYOUT_EPOCH, ROUTABLE_IDS, makeDescriptor, setMainPanelId } from './routing.js';

describe('routing', () => {
  it('builds the inspector tree with the given main panel', () => {
    const d = makeDescriptor('cost');
    // nav rail + (main | right-dock)
    expect(d.root).toMatchObject({ type: 'split', direction: 'row', adjustability: 'static' });
    const leaves = JSON.stringify(d);
    expect(leaves).toContain('"panelId":"nav"');
    expect(leaves).toContain('"panelId":"cost"');
    expect(leaves).toContain('"panelId":"conversation"');
    expect(leaves).toContain('"panelId":"agent"');
  });

  it('swaps only the routable main leaf, preserving other panels and sizes', () => {
    const d = makeDescriptor('cost');
    const swapped = setMainPanelId(d, 'flags');
    const s = JSON.stringify(swapped);
    expect(s).toContain('"panelId":"flags"');
    expect(s).not.toContain('"panelId":"cost"');
    // dock + nav untouched
    expect(s).toContain('"panelId":"conversation"');
    expect(s).toContain('"panelId":"nav"');
  });

  it('leaves the descriptor unchanged when no routable leaf is present', () => {
    const d = makeDescriptor('cost');
    // 'nav' is not routable, so asking to place a routable id still targets the
    // current routable leaf; a descriptor with no routable leaf is returned as-is.
    const noRoutable = { version: d.version, root: { type: 'leaf', panelId: 'nav' } as const };
    expect(setMainPanelId(noRoutable, 'flags')).toEqual(noRoutable);
  });

  it('declares the routable set and a bumped layout epoch', () => {
    expect(ROUTABLE_IDS.has('cost')).toBe(true);
    expect(ROUTABLE_IDS.has('nav')).toBe(false);
    expect(LAYOUT_EPOCH).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/routing.test.ts`
Expected: FAIL (cannot resolve `./routing.js`).

- [ ] **Step 3: Implement** `apps/desktop/src/renderer/panels/routing.ts`

```ts
import { LAYOUT_VERSION, type LayoutDescriptor, type Region } from '@coa/console-layout';

/** Panels that occupy the nav-driven main region (never the rail or dock). Grows
 *  as surfaces land: cost (now) · flags · timeline (P2) · settings (P3). */
export const ROUTABLE_IDS: ReadonlySet<string> = new Set(['cost', 'flags', 'timeline', 'settings']);

/** Bump when the default arrangement changes so a persisted older layout is
 *  ignored (a 4a layout.json has no matching epoch → the new default is used). */
export const LAYOUT_EPOCH = 2;

/**
 * Inspector-first (spec §21.1): a thin static nav rail beside the workbench body;
 * the single draggable boundary is main↔dock; the right dock stacks chat + agent
 * (account joins it later). `nav`'s small fractional size gives the narrow rail
 * width under the StaticEngine's flex-ratio model.
 */
export function makeDescriptor(mainPanelId: string): LayoutDescriptor {
  return {
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
            { type: 'leaf', panelId: mainPanelId, size: 72 },
            {
              type: 'split',
              direction: 'column',
              adjustability: 'static',
              children: [
                { type: 'leaf', panelId: 'conversation' },
                { type: 'leaf', panelId: 'agent' },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** Replace the single routable leaf's panelId (the main region), preserving every
 *  other panel and all sizes. Robust to tree shape: it targets whichever leaf holds
 *  a routable id, so a future rearrangement still works. Returns the input unchanged
 *  if no routable leaf exists. */
export function setMainPanelId(descriptor: LayoutDescriptor, mainPanelId: string): LayoutDescriptor {
  function recur(region: Region): Region {
    if (region.type === 'leaf') {
      return ROUTABLE_IDS.has(region.panelId) ? { ...region, panelId: mainPanelId } : region;
    }
    return { ...region, children: region.children.map(recur) };
  }
  return { ...descriptor, root: recur(descriptor.root) };
}
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/routing.test.ts`
Expected: PASS (4 tests).

### Task 1.3: Cost panel + Nav panel over ConsoleState

**Files:**
- Modify: `apps/desktop/src/renderer/panels/CostPanel.tsx`
- Modify: `apps/desktop/src/renderer/panels/CostPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/panels/NavPanel.tsx`

**Interfaces:**
- Consumes: `ConsoleState` from `./state.js`; `@coa/console-ui`; `@coa/console-viewmodel`; `@coa/console-layout` (`PanelDefinition`, `PanelHostApi`); `lucide-react`.
- Produces: `costPanel: PanelDefinition<CostVm, ConsoleState>`; `navPanel: PanelDefinition<NavVm, ConsoleState>` (interactive: sets the route).

- [ ] **Step 1: Update the Cost selector** — in `apps/desktop/src/renderer/panels/CostPanel.tsx`, change the selector + generic to read the nested `cap`:

```ts
import type { ConsoleState } from './state.js';
```
Replace the import of `DaemonState` (delete that import line) and change `selectCostVm`:

```ts
/** Pure: maps the polled cap read into a render state. */
export function selectCostVm(state: ConsoleState): CostVm {
  const r = state.data.cap;
  if (r.status === 'ok') return { status: 'ok', vm: toCapViewModel(r.value) };
  return r;
}
```
and the export type:

```ts
export const costPanel: PanelDefinition<CostVm, ConsoleState> = {
  id: 'cost',
  displayName: 'Cost',
  render: CostView,
  selectVm: selectCostVm,
};
```

- [ ] **Step 2: Update the Cost test** — in `apps/desktop/src/renderer/panels/CostPanel.test.tsx`, replace the `DaemonState` import with `ConsoleState` and wrap the fixtures in the nested shape:

```tsx
import type { ConsoleState } from './state.js';

const stateWith = (cap: ConsoleState['data']['cap']): ConsoleState => ({
  data: { cap },
  ui: { activeMainPanelId: 'cost' },
  actions: { setRoute: () => {}, refresh: () => {} },
});
```
Then update the two `selectCostVm` calls:

```tsx
    expect(selectCostVm(stateWith({ status: 'loading' }))).toEqual({ status: 'loading' });
    expect(selectCostVm(stateWith({ status: 'error', message: 'boom' }))).toEqual({
      status: 'error',
      message: 'boom',
    });
```
and

```tsx
    const vm = selectCostVm(stateWith({ status: 'ok', value: { remaining: 2.5, capHit: false } }));
```
(The `CostView` render tests are unchanged — they take a `CostVm` directly.)

- [ ] **Step 3: Rewrite the Nav panel** `apps/desktop/src/renderer/panels/NavPanel.tsx` (interactive: highlights + sets the active main surface; gear reserved for Settings in P3)

```tsx
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { IconButton } from '@coa/console-ui';
import { Settings, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ConsoleState } from './state.js';

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** The nav-driven main surfaces. Grows as surfaces land (Flags/Timeline P2, the
 *  Settings gear P3). */
export const NAV_SECTIONS: readonly NavSection[] = [{ id: 'cost', label: 'Cost', icon: Wallet }];

export interface NavVm {
  activeId: string;
  setRoute: (id: string) => void;
}

export function selectNavVm(state: ConsoleState): NavVm {
  return { activeId: state.ui.activeMainPanelId, setRoute: state.actions.setRoute };
}

function NavRail({ vm }: { vm: NavVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <nav
      aria-label="Sections"
      className="flex h-full flex-col items-center gap-1 border-r border-hairline bg-subtle py-2"
    >
      <div className="flex flex-col gap-1">
        {NAV_SECTIONS.map((s) => (
          <IconButton
            key={s.id}
            icon={s.icon}
            label={s.label}
            variant="tertiary"
            aria-current={s.id === vm.activeId ? 'page' : undefined}
            data-active={s.id === vm.activeId ? 'true' : undefined}
            onClick={() => vm.setRoute(s.id)}
          />
        ))}
      </div>
      <div className="mt-auto">
        <IconButton icon={Settings} label="Settings" variant="tertiary" disabled />
      </div>
    </nav>
  );
}

export const navPanel: PanelDefinition<NavVm, ConsoleState> = {
  id: 'nav',
  displayName: 'Navigation',
  render: NavRail,
  selectVm: selectNavVm,
};
```

- [ ] **Step 4: Run the Cost test and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/CostPanel.test.tsx`
Expected: PASS (5 tests).

### Task 1.4: Registry + descriptor over the inspector layout

**Files:**
- Modify: `apps/desktop/src/renderer/panels/registry.ts`
- Modify: `apps/desktop/src/renderer/panels/registry.test.ts`

**Interfaces:**
- Consumes: `@coa/console-layout` (`createPanelRegistry`, `PanelRegistry`); `navPanel`, `costPanel`, `makePlaceholderPanel`, `makeDescriptor`, `DEFAULT_MAIN_PANEL_ID`.
- Produces: `buildPanelRegistry(): PanelRegistry`; `DEFAULT_DESCRIPTOR: LayoutDescriptor`.

- [ ] **Step 1: Replace** `apps/desktop/src/renderer/panels/registry.ts`

```ts
import { type LayoutDescriptor, type PanelRegistry, createPanelRegistry } from '@coa/console-layout';
import { costPanel } from './CostPanel.js';
import { navPanel } from './NavPanel.js';
import { makePlaceholderPanel } from './PlaceholderPanel.js';
import { makeDescriptor } from './routing.js';
import { DEFAULT_MAIN_PANEL_ID } from './state.js';

/** The 4b surfaces registered so far: the nav rail, the live Cost surface, and the
 *  right-dock placeholders (chat + agent). Flags/Timeline/Account/Settings register
 *  here as they land. */
export function buildPanelRegistry(): PanelRegistry {
  const registry = createPanelRegistry();
  registry.register(navPanel);
  registry.register(costPanel);
  registry.register(
    makePlaceholderPanel(
      'conversation',
      'Chat',
      'The live conversation stream arrives with a later build.',
    ),
  );
  registry.register(
    makePlaceholderPanel('agent', 'Agent', 'Agent configuration arrives with a later build.'),
  );
  return registry;
}

/** The inspector-first default: nav rail · Cost in the main region · chat+agent dock. */
export const DEFAULT_DESCRIPTOR: LayoutDescriptor = makeDescriptor(DEFAULT_MAIN_PANEL_ID);
```

- [ ] **Step 2: Replace** `apps/desktop/src/renderer/panels/registry.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseDescriptor } from '@coa/console-layout';
import { DEFAULT_DESCRIPTOR, buildPanelRegistry } from './registry.js';

describe('panel registry', () => {
  it('registers the nav rail, cost, and the dock placeholders', () => {
    const reg = buildPanelRegistry();
    for (const id of ['nav', 'cost', 'conversation', 'agent']) expect(reg.has(id)).toBe(true);
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

### Task 1.5: Console controller over ConsoleState + routing + epoch

**Files:**
- Modify: `apps/desktop/src/renderer/console.ts`
- Modify: `apps/desktop/src/renderer/console.test.tsx`

**Interfaces:**
- Consumes: `@coa/console-layout` (`createStaticEngine`, `parseDescriptor`, `LayoutHandle`); `@coa/console-viewmodel` (`CapState`); `buildPanelRegistry`, `DEFAULT_DESCRIPTOR`; `initialState`, `ConsoleState`; `setMainPanelId`, `LAYOUT_EPOCH`.
- Produces: `interface ConsoleBridge { capState; getLayout; saveLayout }`; `startConsole(container, bridge): Promise<ConsoleController>`; `ConsoleController { refresh(); dispose() }`.

- [ ] **Step 1: Replace** `apps/desktop/src/renderer/console.ts`

```ts
import { createStaticEngine, parseDescriptor, type LayoutHandle } from '@coa/console-layout';
import type { CapState } from '@coa/console-viewmodel';
import { buildPanelRegistry, DEFAULT_DESCRIPTOR } from './panels/registry.js';
import { LAYOUT_EPOCH, setMainPanelId } from './panels/routing.js';
import { initialState, type ConsoleState } from './panels/state.js';

/** The subset of `window.coa` the controller needs (injected for testing). */
export interface ConsoleBridge {
  capState(): Promise<CapState>;
  getLayout(): Promise<unknown>;
  saveLayout(descriptor: unknown): Promise<void>;
}

export interface ConsoleController {
  refresh(): Promise<void>;
  dispose(): void;
}

/** Persisted layout is wrapped with the arrangement epoch so a stale arrangement
 *  (e.g. a pre-inspector layout) is ignored rather than pinning the old shape. */
function readPersistedDescriptor(raw: unknown): unknown {
  if (raw !== null && typeof raw === 'object' && (raw as { epoch?: unknown }).epoch === LAYOUT_EPOCH) {
    return (raw as { descriptor?: unknown }).descriptor;
  }
  return undefined;
}

export async function startConsole(
  container: HTMLElement,
  bridge: ConsoleBridge,
): Promise<ConsoleController> {
  const registry = buildPanelRegistry();
  const descriptor = parseDescriptor(
    readPersistedDescriptor(await bridge.getLayout()),
    registry,
    DEFAULT_DESCRIPTOR,
  );

  const engine = createStaticEngine();
  let handle!: LayoutHandle;
  let state: ConsoleState;

  const push = (): void => handle.setDaemonState(state);
  const persist = (d: unknown): void => void bridge.saveLayout({ epoch: LAYOUT_EPOCH, descriptor: d });

  const setRoute = (panelId: string): void => {
    const next = setMainPanelId(handle.serialize(), panelId);
    handle.applyDescriptor(next); // sizes live in the descriptor, so they survive
    persist(next);
    state = { ...state, ui: { ...state.ui, activeMainPanelId: panelId } };
    push();
  };

  async function refresh(): Promise<void> {
    try {
      const value = await bridge.capState();
      state = { ...state, data: { ...state.data, cap: { status: 'ok', value } } };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      state = { ...state, data: { ...state.data, cap: { status: 'error', message } } };
    }
    push();
  }

  state = initialState({ setRoute, refresh: () => void refresh() });
  handle = engine.mount({
    container,
    descriptor,
    registry,
    daemonState: state,
    onChange: (d) => persist(d),
  });

  return { refresh, dispose: () => handle.dispose() };
}
```

- [ ] **Step 2: Replace** `apps/desktop/src/renderer/console.test.tsx`

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

async function mount(bridge = fakeBridge()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let controller!: Awaited<ReturnType<typeof startConsole>>;
  await act(async () => {
    controller = await startConsole(container, bridge);
  });
  return { container, controller };
}

describe('startConsole (inspector-first)', () => {
  it('mounts the inspector layout: nav rail, cost main, chat+agent dock', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-panel-id="nav"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="cost"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="conversation"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="agent"]')).not.toBeNull();
  });

  it('shows cost loading then live after refresh', async () => {
    const { container, controller } = await mount();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    await act(async () => {
      await controller.refresh();
    });
    expect(container.textContent).toContain('$2.50 left');
  });

  it('ignores a persisted layout from a different arrangement epoch', async () => {
    // A pre-inspector layout (no matching epoch) must fall back to the new default.
    const stale = { version: 1, root: { type: 'leaf', panelId: 'cost' } };
    const { container } = await mount(fakeBridge({ getLayout: vi.fn().mockResolvedValue(stale) }));
    expect(container.querySelector('[data-panel-id="conversation"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="nav"]')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/console.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 4: Run the full Part 1 gate sweep**

```
pnpm_config_verify_deps_before_run=false corepack pnpm typecheck
pnpm_config_verify_deps_before_run=false corepack pnpm lint
pnpm_config_verify_deps_before_run=false corepack pnpm format:write
pnpm_config_verify_deps_before_run=false corepack pnpm format
pnpm_config_verify_deps_before_run=false corepack pnpm test
pnpm_config_verify_deps_before_run=false corepack pnpm depcruise
pnpm_config_verify_deps_before_run=false corepack pnpm --filter @coa/desktop build
```
Expected: all PASS; depcruise 0 violations; `electron-vite build` green. (`App.tsx` is unchanged — it already delegates to `startConsole` + polls; the `PlaceholderPanel` still takes `unknown`/ignores state so it needs no change.)

- [ ] **Step 5: Commit Part 1** (stage by name; subject-only)

```bash
git add apps/desktop/src/renderer/panels/state.ts apps/desktop/src/renderer/panels/routing.ts \
  apps/desktop/src/renderer/panels/routing.test.ts apps/desktop/src/renderer/panels/NavPanel.tsx \
  apps/desktop/src/renderer/panels/CostPanel.tsx apps/desktop/src/renderer/panels/CostPanel.test.tsx \
  apps/desktop/src/renderer/panels/registry.ts apps/desktop/src/renderer/panels/registry.test.ts \
  apps/desktop/src/renderer/console.ts apps/desktop/src/renderer/console.test.tsx
git commit -m "feat: make the console nav rail drive an inspector main region"
```

> **Note on `PlaceholderPanel`:** it is typed `PanelDefinition<string, DaemonState>` in 4a. Rename that type reference to `ConsoleState` in `PlaceholderPanel.tsx` (import `ConsoleState` from `./state.js`) so it still compiles — include it in the Part 1 commit. If `state.ts` no longer exports `DaemonState`, this is required for typecheck to pass in Step 4.

---

# Part 2 — the read surfaces (Flags + Timeline)

Add the two read-only nav windows and their live wiring: edge schemas in `console-viewmodel`, IPC proxies in the registry + main, the panels, and polling.

### Task 2.1: Edge schemas in console-viewmodel

**Files:**
- Create: `packages/console-viewmodel/src/reads.ts`
- Modify: `packages/console-viewmodel/src/index.ts`
- Modify: `packages/console-viewmodel/package.json`
- Modify: `packages/console-viewmodel/tsconfig.json`

**Interfaces:**
- Consumes: `@coa/shared` (`feedViewSchema`, `FeedView`), `zod`.
- Produces: `FeedViewSchema`, `type FeedView`; `CheckpointSchema`, `type Checkpoint`; `TimelineSchema`.

- [ ] **Step 1: Add the dependency + reference.** In `packages/console-viewmodel/package.json`, add to `dependencies` (before `zod`):

```json
    "@coa/shared": "workspace:*",
```
In `packages/console-viewmodel/tsconfig.json`, add a `references` array (mirror another package's) if absent, or add the entry:

```json
  "references": [{ "path": "../shared" }],
```

- [ ] **Step 2: Write the failing test** `packages/console-viewmodel/src/reads.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { CheckpointSchema, FeedViewSchema, TimelineSchema } from './reads.js';

describe('console read schemas', () => {
  it('accepts a well-formed feed view', () => {
    const feed = { expanded: [], collapsed: [{ concernKey: 'k', count: 3, severity: 'med' }] };
    expect(FeedViewSchema.parse(feed)).toEqual(feed);
  });

  it('accepts a checkpoint list and strips unknown fields', () => {
    const cp = { id: 'c1', seq: 12, ts: '2026-07-01T00:00:00Z', worktree: 'wt', pinned: false };
    expect(TimelineSchema.parse([cp])).toEqual([cp]);
    expect(CheckpointSchema.parse({ ...cp, extra: 1 })).toEqual(cp);
  });
});
```

- [ ] **Step 3: Install (registers the new dep) and confirm the test fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm install`
Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-viewmodel/src/reads.test.ts`
Expected: FAIL (cannot resolve `./reads.js`).

- [ ] **Step 4: Implement** `packages/console-viewmodel/src/reads.ts`

```ts
import { feedViewSchema, type FeedView } from '@coa/shared';
import { z } from 'zod';

/** The CF-1 user feed (M3) — re-exported from the M0 wire type so the console
 *  validates the real shape. */
export const FeedViewSchema = feedViewSchema;
export type { FeedView };

/** A timeline checkpoint (M1). Mirrors the core shape; the renderer cannot import
 *  `@coa/core`, so the edge schema lives here (pure). Unknown fields are stripped. */
export const CheckpointSchema = z.object({
  id: z.string(),
  seq: z.number(),
  ts: z.string(),
  worktree: z.string(),
  pinned: z.boolean(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const TimelineSchema = z.array(CheckpointSchema);
```

- [ ] **Step 5: Export it.** In `packages/console-viewmodel/src/index.ts`, add:

```ts
export * from './reads.js';
```

- [ ] **Step 6: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-viewmodel/src/reads.test.ts`
Expected: PASS (2 tests).

### Task 2.2: Register the read verbs + main wiring

**Files:**
- Modify: `apps/desktop/src/shared/methods.ts`
- Modify: `apps/desktop/src/shared/methods.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/api.d.ts`
- Modify: `apps/desktop/electron.vite.config.ts`

**Interfaces:**
- Consumes: `@coa/console-viewmodel` (`FeedViewSchema`, `TimelineSchema`).
- Produces: `METHODS` gains `flagsForUser`, `listTimeline`; `runMethod` serves them; `window.coa` gains the two methods.

- [ ] **Step 1: Extend the registry.** In `apps/desktop/src/shared/methods.ts`, update the imports + `MethodName` + `METHODS`:

```ts
import { CapStateSchema, FeedViewSchema, TimelineSchema } from '@coa/console-viewmodel';
import { z } from 'zod';
```
```ts
export type MethodName =
  | 'capState'
  | 'flagsForUser'
  | 'listTimeline'
  | 'getLayout'
  | 'saveLayout';

export const METHODS: Record<MethodName, MethodSpec> = {
  capState: { result: CapStateSchema },
  flagsForUser: { result: FeedViewSchema },
  listTimeline: { result: TimelineSchema },
  getLayout: { result: z.unknown() },
  saveLayout: { params: z.unknown(), result: z.void() },
};
```

- [ ] **Step 2: Extend the registry test.** In `apps/desktop/src/shared/methods.test.ts`, add:

```ts
  it('validates the flags and timeline results', () => {
    expect(METHODS.flagsForUser.result.parse({ expanded: [], collapsed: [] })).toBeTruthy();
    expect(METHODS.listTimeline.result.parse([])).toBeTruthy();
    expect(() => METHODS.listTimeline.result.parse({})).toThrow();
  });
```

- [ ] **Step 3: Serve them in main.** In `apps/desktop/src/main/index.ts`, add cases to the `runMethod` switch (both proxy the daemon like `capState`):

```ts
    case 'flagsForUser': {
      const res = await (await ensureClient()).request('flagsForUser');
      if ('error' in res && res.error) throw new DaemonError(res.error.message, res.error.code);
      return res.result;
    }
    case 'listTimeline': {
      const res = await (await ensureClient()).request('listTimeline');
      if ('error' in res && res.error) throw new DaemonError(res.error.message, res.error.code);
      return res.result;
    }
```

- [ ] **Step 4: Extend the window typing.** In `apps/desktop/src/preload/api.d.ts`, add imports + methods:

```ts
import type { CapState, FeedView, Checkpoint } from '@coa/console-viewmodel';
```
and inside `coa: { … }`:

```ts
      flagsForUser(): Promise<FeedView>;
      listTimeline(): Promise<Checkpoint[]>;
```

- [ ] **Step 5: Alias `@coa/shared` for the renderer build.** In `apps/desktop/electron.vite.config.ts`, add to the renderer `resolve.alias` (so `console-viewmodel`→`@coa/shared` resolves from source):

```ts
        '@coa/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
```

- [ ] **Step 6: Run the registry test**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/shared/methods.test.ts`
Expected: PASS (4 tests).

### Task 2.3: Flags panel

**Files:**
- Create: `apps/desktop/src/renderer/panels/FlagsPanel.tsx`
- Test: `apps/desktop/src/renderer/panels/FlagsPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/panels/state.ts` (extend `ConsoleData`)

**Interfaces:**
- Consumes: `@coa/console-viewmodel` (`FeedView`); `@coa/console-ui` (`Pane`, `List`, `Badge`, `Skeleton`, `InlineMessage`, `EmptyState`); `ConsoleState`.
- Produces: `flagsPanel: PanelDefinition<FlagsVm, ConsoleState>`, `selectFlagsVm`.

- [ ] **Step 1: Extend `ConsoleData`.** In `apps/desktop/src/renderer/panels/state.ts`, add the import and field:

```ts
import type { CapState, FeedView } from '@coa/console-viewmodel';
```
```ts
export interface ConsoleData {
  cap: Remote<CapState>;
  flags: Remote<FeedView>;
}
```
and in `initialState`, seed it:

```ts
    data: { cap: { status: 'loading' }, flags: { status: 'loading' } },
```

- [ ] **Step 2: Write the failing test** `apps/desktop/src/renderer/panels/FlagsPanel.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { flagsPanel, selectFlagsVm } from './FlagsPanel.js';
import type { ConsoleState } from './state.js';

const FlagsView = flagsPanel.render;
const host = { title: 'Flags', setTitle: () => {}, onVisibilityChange: () => () => {}, requestFocus: () => {} };

const stateWith = (flags: ConsoleState['data']['flags']): ConsoleState => ({
  data: { cap: { status: 'loading' }, flags },
  ui: { activeMainPanelId: 'flags' },
  actions: { setRoute: () => {}, refresh: () => {} },
});

describe('selectFlagsVm', () => {
  it('passes loading/error through', () => {
    expect(selectFlagsVm(stateWith({ status: 'loading' }))).toEqual({ status: 'loading' });
  });
});

describe('FlagsView states-first', () => {
  it('skeletons while loading', () => {
    const { container } = render(<FlagsView vm={{ status: 'loading' }} host={host} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('empty state when there are no flags', () => {
    render(<FlagsView vm={{ status: 'ok', value: { expanded: [], collapsed: [] } }} host={host} />);
    expect(screen.getByText(/no flags/i)).toBeTruthy();
  });

  it('renders an expanded flag with its severity and message, plus a collapsed count', () => {
    const value = {
      expanded: [
        {
          ruleId: 'ssot',
          location: 'pay.ts:10',
          severity: 'crit' as const,
          message: 'generated stale',
          fingerprint: 'f1',
          type: 1 as const,
          confidence: 'high' as const,
          concernKey: 'k1',
        },
      ],
      collapsed: [{ concernKey: 'k2', count: 4, severity: 'low' }],
    };
    render(<FlagsView vm={{ status: 'ok', value }} host={host} />);
    expect(screen.getByText('generated stale')).toBeTruthy();
    expect(screen.getByText('pay.ts:10')).toBeTruthy();
    expect(screen.getByText(/4 more/i)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Implement** `apps/desktop/src/renderer/panels/FlagsPanel.tsx`

```tsx
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { Badge, EmptyState, InlineMessage, List, Pane, Skeleton } from '@coa/console-ui';
import type { BadgeTone } from '@coa/console-ui';
import type { FeedView } from '@coa/console-viewmodel';
import type { ConsoleState } from './state.js';

export type FlagsVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: FeedView };

export function selectFlagsVm(state: ConsoleState): FlagsVm {
  return state.data.flags;
}

const SEVERITY_TONE: Record<string, BadgeTone> = {
  crit: 'danger',
  high: 'warning',
  med: 'neutral',
  low: 'neutral',
};

function CollapsedLine({ count, severity }: { count: number; severity: string }): React.JSX.Element {
  return (
    <div className="px-2 py-1 text-[12px] text-muted">
      {count} more {severity}
    </div>
  );
}

function FlagsView({ vm }: { vm: FlagsVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <Pane title="Flags" scroll>
      {vm.status === 'loading' && (
        <div className="flex flex-col gap-2">
          <Skeleton className="w-3/4" />
          <Skeleton className="w-1/2" />
        </div>
      )}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {vm.status === 'ok' && vm.value.expanded.length === 0 && vm.value.collapsed.length === 0 && (
        <EmptyState title="No flags" description="The governor has raised nothing to review." />
      )}
      {vm.status === 'ok' && (vm.value.expanded.length > 0 || vm.value.collapsed.length > 0) && (
        <div className="flex flex-col gap-1">
          <List
            label="Flags"
            items={vm.value.expanded}
            getKey={(f) => f.fingerprint}
            renderItem={(f) => (
              <div className="flex items-center gap-2">
                <Badge tone={SEVERITY_TONE[f.severity] ?? 'neutral'}>{f.severity}</Badge>
                <span className="min-w-0 flex-1 truncate">{f.message}</span>
                <span className="text-[11px] text-faint">{f.location}</span>
              </div>
            )}
          />
          {vm.value.collapsed.map((c) => (
            <CollapsedLine key={c.concernKey} count={c.count} severity={c.severity} />
          ))}
        </div>
      )}
    </Pane>
  );
}

export const flagsPanel: PanelDefinition<FlagsVm, ConsoleState> = {
  id: 'flags',
  displayName: 'Flags',
  render: FlagsView,
  selectVm: selectFlagsVm,
};
```

> Confirm `EmptyState`'s prop names against `packages/console-ui/src/feedback/EmptyState.tsx` before running; if it takes `children`/different prop names, adjust the one call site. (It is exported from `@coa/console-ui`.)

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/FlagsPanel.test.tsx`
Expected: PASS (4 tests).

### Task 2.4: Timeline panel

**Files:**
- Create: `apps/desktop/src/renderer/panels/TimelinePanel.tsx`
- Test: `apps/desktop/src/renderer/panels/TimelinePanel.test.tsx`
- Modify: `apps/desktop/src/renderer/panels/state.ts` (extend `ConsoleData`)

**Interfaces:**
- Consumes: `@coa/console-viewmodel` (`Checkpoint`); `@coa/console-ui` (`Pane`, `List`, `Badge`, `Skeleton`, `InlineMessage`, `EmptyState`); `ConsoleState`.
- Produces: `timelinePanel: PanelDefinition<TimelineVm, ConsoleState>`, `selectTimelineVm`.

- [ ] **Step 1: Extend `ConsoleData`.** In `apps/desktop/src/renderer/panels/state.ts`:

```ts
import type { CapState, Checkpoint, FeedView } from '@coa/console-viewmodel';
```
```ts
export interface ConsoleData {
  cap: Remote<CapState>;
  flags: Remote<FeedView>;
  timeline: Remote<Checkpoint[]>;
}
```
and in `initialState`:

```ts
    data: {
      cap: { status: 'loading' },
      flags: { status: 'loading' },
      timeline: { status: 'loading' },
    },
```

- [ ] **Step 2: Write the failing test** `apps/desktop/src/renderer/panels/TimelinePanel.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { timelinePanel } from './TimelinePanel.js';

const TimelineView = timelinePanel.render;
const host = { title: 'Timeline', setTitle: () => {}, onVisibilityChange: () => () => {}, requestFocus: () => {} };

describe('TimelineView states-first', () => {
  it('skeletons while loading', () => {
    const { container } = render(<TimelineView vm={{ status: 'loading' }} host={host} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('empty state with no checkpoints', () => {
    render(<TimelineView vm={{ status: 'ok', value: [] }} host={host} />);
    expect(screen.getByText(/no checkpoints/i)).toBeTruthy();
  });

  it('renders checkpoints newest-first with a pinned marker', () => {
    const value = [
      { id: 'c1', seq: 1, ts: '2026-07-01T00:00:00Z', worktree: 'wt', pinned: false },
      { id: 'c2', seq: 2, ts: '2026-07-01T01:00:00Z', worktree: 'wt', pinned: true },
    ];
    render(<TimelineView vm={{ status: 'ok', value }} host={host} />);
    expect(screen.getByText(/pinned/i)).toBeTruthy();
    expect(screen.getAllByText(/seq/i).length).toBe(2);
  });
});
```

- [ ] **Step 3: Implement** `apps/desktop/src/renderer/panels/TimelinePanel.tsx`

```tsx
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { Badge, EmptyState, InlineMessage, List, Pane, Skeleton } from '@coa/console-ui';
import type { Checkpoint } from '@coa/console-viewmodel';
import type { ConsoleState } from './state.js';

export type TimelineVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: Checkpoint[] };

export function selectTimelineVm(state: ConsoleState): TimelineVm {
  return state.data.timeline;
}

function TimelineView({ vm }: { vm: TimelineVm; host: PanelHostApi }): React.JSX.Element {
  const newestFirst = vm.status === 'ok' ? [...vm.value].reverse() : [];
  return (
    <Pane title="Timeline" scroll>
      {vm.status === 'loading' && (
        <div className="flex flex-col gap-2">
          <Skeleton className="w-2/3" />
          <Skeleton className="w-1/2" />
        </div>
      )}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {vm.status === 'ok' && vm.value.length === 0 && (
        <EmptyState title="No checkpoints" description="Checkpoints appear as the session progresses." />
      )}
      {vm.status === 'ok' && vm.value.length > 0 && (
        <List
          label="Checkpoints"
          items={newestFirst}
          getKey={(c) => c.id}
          renderItem={(c) => (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted">seq {c.seq}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{c.ts}</span>
              {c.pinned && <Badge tone="info">pinned</Badge>}
            </div>
          )}
        />
      )}
    </Pane>
  );
}

export const timelinePanel: PanelDefinition<TimelineVm, ConsoleState> = {
  id: 'timeline',
  displayName: 'Timeline',
  render: TimelineView,
  selectVm: selectTimelineVm,
};
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/TimelinePanel.test.tsx`
Expected: PASS (3 tests).

### Task 2.5: Register + poll Flags and Timeline

**Files:**
- Modify: `apps/desktop/src/renderer/panels/registry.ts`
- Modify: `apps/desktop/src/renderer/panels/NavPanel.tsx`
- Modify: `apps/desktop/src/renderer/console.ts`
- Modify: `apps/desktop/src/renderer/console.test.tsx`

**Interfaces:**
- Consumes: `flagsPanel`, `timelinePanel`; the bridge gains `flagsForUser`, `listTimeline`.
- Produces: nav sections + polling for flags/timeline.

- [ ] **Step 1: Register the panels.** In `apps/desktop/src/renderer/panels/registry.ts`, import and register (after `costPanel`):

```ts
import { flagsPanel } from './FlagsPanel.js';
import { timelinePanel } from './TimelinePanel.js';
```
```ts
  registry.register(flagsPanel);
  registry.register(timelinePanel);
```

- [ ] **Step 2: Add nav sections.** In `apps/desktop/src/renderer/panels/NavPanel.tsx`, extend the icon imports + `NAV_SECTIONS`:

```ts
import { Flag, History, Settings, Wallet } from 'lucide-react';
```
```ts
export const NAV_SECTIONS: readonly NavSection[] = [
  { id: 'cost', label: 'Cost', icon: Wallet },
  { id: 'flags', label: 'Flags', icon: Flag },
  { id: 'timeline', label: 'Timeline', icon: History },
];
```

- [ ] **Step 3: Poll the reads.** In `apps/desktop/src/renderer/console.ts`, extend `ConsoleBridge` and `refresh`:

```ts
import type { CapState, Checkpoint, FeedView } from '@coa/console-viewmodel';
```
```ts
export interface ConsoleBridge {
  capState(): Promise<CapState>;
  flagsForUser(): Promise<FeedView>;
  listTimeline(): Promise<Checkpoint[]>;
  getLayout(): Promise<unknown>;
  saveLayout(descriptor: unknown): Promise<void>;
}
```
Replace `refresh` with a version that fetches all three in parallel, each into its own `Remote`:

```ts
  async function refresh(): Promise<void> {
    const [cap, flags, timeline] = await Promise.all([
      settle(() => bridge.capState()),
      settle(() => bridge.flagsForUser()),
      settle(() => bridge.listTimeline()),
    ]);
    state = { ...state, data: { ...state.data, cap, flags, timeline } };
    push();
  }
```
and add a `settle` helper above `startConsole`:

```ts
async function settle<T>(read: () => Promise<T>): Promise<import('./panels/state.js').Remote<T>> {
  try {
    return { status: 'ok', value: await read() };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Update the console test bridge.** In `apps/desktop/src/renderer/console.test.tsx`, extend `fakeBridge`:

```tsx
    flagsForUser: vi.fn().mockResolvedValue({ expanded: [], collapsed: [] }),
    listTimeline: vi.fn().mockResolvedValue([]),
```
(add these two lines inside the returned object, before `...over`.)

- [ ] **Step 5: Run the affected tests**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/console.test.tsx apps/desktop/src/renderer/panels/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Full Part 2 gate sweep**

```
pnpm_config_verify_deps_before_run=false corepack pnpm typecheck
pnpm_config_verify_deps_before_run=false corepack pnpm lint
pnpm_config_verify_deps_before_run=false corepack pnpm format:write
pnpm_config_verify_deps_before_run=false corepack pnpm format
pnpm_config_verify_deps_before_run=false corepack pnpm test
pnpm_config_verify_deps_before_run=false corepack pnpm depcruise
pnpm_config_verify_deps_before_run=false corepack pnpm --filter @coa/desktop build
```
Expected: all PASS; depcruise 0 violations (console-viewmodel→@coa/shared is legal; renderer imports no core/electron); build green.

- [ ] **Step 7: Commit Part 2** (stage by name; subject-only)

```bash
git add packages/console-viewmodel/src/reads.ts packages/console-viewmodel/src/reads.test.ts \
  packages/console-viewmodel/src/index.ts packages/console-viewmodel/package.json \
  packages/console-viewmodel/tsconfig.json pnpm-lock.yaml \
  apps/desktop/src/shared/methods.ts apps/desktop/src/shared/methods.test.ts \
  apps/desktop/src/main/index.ts apps/desktop/src/preload/api.d.ts apps/desktop/electron.vite.config.ts \
  apps/desktop/src/renderer/panels/state.ts apps/desktop/src/renderer/panels/FlagsPanel.tsx \
  apps/desktop/src/renderer/panels/FlagsPanel.test.tsx apps/desktop/src/renderer/panels/TimelinePanel.tsx \
  apps/desktop/src/renderer/panels/TimelinePanel.test.tsx apps/desktop/src/renderer/panels/registry.ts \
  apps/desktop/src/renderer/panels/NavPanel.tsx apps/desktop/src/renderer/console.ts \
  apps/desktop/src/renderer/console.test.tsx
git commit -m "feat: add the flags and timeline inspector surfaces"
```

---

# Part 3 — the interactive surfaces (Account + Settings)

Add the right-dock account selector (auth verbs) and a dedicated, extensible settings store (theme/density/motion) persisted per-user by the main process.

### Task 3.1: Account edge schemas + verbs

**Files:**
- Modify: `packages/console-viewmodel/src/reads.ts`
- Modify: `apps/desktop/src/shared/methods.ts`
- Modify: `apps/desktop/src/shared/methods.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/api.d.ts`

**Interfaces:**
- Produces: `AccountSummarySchema`/`AccountsSchema`/`ActiveAccountSchema` + types; `METHODS` gains `listAccounts`/`currentAccount`/`useAccount`; `window.coa` gains them.

- [ ] **Step 1: Add account schemas.** Append to `packages/console-viewmodel/src/reads.ts`:

```ts
/** An account pointer as the console needs it (label only; the daemon's provider/
 *  locator are stripped). */
export const AccountSummarySchema = z.object({ label: z.string() });
export type AccountSummary = z.infer<typeof AccountSummarySchema>;

export const AccountsSchema = z.object({ accounts: z.array(AccountSummarySchema) });
export type Accounts = z.infer<typeof AccountsSchema>;

export const ActiveAccountSchema = z.object({ active: z.string() });
export type ActiveAccount = z.infer<typeof ActiveAccountSchema>;
```

- [ ] **Step 2: Register the verbs.** In `apps/desktop/src/shared/methods.ts`:

```ts
import {
  AccountsSchema,
  ActiveAccountSchema,
  CapStateSchema,
  FeedViewSchema,
  TimelineSchema,
} from '@coa/console-viewmodel';
```
Extend `MethodName` with `'listAccounts' | 'currentAccount' | 'useAccount'` and add to `METHODS`:

```ts
  listAccounts: { result: AccountsSchema },
  currentAccount: { result: ActiveAccountSchema },
  useAccount: { params: z.object({ label: z.string() }), result: ActiveAccountSchema },
```

- [ ] **Step 3: Test the new results.** In `apps/desktop/src/shared/methods.test.ts`, add:

```ts
  it('validates the account verbs', () => {
    expect(METHODS.listAccounts.result.parse({ accounts: [{ label: 'a' }] })).toBeTruthy();
    expect(METHODS.currentAccount.result.parse({ active: 'a' })).toBeTruthy();
    expect(() => METHODS.useAccount.params?.parse({})).toThrow();
  });
```

- [ ] **Step 4: Serve them in main.** In `apps/desktop/src/main/index.ts` `runMethod`, add three daemon-proxy cases (mirror `flagsForUser`, passing params for `useAccount`):

```ts
    case 'listAccounts': {
      const res = await (await ensureClient()).request('listAccounts');
      if ('error' in res && res.error) throw new DaemonError(res.error.message, res.error.code);
      return res.result;
    }
    case 'currentAccount': {
      const res = await (await ensureClient()).request('currentAccount');
      if ('error' in res && res.error) throw new DaemonError(res.error.message, res.error.code);
      return res.result;
    }
    case 'useAccount': {
      const res = await (await ensureClient()).request('useAccount', params);
      if ('error' in res && res.error) throw new DaemonError(res.error.message, res.error.code);
      return res.result;
    }
```

- [ ] **Step 5: Extend the window typing.** In `apps/desktop/src/preload/api.d.ts`:

```ts
import type { Accounts, ActiveAccount, CapState, Checkpoint, FeedView } from '@coa/console-viewmodel';
```
```ts
      listAccounts(): Promise<Accounts>;
      currentAccount(): Promise<ActiveAccount>;
      useAccount(params: { label: string }): Promise<ActiveAccount>;
```

- [ ] **Step 6: Run the registry test**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/shared/methods.test.ts`
Expected: PASS.

### Task 3.2: Account panel + wiring

**Files:**
- Create: `apps/desktop/src/renderer/panels/AccountPanel.tsx`
- Test: `apps/desktop/src/renderer/panels/AccountPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/panels/state.ts`, `console.ts`, `console.test.tsx`, `registry.ts`, `routing.ts`

**Interfaces:**
- Consumes: `@coa/console-ui` (`Pane`, `Select`, `Skeleton`, `InlineMessage`); `ConsoleState`.
- Produces: `accountPanel`, `selectAccountVm`; `ConsoleData.accounts`; `ConsoleActions.switchAccount`; the dock gains an `account` leaf.

- [ ] **Step 1: Extend state.** In `apps/desktop/src/renderer/panels/state.ts`, add a composed accounts shape + the action:

```ts
export interface AccountsInfo {
  accounts: { label: string }[];
  active: string;
}
```
Add `accounts: Remote<AccountsInfo>;` to `ConsoleData`, `switchAccount: (label: string) => void;` to `ConsoleActions`, seed `accounts: { status: 'loading' }` in `initialState`.

- [ ] **Step 2: Write the failing test** `apps/desktop/src/renderer/panels/AccountPanel.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { accountPanel, selectAccountVm } from './AccountPanel.js';
import type { ConsoleState } from './state.js';

const AccountView = accountPanel.render;
const host = { title: 'Account', setTitle: () => {}, onVisibilityChange: () => () => {}, requestFocus: () => {} };

const stateWith = (
  accounts: ConsoleState['data']['accounts'],
  switchAccount = vi.fn(),
): ConsoleState =>
  ({
    data: {
      cap: { status: 'loading' },
      flags: { status: 'loading' },
      timeline: { status: 'loading' },
      accounts,
    },
    ui: { activeMainPanelId: 'cost' },
    actions: { setRoute: () => {}, refresh: () => {}, switchAccount, setSettings: () => {} },
  }) as ConsoleState;

describe('AccountView', () => {
  it('skeletons while loading', () => {
    const { container } = render(
      <AccountView vm={selectAccountVm(stateWith({ status: 'loading' }))} host={host} />,
    );
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows the active account and the choices', () => {
    const vm = selectAccountVm(
      stateWith({ status: 'ok', value: { accounts: [{ label: 'acct-1' }, { label: 'acct-2' }], active: 'acct-1' } }),
    );
    render(<AccountView vm={vm} host={host} />);
    expect(screen.getByText('acct-1')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Implement** `apps/desktop/src/renderer/panels/AccountPanel.tsx`

```tsx
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { InlineMessage, Pane, Select, Skeleton } from '@coa/console-ui';
import type { AccountsInfo, ConsoleState } from './state.js';

export type AccountVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: AccountsInfo; switchAccount: (label: string) => void };

export function selectAccountVm(state: ConsoleState): AccountVm {
  const r = state.data.accounts;
  if (r.status === 'ok') {
    return { status: 'ok', value: r.value, switchAccount: state.actions.switchAccount };
  }
  return r;
}

function AccountView({ vm }: { vm: AccountVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <Pane title="Account">
      {vm.status === 'loading' && <Skeleton className="w-32" />}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {vm.status === 'ok' && vm.value.accounts.length === 0 && (
        <div className="text-[12px] text-muted">Ambient login (no accounts configured).</div>
      )}
      {vm.status === 'ok' && vm.value.accounts.length > 0 && (
        <Select
          label="Active account"
          value={vm.value.active}
          onValueChange={vm.switchAccount}
          options={vm.value.accounts.map((a) => ({ value: a.label, label: a.label }))}
        />
      )}
    </Pane>
  );
}

export const accountPanel: PanelDefinition<AccountVm, ConsoleState> = {
  id: 'account',
  displayName: 'Account',
  render: AccountView,
  selectVm: selectAccountVm,
};
```

- [ ] **Step 4: Register + dock.** In `registry.ts` import and register `accountPanel`. In `routing.ts` `makeDescriptor`, add a third dock leaf so the account selector shows in the right dock:

```ts
              children: [
                { type: 'leaf', panelId: 'conversation' },
                { type: 'leaf', panelId: 'agent' },
                { type: 'leaf', panelId: 'account' },
              ],
```

- [ ] **Step 5: Fetch accounts.** In `console.ts`, extend `ConsoleBridge` with `listAccounts`/`currentAccount`/`useAccount`; add an accounts fetch + `switchAccount` action:

```ts
  async function loadAccounts(): Promise<void> {
    try {
      const [list, current] = await Promise.all([bridge.listAccounts(), bridge.currentAccount()]);
      state = {
        ...state,
        data: {
          ...state.data,
          accounts: { status: 'ok', value: { accounts: list.accounts, active: current.active } },
        },
      };
    } catch (e) {
      state = {
        ...state,
        data: {
          ...state.data,
          accounts: { status: 'error', message: e instanceof Error ? e.message : String(e) },
        },
      };
    }
    push();
  }

  const switchAccount = (label: string): void => {
    void (async () => {
      await bridge.useAccount({ label });
      await loadAccounts();
    })();
  };
```
Wire `switchAccount` into the `initialState({ … })` actions, and call `void loadAccounts();` once after mount (before returning the controller).

- [ ] **Step 6: Update the console test bridge** — add `listAccounts`/`currentAccount`/`useAccount` mocks to `fakeBridge`:

```tsx
    listAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
    currentAccount: vi.fn().mockResolvedValue({ active: 'ambient' }),
    useAccount: vi.fn().mockResolvedValue({ active: 'ambient' }),
```

- [ ] **Step 7: Run the account + console tests**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/AccountPanel.test.tsx apps/desktop/src/renderer/console.test.tsx`
Expected: PASS.

### Task 3.3: Console settings store

**Files:**
- Create: `apps/desktop/src/shared/settings.ts`
- Test: `apps/desktop/src/shared/settings.test.ts`
- Modify: `apps/desktop/src/main/persistence.ts` (+ test), `apps/desktop/src/main/index.ts`, `apps/desktop/src/shared/methods.ts` (+ test), `apps/desktop/src/preload/api.d.ts`

**Interfaces:**
- Produces: `ConsoleSettingsSchema`/`ConsoleSettings`/`DEFAULT_SETTINGS`/`parseSettings`; generic `readJson`/`writeJson`; `METHODS` gains `getSettings`/`saveSettings`; `window.coa` gains them.

- [ ] **Step 1: Write the failing settings test** `apps/desktop/src/shared/settings.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings.js';

describe('console settings', () => {
  it('fills missing fields from defaults (merge-on-read)', () => {
    expect(parseSettings({ theme: 'light' })).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' });
  });
  it('falls back to defaults on garbage', () => {
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: Implement** `apps/desktop/src/shared/settings.ts`

```ts
import { z } from 'zod';

/** The console's persisted UI preferences. New toggles just add a defaulted field. */
export const ConsoleSettingsSchema = z.object({
  theme: z.enum(['dark', 'light']).default('dark'),
  density: z.enum(['comfortable', 'compact']).default('compact'),
  motion: z.enum(['full', 'reduce']).default('full'),
});
export type ConsoleSettings = z.infer<typeof ConsoleSettingsSchema>;

export const DEFAULT_SETTINGS: ConsoleSettings = { theme: 'dark', density: 'compact', motion: 'full' };

/** Parse persisted settings, filling any missing field from defaults; any invalid
 *  blob (or `undefined`) yields the full defaults. Never throws. */
export function parseSettings(raw: unknown): ConsoleSettings {
  const parsed = ConsoleSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
```

- [ ] **Step 3: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/shared/settings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Generalize persistence.** Rename in `apps/desktop/src/main/persistence.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Read opaque JSON; `undefined` on a missing/corrupt file (callers validate). */
export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Write a value as JSON, creating its parent directory. */
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), 'utf8');
}
```
Update `apps/desktop/src/main/persistence.test.ts` to import `readJson`/`writeJson` and rename the call sites (the three tests are otherwise unchanged — replace `writeLayout`→`writeJson`, `readLayout`→`readJson`).

- [ ] **Step 5: Register + serve settings.** In `apps/desktop/src/shared/methods.ts`, import the settings schema and add methods:

```ts
import { ConsoleSettingsSchema } from './settings.js';
```
Extend `MethodName` with `'getSettings' | 'saveSettings'` and `METHODS`:

```ts
  getSettings: { result: ConsoleSettingsSchema },
  saveSettings: { params: ConsoleSettingsSchema, result: z.void() },
```
In `apps/desktop/src/main/index.ts`: update the layout cases to `readJson`/`writeJson`, add a `settingsFile()` alongside `layoutFile()`, and add cases:

```ts
function settingsFile(): string {
  return join(app.getPath('userData'), 'coa', 'settings.json');
}
```
```ts
    case 'getLayout':
      return readJson(layoutFile());
    case 'saveLayout':
      writeJson(layoutFile(), params);
      return undefined;
    case 'getSettings':
      return parseSettings(readJson(settingsFile()));
    case 'saveSettings':
      writeJson(settingsFile(), params);
      return undefined;
```
(add `import { parseSettings } from '../shared/settings.js';` and switch the persistence import to `readJson, writeJson`).

- [ ] **Step 6: Extend the window typing.** In `apps/desktop/src/preload/api.d.ts`:

```ts
import type { ConsoleSettings } from '../shared/settings.js';
```
```ts
      getSettings(): Promise<ConsoleSettings>;
      saveSettings(settings: ConsoleSettings): Promise<void>;
```

- [ ] **Step 7: Run the methods + persistence tests**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/shared/methods.test.ts apps/desktop/src/main/persistence.test.ts`
Expected: PASS.

### Task 3.4: Apply settings + the Settings panel

**Files:**
- Create: `apps/desktop/src/renderer/theme.ts` (+ test)
- Create: `apps/desktop/src/renderer/panels/SettingsPanel.tsx` (+ test)
- Modify: `apps/desktop/src/renderer/main.tsx`, `globals.css`, `panels/state.ts`, `console.ts`, `console.test.tsx`, `panels/registry.ts`, `panels/NavPanel.tsx`

**Interfaces:**
- Consumes: `@coa/console-ui` (`tokensToCss`, `Pane`, `Select`, `Switch`); `ConsoleSettings`; `ConsoleState`.
- Produces: `applySettings(settings)`; `settingsPanel`; `ConsoleUi.settings`; `ConsoleActions.setSettings`; the gear routes to Settings.

- [ ] **Step 1: Write the failing theme test** `apps/desktop/src/renderer/theme.test.ts`

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applySettings } from './theme.js';

afterEach(() => {
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-motion');
});

describe('applySettings', () => {
  it('injects token CSS and sets color-scheme', () => {
    applySettings({ theme: 'dark', density: 'compact', motion: 'full' });
    const style = document.getElementById('coa-tokens');
    expect(style?.textContent).toContain('--color-accent');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('marks reduced motion when requested', () => {
    applySettings({ theme: 'dark', density: 'compact', motion: 'reduce' });
    expect(document.documentElement.dataset.motion).toBe('reduce');
  });
});
```

- [ ] **Step 2: Implement** `apps/desktop/src/renderer/theme.ts`

```ts
import { tokensToCss } from '@coa/console-ui';
import type { ConsoleSettings } from '../shared/settings.js';

/** Apply the console settings to the document: re-resolve token CSS for the theme/
 *  density into the shared <style>, set the OS color-scheme, and flag reduced motion
 *  (globals.css neutralizes animations under [data-motion='reduce']). */
export function applySettings(settings: ConsoleSettings): void {
  let style = document.getElementById('coa-tokens');
  if (!style) {
    style = document.createElement('style');
    style.id = 'coa-tokens';
    document.head.appendChild(style);
  }
  style.textContent = tokensToCss(settings.theme, settings.density);
  document.documentElement.style.colorScheme = settings.theme;
  if (settings.motion === 'reduce') document.documentElement.dataset.motion = 'reduce';
  else document.documentElement.removeAttribute('data-motion');
}
```

- [ ] **Step 3: Id the boot `<style>` + reduced-motion CSS.** In `apps/desktop/src/renderer/main.tsx`, give the injected style an id so `applySettings` reuses it:

```ts
const style = document.createElement('style');
style.id = 'coa-tokens';
style.textContent = tokensToCss('dark', 'compact');
document.head.appendChild(style);
```
In `apps/desktop/src/renderer/globals.css`, append:

```css
[data-motion='reduce'] *,
[data-motion='reduce'] *::before,
[data-motion='reduce'] *::after {
  animation-duration: 0.01ms !important;
  transition-duration: 0.01ms !important;
}
```

- [ ] **Step 4: Run the theme test**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/theme.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Extend state.** In `apps/desktop/src/renderer/panels/state.ts`: add `settings: ConsoleSettings` to `ConsoleUi`, `setSettings: (patch: Partial<ConsoleSettings>) => void` to `ConsoleActions`, import `ConsoleSettings` + `DEFAULT_SETTINGS` from `../../shared/settings.js`, and seed `ui: { activeMainPanelId: DEFAULT_MAIN_PANEL_ID, settings: DEFAULT_SETTINGS }`.

- [ ] **Step 6: Write the failing settings-panel test** `apps/desktop/src/renderer/panels/SettingsPanel.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { settingsPanel, selectSettingsVm } from './SettingsPanel.js';
import type { ConsoleState } from './state.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';

const SettingsView = settingsPanel.render;
const host = { title: 'Settings', setTitle: () => {}, onVisibilityChange: () => () => {}, requestFocus: () => {} };

const state = (setSettings = vi.fn()): ConsoleState =>
  ({
    data: {
      cap: { status: 'loading' },
      flags: { status: 'loading' },
      timeline: { status: 'loading' },
      accounts: { status: 'loading' },
    },
    ui: { activeMainPanelId: 'settings', settings: DEFAULT_SETTINGS },
    actions: { setRoute: () => {}, refresh: () => {}, switchAccount: () => {}, setSettings },
  }) as ConsoleState;

describe('SettingsView', () => {
  it('renders the theme, density, and motion controls', () => {
    render(<SettingsView vm={selectSettingsVm(state())} host={host} />);
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Density')).toBeTruthy();
    expect(screen.getByText(/reduce motion/i)).toBeTruthy();
  });
});
```

- [ ] **Step 7: Implement** `apps/desktop/src/renderer/panels/SettingsPanel.tsx`

```tsx
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { Pane, Select, Switch } from '@coa/console-ui';
import type { ConsoleSettings } from '../../shared/settings.js';
import type { ConsoleState } from './state.js';

export interface SettingsVm {
  settings: ConsoleSettings;
  setSettings: (patch: Partial<ConsoleSettings>) => void;
}

export function selectSettingsVm(state: ConsoleState): SettingsVm {
  return { settings: state.ui.settings, setSettings: state.actions.setSettings };
}

function SettingsView({ vm }: { vm: SettingsVm; host: PanelHostApi }): React.JSX.Element {
  const { settings, setSettings } = vm;
  return (
    <Pane title="Settings" scroll>
      <div className="flex max-w-xs flex-col gap-4">
        <Select
          label="Theme"
          value={settings.theme}
          onValueChange={(v) => setSettings({ theme: v as ConsoleSettings['theme'] })}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
        <Select
          label="Density"
          value={settings.density}
          onValueChange={(v) => setSettings({ density: v as ConsoleSettings['density'] })}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Comfortable' },
          ]}
        />
        <Switch
          label="Reduce motion"
          checked={settings.motion === 'reduce'}
          onCheckedChange={(on) => setSettings({ motion: on ? 'reduce' : 'full' })}
        />
      </div>
    </Pane>
  );
}

export const settingsPanel: PanelDefinition<SettingsVm, ConsoleState> = {
  id: 'settings',
  displayName: 'Settings',
  render: SettingsView,
  selectVm: selectSettingsVm,
};
```

- [ ] **Step 8: Register + gear + load/apply.** In `registry.ts` register `settingsPanel`. In `NavPanel.tsx`, wire the gear to route to settings (remove `disabled`, add `onClick`):

```tsx
        <IconButton icon={Settings} label="Settings" variant="tertiary"
          aria-current={vm.activeId === 'settings' ? 'page' : undefined}
          onClick={() => vm.setRoute('settings')} />
```
In `console.ts`: extend `ConsoleBridge` with `getSettings`/`saveSettings`; import `applySettings` + `ConsoleSettings`; add the `setSettings` action + a settings load:

```ts
  let settings = await bridge.getSettings();
  applySettings(settings);

  const setSettings = (patch: Partial<ConsoleSettings>): void => {
    settings = { ...settings, ...patch };
    applySettings(settings);
    void bridge.saveSettings(settings);
    state = { ...state, ui: { ...state.ui, settings } };
    push();
  };
```
Wire `setSettings` into the `initialState` actions and pass `settings` into the initial `ui` (either seed `initialState` then overwrite `state.ui.settings = settings`, or extend `initialState` to take settings — simplest: after `state = initialState({...})`, set `state = { ...state, ui: { ...state.ui, settings } }`).

- [ ] **Step 9: Update the console test bridge** — add to `fakeBridge`:

```tsx
    getSettings: vi.fn().mockResolvedValue({ theme: 'dark', density: 'compact', motion: 'full' }),
    saveSettings: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 10: Run the settings + console tests**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/SettingsPanel.test.tsx apps/desktop/src/renderer/console.test.tsx`
Expected: PASS.

### Task 3.5: Docs + full sweep + commit

**Files:**
- Modify: `docs/REPO_LAYOUT.md`

- [ ] **Step 1: Update REPO_LAYOUT.md.** In the `apps/desktop` note, append after the existing inspector-shell sentence:

```
It now runs the inspector-first layout — the nav rail drives the main region (Cost/Flags/Timeline/Settings)
while a persistent right dock holds chat/agent placeholders + the live account selector; console settings
(theme/density/motion) persist per-user in `settings.json` beside `layout.json`.
```

- [ ] **Step 2: Full Part 3 gate sweep**

```
pnpm_config_verify_deps_before_run=false corepack pnpm typecheck
pnpm_config_verify_deps_before_run=false corepack pnpm lint
pnpm_config_verify_deps_before_run=false corepack pnpm format:write
pnpm_config_verify_deps_before_run=false corepack pnpm format
pnpm_config_verify_deps_before_run=false corepack pnpm test
pnpm_config_verify_deps_before_run=false corepack pnpm depcruise
pnpm_config_verify_deps_before_run=false corepack pnpm --filter @coa/desktop build
```
Expected: all PASS; depcruise 0 violations; build green.

- [ ] **Step 3: Commit Part 3** (stage by name; subject-only)

```bash
git add packages/console-viewmodel/src/reads.ts \
  apps/desktop/src/shared/methods.ts apps/desktop/src/shared/methods.test.ts \
  apps/desktop/src/shared/settings.ts apps/desktop/src/shared/settings.test.ts \
  apps/desktop/src/main/index.ts apps/desktop/src/main/persistence.ts apps/desktop/src/main/persistence.test.ts \
  apps/desktop/src/preload/api.d.ts \
  apps/desktop/src/renderer/theme.ts apps/desktop/src/renderer/theme.test.ts \
  apps/desktop/src/renderer/main.tsx apps/desktop/src/renderer/globals.css \
  apps/desktop/src/renderer/panels/state.ts apps/desktop/src/renderer/panels/AccountPanel.tsx \
  apps/desktop/src/renderer/panels/AccountPanel.test.tsx apps/desktop/src/renderer/panels/SettingsPanel.tsx \
  apps/desktop/src/renderer/panels/SettingsPanel.test.tsx apps/desktop/src/renderer/panels/registry.ts \
  apps/desktop/src/renderer/panels/NavPanel.tsx apps/desktop/src/renderer/panels/routing.ts \
  apps/desktop/src/renderer/console.ts apps/desktop/src/renderer/console.test.tsx docs/REPO_LAYOUT.md
git commit -m "feat: add the account selector and console settings surfaces"
```

---

## Post-plan: memory upkeep (not a code commit)

After all three parts land green, update `C:\Users\Zander\.claude\projects\c--Users-Zander-Documents-Side-Projects-coa\memory\m10-status.md` + the `MEMORY.md` index: 4b is BUILT — inspector-first layout (nav rail drives a main region via `ConsoleState`-carried route; persistent right dock chat/agent/account); Flags + Timeline live read surfaces; Account selector live over the auth verbs; a dedicated `ConsoleSettings` (theme/density/motion) persisted in `settings.json` by main + applied via `tokensToCss`. Next: 4c (mock chat/approvals/agent-config/compiled-prompt/graph).

## Self-review

**Spec coverage (§21.1/§21.2):** inspector-first arrangement → Part 1 (routing + descriptor). `ConsoleState{data,ui,actions}` + actions-up → Part 1 (state.ts, console.ts). Nav swaps the main leaf's panelId (reorganizable) → Task 1.2 `setMainPanelId` + Task 1.5. Cost re-homed → Part 1. Flags/Timeline live → Part 2. Account selector (auth verbs, right dock) → Task 3.2. Settings dedicated + main `settings.json` + theme/density/motion applied → Tasks 3.3–3.4. raw affordance untouched → (no change; it stays as 4a). No persistent cost chip → (Cost is a nav window; nothing adds a chip). Decisions/agent/ledger/status deferred → (not built). States-first → every panel task. Renderer isolation (edge types via console-viewmodel, not core) → Task 2.1/3.1. Zod at the edges → methods registry. LAYOUT_EPOCH ignores stale 4a layout → Task 1.2/1.5.

**Placeholder scan:** none — every step carries real code/commands. The two "confirm the component prop names" notes (EmptyState) are verification prompts, not deferred work; the components are already exported and used elsewhere.

**Type consistency:** `ConsoleState`/`ConsoleData`/`ConsoleUi`/`ConsoleActions` grow monotonically (Part 1 → 2 → 3), each addition listed in its task's Interfaces. `Remote<T>` stable. `PanelDefinition<VM, ConsoleState>` for every panel. `METHODS`/`MethodName`/`channel` extended consistently; `runMethod` gains a case per new method. `ConsoleBridge` (console.ts) and the `window.coa` typing (api.d.ts) gain the same methods in lockstep. `setMainPanelId`/`makeDescriptor`/`ROUTABLE_IDS`/`LAYOUT_EPOCH` stable across Tasks 1.2/1.5/3.2. `ConsoleSettings`/`parseSettings`/`DEFAULT_SETTINGS` stable across 3.3/3.4. `readJson`/`writeJson` replace `readLayout`/`writeLayout` in one task (3.3) with all call sites updated.

**Deferred (out of 4b scope, confirmed):** Decisions (no list verb) · agent-config · ledger/model-usage · session-status chip · the SC-1 DenyNotice banner · the real `coa raw` view (all 4c or verb-gated); per-workspace layout keying and fixed-px nav width carry over from 4a.
