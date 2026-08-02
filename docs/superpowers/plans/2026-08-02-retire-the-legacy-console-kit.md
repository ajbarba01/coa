# Retiring the legacy console kit — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `@coa/console-ui` and the retired forge palette with it, moving the code that is still live into `@coa/console-kit` (primitives) and a new `@coa/console-transcript` (the conversation renderer).

**Architecture:** Two halves, shipped in order. First the visual fix — `InlineMessage` and `Toast` are built in the kit so no surface renders on the legacy palette. Then the structural retirement — the transcript family moves to its own package, the 39 unreachable files and the token injector are deleted, and the package directory goes.

**Tech Stack:** TypeScript (strict), React 19, Tailwind v4, Base UI, Vitest + jsdom, pnpm workspaces.

## Global Constraints

- **TypeScript `strict`, no `any`.**
- **Commit messages: subject-line only.** Conventional Commits. No body, no trailers, no `Co-Authored-By`, no "Generated with". **No project-internal identifiers** — no task numbers, phase codes, or module IDs.
- **Stage files by name.** Never `git add -A`.
- **Format only the files you touched.** Running prettier over a whole directory reformats unrelated files already out of sync on `main`.
- **`pnpm --filter … test` is a silent no-op here.** Use `npx vitest run <paths>`.
- **Known baseline failures — not yours, do not chase:** ~10 failing tests in `packages/adapter-deepseek` and `packages/adapter-longcat`; `pnpm docs:check` fails on a gitignored `TEMP.md`; `npx eslint .` reports 8 pre-existing errors across 7 files.
- **The test count must hold at 747.** Nothing here is a rewrite, so a drop means something was lost in a move.
- **No raw values in components** — colour, space, radius, duration and z come from tokens.
- **Copy law:** commands and actions Title Case; labels and state names sentence case; prose sentence case with a terminal period; **no em dashes in interface copy**.
- **Every kit member ships** an intent block, a registry entry, a regenerated catalogue, all applicable states, jsdom tests, and a showcase specimen.

---

### Task 1: The kit's feedback family — `Status` + `InlineMessage`

**Files:**

- Create: `packages/console-kit/src/feedback/InlineMessage.tsx`
- Create: `packages/console-kit/src/feedback/InlineMessage.intent.ts`
- Create: `packages/console-kit/src/feedback/InlineMessage.test.tsx`
- Modify: `packages/console-kit/src/data/Icon.tsx` (add four glyphs)
- Modify: `packages/console-kit/src/registry.ts`, `packages/console-kit/src/index.ts`

**Interfaces:**

- Produces: `type Status = 'info' | 'success' | 'warning' | 'danger'`; `InlineMessage({ tone?: Status, children, className? })`. Task 2 consumes `Status`; Task 3 consumes `InlineMessage`.

- [ ] **Step 1: Add the four tone glyphs to the kit's bounded set**

In `Icon.tsx`, extend the lucide import with `Info, CircleCheck, TriangleAlert, OctagonAlert` and add to `GLYPHS`:

```ts
  // The four feedback tones. A tone is a STATE, and the indicator law draws state — so
  // each tone owns a mark rather than relying on colour alone (colour is not a channel
  // every reader has).
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
```

- [ ] **Step 2: Write the failing test**

`packages/console-kit/src/feedback/InlineMessage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineMessage } from './InlineMessage.js';

describe('InlineMessage', () => {
  it('renders its message', () => {
    render(<InlineMessage tone="danger">Failed to load</InlineMessage>);
    expect(screen.getByText('Failed to load')).toBeTruthy();
  });

  it('draws a distinct mark per tone, so tone is not carried by colour alone', () => {
    const marks = new Set<string>();
    for (const tone of ['info', 'success', 'warning', 'danger'] as const) {
      const { container, unmount } = render(<InlineMessage tone={tone}>x</InlineMessage>);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      marks.add(svg?.innerHTML ?? '');
      unmount();
    }
    expect(marks.size).toBe(4);
  });

  it('defaults to the info tone', () => {
    const { container } = render(<InlineMessage>x</InlineMessage>);
    expect(container.firstElementChild?.getAttribute('data-tone')).toBe('info');
  });

  it('rides sand tokens, never the retired palette', () => {
    const { container } = render(<InlineMessage tone="warning">x</InlineMessage>);
    const cls = String(container.firstElementChild?.className);
    expect(cls).not.toMatch(/text-(fg|muted|faint)|bg-(surface|raised|base|subtle)/);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run packages/console-kit/src/feedback/InlineMessage.test.tsx`
Expected: FAIL — cannot resolve `./InlineMessage.js`.

- [ ] **Step 4: Implement**

`packages/console-kit/src/feedback/InlineMessage.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cx } from '../cx.js';
import { Icon, type IconName } from '../data/Icon.js';

/** The four feedback tones every kit surface shares. Lives with the feedback family
 *  because that is what defines it; the transcript's own notices import it from here. */
export type Status = 'info' | 'success' | 'warning' | 'danger';

const MARK: Record<Status, IconName> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

const TONE: Record<Status, string> = {
  info: 'text-s9',
  success: 'text-ok',
  warning: 'text-warn',
  danger: 'text-crit',
};

export interface InlineMessageProps {
  tone?: Status;
  children: ReactNode;
  className?: string;
}

/** One line of state beside the thing it is about: a drawn mark plus a short message.
 *  Inline rather than docked, so it reads as a property of its neighbour and not as a
 *  page-level announcement. */
export function InlineMessage({
  tone = 'info',
  children,
  className,
}: InlineMessageProps): React.JSX.Element {
  return (
    <span
      data-tone={tone}
      className={cx('inline-flex items-center gap-1.5 text-sec', TONE[tone], className)}
    >
      <Icon name={MARK[tone]} size="sm" />
      {children}
    </span>
  );
}
```

Check the tone token names against `sand-dark.css` before committing — use whatever the theme actually defines for ok/warn/crit and adjust `TONE` to match.

- [ ] **Step 5: Add the intent block**

`packages/console-kit/src/feedback/InlineMessage.intent.ts`, following the shape of `packages/console-kit/src/StatusDot.intent.ts` exactly (open that file and mirror its fields).

- [ ] **Step 6: Register and export**

Add `inlineMessageIntent` to `registry.ts`'s imports and `allIntents`. Add to `index.ts`:

```ts
export {
  InlineMessage,
  type InlineMessageProps,
  type Status,
} from './feedback/InlineMessage.js';
```

- [ ] **Step 7: Regenerate the catalogue and run the suite**

Run: `pnpm --filter @coa/console-kit gen` then `npx vitest run packages/console-kit`
Expected: PASS, including the intent-coverage test.

- [ ] **Step 8: Commit**

```bash
git add packages/console-kit/src/feedback packages/console-kit/src/data/Icon.tsx packages/console-kit/src/registry.ts packages/console-kit/src/index.ts packages/console-kit/COMPONENTS.md
git commit -m "feat: give the kit an inline message and the four tone marks"
```

---

### Task 2: The kit's `Toast`

**Files:**

- Create: `packages/console-kit/src/feedback/Toast.tsx`, `Toast.intent.ts`, `Toast.test.tsx`
- Modify: `packages/console-kit/src/registry.ts`, `index.ts`

**Interfaces:**

- Consumes: `Status` from Task 1.
- Produces: `ToastProvider({ children })` and `Toast({ open, onOpenChange?, tone?, title, children? })` — the SAME signature the legacy component had, so Task 3 is an import swap and nothing else.

**Design note — why this does not use Base UI.** Base UI 1.6 ships a toast, but it is **manager-driven** (`useToastManager().add()`), while the console's only toast is a controlled error surface driven by `revealError !== null`. Adopting the manager would restructure the consumer to buy stacking, queueing and swipe that it does not use, and syncing controlled state into an imperative manager invites duplicate-add bugs. ADR-0014's reason for riding Base UI is mechanics we would otherwise hand-roll badly — focus traps and anchored positioning. A toast has neither. Record this in Task 8's ADR.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Toast, ToastProvider } from './Toast.js';

const show = (props: Partial<React.ComponentProps<typeof Toast>> = {}) =>
  render(
    <ToastProvider>
      <Toast open title="Couldn't open" onOpenChange={props.onOpenChange ?? (() => {})} {...props}>
        {props.children ?? 'no such file'}
      </Toast>
    </ToastProvider>,
  );

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('announces politely so a screen reader hears it without focus moving', () => {
    show();
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText("Couldn't open")).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    render(
      <ToastProvider>
        <Toast open={false} title="hidden" />
      </ToastProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('dismisses on a click anywhere, not only the close control', () => {
    const onOpenChange = vi.fn();
    show({ onOpenChange });
    screen.getByRole('status').click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('auto-dismisses after its duration', () => {
    const onOpenChange = vi.fn();
    show({ onOpenChange });
    act(() => void vi.advanceTimersByTime(4000));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('has a labelled close control', () => {
    const onOpenChange = vi.fn();
    show({ onOpenChange });
    screen.getByRole('button', { name: 'Dismiss' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/console-kit/src/feedback/Toast.test.tsx`
Expected: FAIL — cannot resolve `./Toast.js`.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, type ReactNode } from 'react';
import { cx } from '../cx.js';
import { Icon } from '../data/Icon.js';
import type { Status } from './InlineMessage.js';

const DURATION_MS = 4000;

/** Hosts the toast region. A provider rather than a bare fixed div so a surface can
 *  declare where its toasts belong without every call site repeating the geometry. */
export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <>
      {children}
      <div
        data-toast-viewport
        className="pointer-events-none fixed right-3 bottom-3 z-(--z-toast) flex w-80 flex-col gap-2"
      />
    </>
  );
}

export interface ToastProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  tone?: Status;
  title: string;
  children?: ReactNode;
}

const TONE: Record<Status, string> = {
  info: 'border-s5',
  success: 'border-ok/40',
  warning: 'border-warn/40',
  danger: 'border-crit/50',
};

/** A transient, controlled announcement. Fully controlled — the caller owns `open`, so
 *  there is no internal queue to drift from the state that produced the message. */
export function Toast({
  open,
  onOpenChange,
  tone = 'info',
  title,
  children,
}: ToastProps): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => onOpenChange?.(false), DURATION_MS);
    return () => clearTimeout(t);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-tone={tone}
      onClick={() => onOpenChange?.(false)}
      className={cx(
        'slip fixed right-3 bottom-3 z-(--z-toast) flex w-80 cursor-pointer items-start gap-2 rounded-r3 border bg-s3 px-3 py-2 text-sec shadow-lg',
        TONE[tone],
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium text-s12">{title}</div>
        {children !== undefined && <div className="text-s9">{children}</div>}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange?.(false);
        }}
        className="slip slip-press shrink-0 rounded-r1 p-0.5 hover:bg-s4 focus-visible:outline-focus active:scale-[0.97]"
      >
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}
```

Check `--z-toast` exists in `tokens.css`; if not, add it to the z scale beside the other overlay levels rather than inventing a raw value.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/console-kit/src/feedback/Toast.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Intent, registry, export, catalogue**

Add `Toast.intent.ts` mirroring `InlineMessage.intent.ts`; register `toastIntent`; export `Toast`, `ToastProvider`, `type ToastProps` from `index.ts`; run `pnpm --filter @coa/console-kit gen`.

- [ ] **Step 6: Run the kit suite and commit**

```bash
npx vitest run packages/console-kit
git add packages/console-kit/src/feedback packages/console-kit/src/registry.ts packages/console-kit/src/index.ts packages/console-kit/COMPONENTS.md
git commit -m "feat: give the kit a controlled toast"
```

---

### Task 3: Move the app onto the kit's feedback family

**Files:**

- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx`, `AgentsPanel.tsx`, `ShowcasePanel.tsx`

**Interfaces:**

- Consumes: `InlineMessage`, `Toast`, `ToastProvider`, `Status` from Tasks 1–2.

- [ ] **Step 1: Swap the imports**

In `ChatPanel.tsx`, remove `InlineMessage`, `Toast`, `ToastProvider` from the `@coa/console-ui` import and add them to its `@coa/console-kit` import. Same for `AgentsPanel.tsx` (`InlineMessage` only — delete the now-empty `@coa/console-ui` import line entirely) and `ShowcasePanel.tsx`.

- [ ] **Step 2: Add the kit specimens to the showcase**

In `ShowcasePanel.tsx` the `Feedback` family now renders kit members, so move it above the legacy families and update the intro copy to name what is still legacy. Verify `ShowcasePanel.test.tsx`'s family list still matches.

- [ ] **Step 3: Run the app suite**

Run: `npx tsc -b && npx vitest run apps/desktop`
Expected: PASS, 645 tests.

- [ ] **Step 4: Build and look at it**

Run: `cd apps/desktop && npx electron-vite build`
Then launch and check chat's error toast and the agents surface's inline message render on the sand scale. **This is the visual half's whole point — do not skip it.**

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/ChatPanel.tsx apps/desktop/src/renderer/panels/AgentsPanel.tsx apps/desktop/src/renderer/panels/ShowcasePanel.tsx
git commit -m "feat: move the console's feedback surfaces onto the current kit"
```

---

### Task 4: Remove the density control

**Files:**

- Modify: `apps/desktop/src/shared/settings.ts`, `apps/desktop/src/renderer/shell/Settings.tsx`, `apps/desktop/src/renderer/theme.ts`, `apps/desktop/src/renderer/shell/Settings.test.tsx`

- [ ] **Step 1: Write the failing test**

In `Settings.test.tsx`, replace the existing density assertions with:

```tsx
it('offers no density control, because the kit scale does not answer to it', () => {
  renderSettings();
  expect(screen.queryByText('Density')).toBeNull();
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run apps/desktop/src/renderer/shell/Settings.test.tsx`
Expected: FAIL — "Density" is still rendered.

- [ ] **Step 3: Delete the control and the field**

Remove the `density` `SettingRow` block from `Settings.tsx`. In `settings.ts`, delete the `density` line from `ConsoleSettingsSchema` and from `DEFAULT_SETTINGS`. No migration is needed: `parseSettings` uses `safeParse` on a `z.object`, which strips the stale key on the next write.

In `theme.ts`, `applySettings` drops the density argument — it keeps resolving the theme, setting `colorScheme`, flagging reduced motion, and tracking the OS preference.

- [ ] **Step 4: Fix the other density callers**

Run: `npx tsc -b` and fix every reported `density` reference (`main.tsx`'s `tokensToCss('dark', 'compact')` becomes irrelevant in Task 7 — for now pass nothing and let Task 7 delete the call).

- [ ] **Step 5: Run the suite and commit**

```bash
npx vitest run apps/desktop
git add apps/desktop/src/shared/settings.ts apps/desktop/src/renderer/shell/Settings.tsx apps/desktop/src/renderer/shell/Settings.test.tsx apps/desktop/src/renderer/theme.ts
git commit -m "fix: drop the density control the current scale never answered to"
```

---

### Task 5: The `@coa/console-transcript` package

**Files:**

- Create: `packages/console-transcript/package.json`, `tsconfig.json`, `README.md`, `src/index.ts`
- Move: all of `packages/console-ui/src/dense/` (27 files incl. tests), `feedback/DenyNotice.*`, `data/AgentChip.*`
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx`, `ShowcasePanel.tsx`, `apps/desktop/package.json`, root `tsconfig`/workspace config

**Interfaces:**

- Produces: `Transcript`, `TranscriptFrame`, `RespondFn`, `StreamingMarkdown`, `Composer`, `ToolCard`, `DenyNotice`, `AgentChip`, `FindBar` and the dense helpers — the same names `@coa/console-ui` exported.

- [ ] **Step 1: Scaffold the package**

`packages/console-transcript/package.json` — copy `packages/console-kit/package.json` and change `name` to `@coa/console-transcript`, drop the `gen` script (this package has no catalogue), and set dependencies to what the moved files actually import: `@coa/console-kit`, `lucide-react`, `react-markdown`, `remark-gfm`, `react-syntax-highlighter`, `react-virtuoso`, `motion`. Copy `tsconfig.json` from console-kit and fix its relative paths.

- [ ] **Step 2: Move the files with git so history follows**

```bash
mkdir -p packages/console-transcript/src/dense
git mv packages/console-ui/src/dense/* packages/console-transcript/src/dense/
git mv packages/console-ui/src/feedback/DenyNotice.tsx packages/console-ui/src/feedback/DenyNotice.intent.ts packages/console-ui/src/feedback/DenyNotice.test.tsx packages/console-transcript/src/
git mv packages/console-ui/src/data/AgentChip.tsx packages/console-ui/src/data/AgentChip.test.tsx packages/console-transcript/src/
```

- [ ] **Step 3: Repoint every import in the moved files**

The moved files import `../lib/cx.js`, `../icon/Icon.js`, `../feedback/Banner.js` (for `Status`) and similar. Repoint each to `@coa/console-kit` — `cx` and `Icon` and `Status` all come from there now. `AgentChip` keeps importing its agent glyphs directly from `lucide-react`, matching the precedent in `AgentsPanel.tsx` that an app-specific glyph vocabulary does not belong in the kit.

Write `src/index.ts` re-exporting every symbol the app imports.

- [ ] **Step 4: Point the app at the new package**

Add `"@coa/console-transcript": "workspace:*"` to `apps/desktop/package.json`, run `pnpm install`, and change `ChatPanel.tsx` / `ShowcasePanel.tsx` to import `Transcript`, `TranscriptFrame`, `RespondFn`, `PaneOverlayProvider`'s neighbours etc. from it.

- [ ] **Step 5: Typecheck, test, commit**

```bash
npx tsc -b
npx vitest run packages/console-transcript apps/desktop
git add packages/console-transcript apps/desktop/package.json apps/desktop/src/renderer/panels pnpm-lock.yaml
git commit -m "refactor: give the conversation renderer its own package"
```

Expected: the moved tests run in their new home with the same count.

---

### Task 6: `PaneOverlay` to the kit, `AgentRailItem` to the app

**Files:**

- Move: `packages/console-ui/src/layout/PaneOverlay.*` → `packages/console-kit/src/overlay/`
- Modify: `packages/console-kit/src/index.ts`, `registry.ts`; `apps/desktop/src/renderer/shell/Center.tsx`

- [ ] **Step 1: Move PaneOverlay**

```bash
git mv packages/console-ui/src/layout/PaneOverlay.tsx packages/console-ui/src/layout/PaneOverlay.intent.ts packages/console-ui/src/layout/PaneOverlay.test.tsx packages/console-kit/src/overlay/
```

Repoint its imports to the kit's own `cx` and `Icon`. It is already on sand tokens, so no re-skin is needed. Register `paneOverlayIntent`, export `PaneOverlayProvider` / `usePaneOverlay`, regenerate the catalogue.

- [ ] **Step 2: Give `AgentRailItem` a home in the app**

`Center.tsx` is the only thing that builds rail items. Define the interface at the top of `Center.tsx` (copy it verbatim out of `AgentRail.tsx` before that file is deleted) and drop the `@coa/console-ui` type import.

- [ ] **Step 3: Typecheck, test, commit**

```bash
npx tsc -b && npx vitest run packages/console-kit apps/desktop
git add packages/console-kit apps/desktop/src/renderer/shell/Center.tsx
git commit -m "refactor: move the pane overlay into the kit and rail items into the app"
```

---

### Task 7: Delete the package

**Files:**

- Delete: `packages/console-ui/` entirely
- Modify: `apps/desktop/src/renderer/main.tsx`, `theme.ts`, `globals.css`, `apps/desktop/package.json`, workspace config

- [ ] **Step 1: Prove nothing imports it**

Run:

```bash
grep -rn "@coa/console-ui" apps packages --include=*.ts --include=*.tsx --include=*.json --include=*.css | grep -v node_modules
```

Expected: no hits outside `packages/console-ui` itself. **If anything remains, fix it before deleting — do not delete around a live import.**

- [ ] **Step 2: Remove the token injection**

In `main.tsx`, delete the `tokensToCss` import and the `<style>` element it creates. In `theme.ts`, delete the import and the `style.textContent = …` assignment plus the element lookup/creation; keep the theme resolution, `colorScheme`, reduced-motion flag, and OS listener. In `globals.css`, delete the `@import '../../../../packages/console-ui/src/theme.css';` line and its comment.

- [ ] **Step 3: Delete the package and its wiring**

```bash
git rm -r packages/console-ui
```

Remove `"@coa/console-ui": "workspace:*"` from `apps/desktop/package.json`, then `pnpm install` so the lockfile drops it — and with it `radix-ui`, which nothing else uses.

- [ ] **Step 4: Verify the whole repo**

```bash
npx tsc -b
npx vitest run
npx eslint apps packages
npx prettier --check apps packages
pnpm depcruise
cd apps/desktop && npx electron-vite build
```

Expected: green apart from the documented baseline failures. **The renderer build is the load-bearing check** — a missing token surfaces there, not in jsdom. Grep the built CSS for the retired palette:

```bash
grep -c "241c17\|14100d\|c39a3e" apps/desktop/dist/renderer/assets/*.css
```

Expected: `0`.

- [ ] **Step 5: Launch and drive it**

Chat (transcript, streaming, tool cards, the error toast), agents (inline message, both column modes), showcase, flags, timeline, auth. Nothing brown, nothing missing.

- [ ] **Step 6: Commit**

```bash
git add -u
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/renderer
git commit -m "refactor: delete the retired console kit and its palette"
```

---

### Task 8: Record it

**Files:**

- Create: `docs/adr/0025-retire-the-legacy-console-kit.md`
- Modify: `ROADMAP.md`, `docs/REPO_LAYOUT.md`, `docs/UI.md`

- [ ] **Step 1: Write the ADR**

Number it after the highest existing ADR (check `ls docs/adr/`). Follow the shape of `docs/adr/0014-workbench-design-system.md`. It must record: that two token systems ran in parallel and the legacy one was a hardcoded hex table no theme control could reach; that over half the package was already unreachable; that the transcript got its own package rather than entering the kit, because the kit's member discipline cannot absorb a composite of that size; **that the kit's Toast deliberately does not use Base UI's manager-driven toast**, with the reasoning from Task 2; and that the density control was removed as a dead control rather than kept as a visible no-op.

- [ ] **Step 2: Update the roadmap**

Flip the console rebuild's phase line: the arc's remaining item was the legacy kit, and it is gone. Move "give the kit a density scale" into "Someday / ideas" with its reason. Update the M10 row so it no longer says `console-ui` survives.

- [ ] **Step 3: Update the layout and UI docs**

`REPO_LAYOUT.md`'s package map: remove `console-ui`, add `console-transcript` with a one-line responsibility. `docs/UI.md`: delete the "legacy kit" carve-outs — there is one kit now, plus the transcript package.

- [ ] **Step 4: Verify and commit**

```bash
pnpm docs:check
git add docs/adr ROADMAP.md docs/REPO_LAYOUT.md docs/UI.md
git commit -m "docs: record the retirement of the legacy console kit"
```

Expected: `docs:check` green apart from the maintainer's gitignored `TEMP.md`.

---

## Self-review notes

- **Spec coverage:** feedback family (Tasks 1–2), app switch (3), density (4), transcript package (5), PaneOverlay + `AgentRailItem` (6), deletion of the 39 dead files and `tokens/` and `tokensToCss` and `radix-ui` (7), ADR + docs (8). Every spec section maps to a task.
- **Type consistency:** `Status` is defined once in Task 1 and consumed by Tasks 2, 3 and 5. `ToastProps` keeps the legacy signature so Task 3 is an import swap. `AgentRailItem` is copied verbatim in Task 6 before Task 7 deletes its source.
- **Sequencing:** the visual half (1–3) lands before any move, so the app is correct regardless of what follows. The package is deleted only after Task 7 Step 1 proves nothing imports it.
- **Ordering hazard:** Task 4 leaves `main.tsx` briefly calling `tokensToCss` with one argument; Task 7 deletes the call. Do not reorder 7 before 4.

---

_Last reviewed: 2026-08-02_
