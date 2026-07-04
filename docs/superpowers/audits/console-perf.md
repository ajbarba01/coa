# Console Performance Audit

**Date:** 2026-07-04
**Scope:** Electron desktop console (M10) — renderer pipeline under `electron-vite dev`
**Status:** audit (no code changes)

## Methodology

Traced the full pipeline: `electron-vite` dev config → Vite dependency resolution → Tailwind CSS scanning → React renderer entry → layout engine → state management → IPC bridge → polling loop → per-panel viewmodel selectors → component tree → virtualized transcript.

---

## 🔴 Critical: Dev-mode Vite config has no pre-bundling

**File:** `apps/desktop/electron.vite.config.ts`

Every workspace package is aliased directly to its `src/index.ts`:

```ts
'@coa/console-ui': '.../packages/console-ui/src/index.ts'
```

In dev, Vite serves these as native ESM — **no `optimizeDeps` is configured**. The browser resolves the full module graph through ~157 TSX files (console-ui alone), plus console-layout, console-viewmodel, shared. On cold start, that's hundreds of individual module requests, each going through the React plugin + TypeScript transform.

**Fix:** Add `optimizeDeps.include` to pre-bundle workspace deps:

```ts
renderer: {
  optimizeDeps: {
    include: [
      '@coa/console-ui',
      '@coa/console-layout',
      '@coa/console-viewmodel',
      '@coa/shared',
    ],
  },
  server: {
    warmup: {
      clientFiles: ['./src/renderer/index.html'],
    },
  },
},
```

This pre-bundles these packages into single ESM chunks via esbuild on startup, cutting requests from hundreds to single digits.

---

## 🔴 Critical: Tailwind v4 `@source` scans 157 files unnecessarily

**File:** `apps/desktop/src/renderer/globals.css`

```css
@source '../../../../packages/console-ui/src';
```

This tells Tailwind to scan ALL 157 source files in `console-ui/src` for utility classes — including test files (`*.test.tsx`). In dev mode, this scan runs on every HMR update.

The renderer's own source files and the `packages/console-ui/src/theme.css` already cover all utilities actually used. Scanning the UI kit source is redundant — those classes are already resolved when imported by panel components.

**Fix:** Drop the `@source` directive entirely (the `@import` of the theme.css alone is sufficient), or scope it to the component files only:

```css
/* Remove: @source '../../../../packages/console-ui/src'; */
/* The @import of theme.css already brings in the design tokens Tailwind needs */
```

If explicit scan coverage is needed, narrow it to exclude test files:

```css
@source '../../../../packages/console-ui/src/actions';
@source '../../../../packages/console-ui/src/layout';
@source '../../../../packages/console-ui/src/inputs';
@source '../../../../packages/console-ui/src/data';
@source '../../../../packages/console-ui/src/feedback';
@source '../../../../packages/console-ui/src/overlays';
@source '../../../../packages/console-ui/src/dense';
```

---

## 🔴 Critical: 2-second polling replaces entire state — no memo, no diff

**Files:** `apps/desktop/src/renderer/App.tsx` (line 47), `apps/desktop/src/renderer/console.ts` (lines 170–178)

Every 2 seconds, `refresh()` makes 3 IPC calls (`capState`, `flagsForUser`, `listTimeline`) and replaces the entire `ConsoleState` object:

```ts
state = { ...state, data: { ...state.data, cap, flags, timeline } };
push(); // → engine.setDaemonState → store.version++ → re-render every panel
```

- **No shallow equality check** — even if all 3 responses are identical to the previous values, the tree re-renders.
- **`selectChatVm` runs heavy work every time** — `foldToolFrames` + `groupByUserTurn` + `computeChatBanners` + `buildRailItems` + `buildSessionGroups`. Each iterates the entire transcript.

**Fix — Two changes:**

1. Add shallow equality guard in the refresh path:

```ts
async function refresh() {
  const [cap, flags, timeline] = await Promise.all([...]);
  const next = { ...state.data, cap, flags, timeline };
  if (shallowEqual(state.data, next)) return; // skip if nothing changed
  state = { ...state, data: next };
  push();
}
```

2. Memoize the ChatPanel selector results. Wrap `selectChatVm` in `useMemo` inside `ChatView`, keyed on a hash or the relevant fragments of `state.data.turns`.

---

## 🟡 High: Zero `React.memo` / `useCallback` in ~50 components

**Files:** `packages/console-ui/src/**`

Only 3 `useMemo` calls exist in the entire component kit — all in data-heavy components (Transcript, Combobox, SwitcherMenu). No component uses `React.memo`. No callback uses `useCallback`.

Every panel re-render propagates through every child. The `selectVm` pattern (pure functions per panel) is architecturally correct, but without memo the benefit is lost — every panel re-renders on every state push.

**Fix:** Wrap the heaviest components in `React.memo`:

- `ChatView` (runs heavy selectors)
- `CostView`, `FlagsPanel`, `TimelinePanel` (lower priority but cheap to add)
- `AppShell`, `Pane`, `AgentRail`, `NavList` (layout components that rarely change)
- `Transcript` (already virtualized, but memo avoids unnecessary render calls)

---

## 🟡 High: Layout persistence fires on every drag pixel

**File:** `packages/console-layout/src/engine/static-engine.tsx` (lines 165–168)

```ts
onLayout={(sizes: number[]) => {
  ctx.store.current = updateSizesAtPath(ctx.store.current, path, sizes);
  ctx.onChange(ctx.store.current); // fires on every pixel of drag
}}
```

The `onChange` callback triggers `bridge.saveLayout()` (line 111 of console.ts), which is an IPC write to main → file write. On every pixel of resize drag, this fires.

**Fix:** Debounce `onChange` at the engine level (150ms is typical for layout persistence):

```ts
onLayout: throttle((sizes: number[]) => {
  ctx.store.current = updateSizesAtPath(ctx.store.current, path, sizes);
  ctx.onChange(ctx.store.current);
}, 150),
```

---

## 🟡 High: 7+ IPC roundtrips on startup

**File:** `apps/desktop/src/renderer/console.ts` (lines 535–538)

On launch:

```ts
void loadAccounts();   // IPC: listAccounts
void loadModels();     // IPC: listModels
void loadCatalogue();  // IPC: listRoles + listPackages (2 calls)
void initSessions();   // IPC: listSessions + reloadConversation (2 calls)
```

Plus `getLayout()` and `getSettings()` earlier (2 more). That's 7+ sequential IPC roundtrips before the UI is fully populated.

**Fix:** Merge `listRoles` + `listPackages` into one RPC if possible. Alternatively, parallelize more aggressively — `loadAccounts()` and `loadModels()` and `loadCatalogue()` are already concurrent, but `initSessions()` blocks the session display until all catalogue data arrives. Consider rendering the chat pane with a skeleton while sessions load.

---

## 🟢 Medium: Deep state spreads create GC pressure

Every mutation creates a new state tree via nested spreads:

```ts
state = { ...state, data: { ...state.data, flags } };
state = { ...state, ui: { ...state.ui, modelOverride: { ...prev, [id]: selection } } };
push();
```

With 2s polling + push events, this creates multiple new `ConsoleState` objects per second. Combined with the large transcript arrays in `state.data.turns`, this generates non-trivial GC pressure.

**Fix:** Consider using Immer or a shallow immutable helper so unchanged subtrees are shared references. Or, at minimum, use structural sharing for the `data.turns` array (append-only vs. full replacement).

---

## 🟢 Medium: `groupByUserTurn(foldToolFrames(frames))` runs on every render

**File:** `packages/console-ui/src/dense/Transcript.tsx` (line 659)

```ts
const { counts, headers, items } = groupByUserTurn(foldToolFrames(frames));
```

These are O(n) operations that run on **every render** of the Transcript component — which is re-rendered every 2s via the polling push. For a long conversation (100+ frames), this adds up.

**Fix:** Move these into `useMemo`, keyed on the frames array identity:

```ts
const { counts, headers, items } = useMemo(
  () => groupByUserTurn(foldToolFrames(frames)),
  [frames],
);
```

---

## 🟢 Medium: No Vite CSS dev sourcemap tuning

Tailwind v4's Vite plugin generates CSS sourcemaps in dev by default, adding overhead. The `@import 'tailwindcss'` with `@source` generates a large CSS file that gets re-parsed on changes.

**Fix:** Disable CSS sourcemaps in dev if they aren't needed:

```ts
renderer: {
  css: { devSourcemap: false },
}
```

---

## Summary: Priority fixes

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| 1 | Add `optimizeDeps.include` | Cold start from minutes to seconds | 5 lines |
| 2 | Remove/scope `@source` in CSS | HMR speed, tailwind JIT overhead | 1 line |
| 3 | Shallow-equal guard on poll | Eliminates no-op re-renders every 2s | ~10 lines |
| 4 | `useMemo` on transcript grouping | O(n) → O(1) per render for transcript | 1 line |
| 5 | Add `React.memo` to heavy panels | Stops cascade re-renders | ~20 lines |
| 6 | Debounce layout persistence | Reduces IPC + disk writes during drag | 1 throttle call |
| 7 | Merge startup IPC calls | Faster time-to-interactive | Depends on daemon |

Fixes #1–#3 alone will likely resolve most of the "jank" in dev mode. The remaining items are compounding factors that become more visible at scale (long transcripts, many sessions).
