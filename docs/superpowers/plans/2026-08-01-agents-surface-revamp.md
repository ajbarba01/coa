# Agents Surface Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the console's agent editor as contained panels on a mirrored two-column grid, merge the predictive chat notices into the composer, and unify every model picker behind one component.

**Architecture:** Three independent seams. (1) A new app-level `ModelPicker` wraps the kit's `Combobox` and places its reasoning control by variant, replacing both the composer's hand-rolled menu and the editor's hand-rolled ladder. (2) A new app-level `Panel` gives the agent editor the in-flow elevation every other console surface already uses, laid out on a `264px | 1fr` grid. (3) The chat notices move inside the composer's rect as tinted sections, gaining a short visible summary and cache dismissal.

**Tech Stack:** TypeScript (strict, no `any`) · React 19 · Tailwind v4 (`@theme` tokens) · zustand · motion · Vitest + jsdom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-01-agents-surface-revamp-design.md`

## Global Constraints

- **TypeScript `strict`, no `any`.** `exactOptionalPropertyTypes` is on: build optional props with `...(x !== undefined ? { x } : {})`, never `x: undefined`.
- **No raw values.** Colour, space, radius, duration and z come from tokens. Tailwind's spacing/`@theme` scales are the token system; arbitrary values are permitted only in `rem` and only where the scale has no step (existing precedent: `text-[9.5px]`, `w-[calc(100%-64px)]`).
- **Build from the kit.** A panel is kit composition plus a pure selector. A new shared component earns an app-level module in `panels/` only on its second consumer (precedent: `fields.tsx`, `resolvedSet.tsx`, `RowMenu.tsx`); a new *kit* member needs a lint-enforced intent block.
- **Copy laws.** Commands and actions Title Case (`Add Role`, `Recompile`). Labels and state names sentence case (`Runs on`, `Prompt cache`). Prose sentence case with a terminal period. Keycaps lowercase. Everything starts with a capital. **No em dashes in interface copy.**
- **Indicator law.** State is a dot; magnitude is a count and **zero renders nothing**; text is for names; detail is proximity.
- **Every state ships:** default · hover · focus-visible · active · disabled · loading · empty · error. Press idiom is `slip slip-press` plus `active:scale-[0.97]` (`0.95` for square icon buttons).
- **Focus** is a 2px s8 ring drawn inside (`outline-offset: -2px`); inputs opt out, their border step-up is the cue.
- **Commits:** subject-only Conventional Commits. No body, no trailers, no `Co-Authored-By`, no "Generated with" footer, **no project-internal identifiers** (no task numbers, phase codes, module IDs). **Stage files by name**, never `git add -A`.
- **Format only files you touched.** Running prettier over `panels/` reformats `modelsStore.ts` and its test, which are already out of sync on `main`.
- **`pnpm --filter … test` is a silent no-op here.** Use `npx vitest run <paths>`.
- **Known baseline failures — do not chase:** ~10 tests in `packages/adapter-deepseek` and `packages/adapter-longcat`; `pnpm docs:check` failing on a gitignored root `TEMP.md`; 8 pre-existing `eslint` errors across 7 files.
- **Never touch** `DEV-NOTES.md` or `docs/superpowers/specs/2026-07-31-backend-independent-agent-arc-design.md`. They are the maintainer's.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/console-kit/src/inputs/Combobox.tsx` | *modify* — gains a `footer` slot rendered under the option list, inside the popover. |
| `apps/desktop/src/renderer/panels/ModelPicker.tsx` | *create* — the one model+effort control. Owns harness grouping, marks, and reasoning placement by variant. |
| `apps/desktop/src/renderer/panels/ModelPicker.test.tsx` | *create* — variant behaviour, empty-list and empty-effort degradation. |
| `apps/desktop/src/renderer/panels/Panel.tsx` | *create* — the in-flow contained region: header (label + optional count) / body / optional footer. |
| `apps/desktop/src/renderer/panels/Panel.test.tsx` | *create* — header, count suppression, footer omission. |
| `apps/desktop/src/renderer/panels/AgentsPanel.tsx` | *modify* — panels, mirrored grid, narrow stacking, filter removal from the strip, rename metric, pin toggle, `ModelPicker`. |
| `apps/desktop/src/renderer/panels/Composer.tsx` | *modify* — `ModelChip` replaced by `ModelPicker`; notices merged into the shell. |
| `apps/desktop/src/renderer/panels/NoticeLine.tsx` | *modify* — becomes the merged in-composer notice section. |
| `apps/desktop/src/renderer/panels/banners.ts` | *modify* — `ChatNotice.summary`, drift-first ordering, `cacheKey`, `dismissedCacheKey`. |
| `apps/desktop/src/renderer/panels/fields.tsx` | *modify* — `TextInput` gains a skin-**replacing** prop. |
| `apps/desktop/src/renderer/panels/state.ts` | *modify* — `ui.dismissedCache`. |
| `apps/desktop/src/renderer/console.ts` | *modify* — cache dismissal in `onBannerAction`; `dismissedCacheKey` into the vm. |
| `apps/desktop/src/renderer/panels/ChatPanel.tsx` | *modify* — notices flow into `Composer`, not the `above` slot. |
| `docs/UI.md` | *modify* — record the panel elevation usage and the flagged visible-summary deviation. |

---

## Task 1: Combobox gains a footer slot

**Files:**
- Modify: `packages/console-kit/src/inputs/Combobox.tsx`
- Test: `packages/console-kit/src/inputs/Combobox.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `ComboboxProps.footer?: React.ReactNode` — rendered inside the popover, below the listbox, separated by a `border-t border-s4` hairline. Absent ⇒ nothing renders (no empty bordered strip).

- [ ] **Step 1: Write the failing tests**

Append to `packages/console-kit/src/inputs/Combobox.test.tsx`:

```tsx
it('renders a footer inside the popover when given one', async () => {
  const user = userEvent.setup();
  render(
    <Combobox
      aria-label="Model"
      placeholder="Filter models…"
      value="a"
      options={[{ value: 'a', label: 'Alpha' }]}
      onChange={() => {}}
      footer={<span>Reasoning</span>}
    />,
  );
  await user.click(screen.getByRole('combobox'));
  expect(screen.getByText('Reasoning')).toBeInTheDocument();
});

it('renders no footer region when none is given', async () => {
  const user = userEvent.setup();
  const { container } = render(
    <Combobox
      aria-label="Model"
      placeholder="Filter models…"
      value="a"
      options={[{ value: 'a', label: 'Alpha' }]}
      onChange={() => {}}
    />,
  );
  await user.click(screen.getByRole('combobox'));
  expect(container.querySelector('[data-combobox-footer]')).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/console-kit/src/inputs/Combobox.test.tsx`
Expected: FAIL — `footer` is not a valid prop (TS) and the text is not found.

- [ ] **Step 3: Implement**

Add to `ComboboxProps`:

```ts
  /** Rendered inside the popover beneath the option list, on its own hairline. The
   *  composer's reasoning ladder rides here; the popover belongs to the kit, so the
   *  slot has to as well. Absent ⇒ no region and no hairline. */
  footer?: React.ReactNode;
```

Destructure `footer` in the signature, and add after the `role="listbox"` div, still inside the flex column:

```tsx
        {footer !== undefined && (
          <div data-combobox-footer className="border-t border-s4">
            {footer}
          </div>
        )}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/console-kit/src/inputs/Combobox.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/console-kit/src/inputs/Combobox.tsx packages/console-kit/src/inputs/Combobox.test.tsx
git commit -m "feat: let a combobox carry a footer inside its popover"
```

---

## Task 2: The ModelPicker component

**Files:**
- Create: `apps/desktop/src/renderer/panels/ModelPicker.tsx`
- Create: `apps/desktop/src/renderer/panels/ModelPicker.test.tsx`

**Interfaces:**
- Consumes: `ComboboxProps.footer` (Task 1); `modelPickerOptions` and `modelPickerLabel` from `AgentsPanel.tsx`; `StepSlider` from the kit.
- Produces:

```ts
export interface ModelPickerProps {
  models: ModelDescriptor[];
  value: string | undefined;
  onChange: (modelId: string) => void;
  effortOptions: { value: string; label: string }[];
  effortValue: string;
  onEffortChange: (v: string) => void;
  /** chip: composer shelf skin, effort in the popover footer, effort named on the
   *  trigger. bordered: kit chip skin, effort as a visible ladder beneath. */
  variant: 'chip' | 'bordered';
  disabled?: boolean;
}
export function ModelPicker(props: ModelPickerProps): React.JSX.Element;
```

**Move first:** `modelPickerOptions`, `modelPickerLabel`, `modelLabel`, `pickableModels` and `PROVIDER_LABELS` move from `AgentsPanel.tsx` into `ModelPicker.tsx` and are re-exported from `AgentsPanel.tsx` so existing tests importing them from there keep passing. `AgentsPanel.test.tsx` currently imports `modelPickerOptions`, `modelLabel`, `modelPickerLabel`, `pickableModels` and `clampReasoning`; `clampReasoning` stays in `AgentsPanel.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/renderer/panels/ModelPicker.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelPicker } from './ModelPicker.js';
import type { ModelDescriptor } from '@coa/console-viewmodel';

const MODELS: ModelDescriptor[] = [
  { id: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.6 · fast' },
  { id: 'opus', displayName: 'Opus', description: 'Opus 4.8 · deep' },
];
const EFFORTS = [
  { value: 'none', label: 'none' },
  { value: 'think', label: 'think' },
  { value: 'ultra', label: 'ultra' },
];

function setup(overrides: Partial<React.ComponentProps<typeof ModelPicker>> = {}) {
  const onChange = vi.fn();
  const onEffortChange = vi.fn();
  render(
    <ModelPicker
      models={MODELS}
      value="sonnet"
      onChange={onChange}
      effortOptions={EFFORTS}
      effortValue="think"
      onEffortChange={onEffortChange}
      variant="chip"
      {...overrides}
    />,
  );
  return { onChange, onEffortChange };
}

describe('ModelPicker', () => {
  it('names the current effort on the chip trigger', () => {
    setup();
    expect(screen.getByRole('combobox')).toHaveTextContent('think');
  });

  it('omits the effort from the bordered trigger, which shows a ladder instead', () => {
    setup({ variant: 'bordered' });
    expect(screen.getByRole('combobox')).not.toHaveTextContent('think');
    expect(screen.getByRole('slider', { name: 'Reasoning effort' })).toBeInTheDocument();
  });

  it('puts the ladder in the popover footer for the chip variant', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole('slider', { name: 'Reasoning effort' })).toBeNull();
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('slider', { name: 'Reasoning effort' })).toBeInTheDocument();
  });

  it('renders no reasoning control at all when the model offers none', () => {
    setup({ variant: 'bordered', effortOptions: [] });
    expect(screen.queryByRole('slider', { name: 'Reasoning effort' })).toBeNull();
  });

  it('reports the picked model', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Opus/ }));
    expect(onChange).toHaveBeenCalledWith('opus');
  });

  it('states the backend default rather than opening on nothing', () => {
    setup({ models: [], value: undefined, effortOptions: [] });
    expect(screen.getByRole('combobox')).toHaveTextContent('Backend default');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/panels/ModelPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `ModelPicker.tsx`. Move `PROVIDER_LABELS`, `modelLabel`, `modelPickerLabel`, `pickableModels`, `HARNESS_RANK` and `modelPickerOptions` over verbatim (keeping their doc comments), then add:

```tsx
/** The reasoning ladder plus its three end captions — the block that rides either the
 *  popover footer (chip) or the surface itself (bordered). One renderer, so the two
 *  surfaces cannot drift apart. */
function EffortLadder({
  options,
  value,
  onChange,
  ground,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  /** Which ground the ladder sits on, for the current-stop halo. */
  ground: 's2' | 's3';
}): React.JSX.Element {
  const current = options.find((o) => o.value === value);
  return (
    <div className={cx('flex flex-col gap-1', ground === 's3' ? 'px-3 pt-2 pb-3' : 'pb-0.5')}>
      <StepSlider
        stops={options.map((o) => o.value)}
        value={value}
        onChange={onChange}
        aria-label="Reasoning effort"
      />
      <div className="relative font-mono text-meta text-s7">
        <span className="absolute left-0">{options[0]?.label}</span>
        <span className="block text-center text-s9">{current?.label ?? value}</span>
        <span className="absolute right-0">{options[options.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export function ModelPicker({
  models,
  value,
  onChange,
  effortOptions,
  effortValue,
  onEffortChange,
  variant,
  disabled = false,
}: ModelPickerProps): React.JSX.Element {
  const options = modelPickerOptions(models, value);
  const current = options.find((o) => o.value === (value ?? ''));
  const effort = effortOptions.find((o) => o.value === effortValue);
  // The chip trigger names the stop because its ladder is hidden in the popover; the
  // bordered trigger does not, because the ladder beneath it already reports the stop
  // and saying it twice is noise.
  const label =
    variant === 'chip' && effort !== undefined
      ? `${current?.label ?? value ?? ''} · ${effort.label}`
      : (current?.label ?? value ?? '');
  const hasEffort = effortOptions.length > 0;
  return (
    <div className="flex flex-col gap-1">
      <Combobox
        aria-label="Model"
        placeholder="Filter models…"
        value={value ?? options[0]?.value ?? ''}
        options={options}
        disabled={disabled}
        triggerLabel={label}
        variant={variant}
        onChange={(id) => {
          // The empty-list "Backend default" row is a statement, not a value.
          if (id !== '') onChange(id);
        }}
        {...(variant === 'chip' && hasEffort
          ? {
              footer: (
                <EffortLadder
                  options={effortOptions}
                  value={effortValue}
                  onChange={onEffortChange}
                  ground="s3"
                />
              ),
            }
          : {})}
      />
      {variant === 'bordered' && hasEffort && (
        <EffortLadder
          options={effortOptions}
          value={effortValue}
          onChange={onEffortChange}
          ground="s2"
        />
      )}
    </div>
  );
}
```

This needs two further `Combobox` props — add them in this task, with tests, in `packages/console-kit/src/inputs/Combobox.tsx`:

```ts
  /** Override the trigger's text. Defaults to the selected option's label. The model
   *  picker uses it to append the reasoning stop on its compact variant. */
  triggerLabel?: string;
  /** chip: the composer shelf's borderless chip. bordered: the default. */
  variant?: 'chip' | 'bordered';
```

Trigger className, replacing the current single expression:

```tsx
          className={cx(
            variant === 'chip'
              ? 'flex-none rounded-r2 px-2 py-1 font-mono text-meta'
              : 'flex-none rounded-r1 border px-2 py-[3px] font-mono text-code',
            disabled
              ? variant === 'chip'
                ? 'cursor-default text-s6'
                : 'cursor-default border-s4 text-s6'
              : cx(
                  'slip slip-press cursor-pointer active:scale-[0.97]',
                  variant === 'chip'
                    ? open
                      ? 'bg-s4 text-s11'
                      : 'text-s9 hover:bg-s4 hover:text-s11'
                    : open
                      ? 'border-s5 text-s11'
                      : 'border-s4 text-s9 hover:border-s5 hover:text-s11',
                ),
          )}
```

and the trigger content becomes `{triggerLabel ?? current} ▾`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/desktop/src/renderer/panels/ModelPicker.test.tsx packages/console-kit/src/inputs/Combobox.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/ModelPicker.tsx apps/desktop/src/renderer/panels/ModelPicker.test.tsx apps/desktop/src/renderer/panels/AgentsPanel.tsx packages/console-kit/src/inputs/Combobox.tsx packages/console-kit/src/inputs/Combobox.test.tsx
git commit -m "feat: give the console one model and effort picker"
```

---

## Task 3: The composer uses ModelPicker

**Files:**
- Modify: `apps/desktop/src/renderer/panels/Composer.tsx` (delete `ModelChip`, ~lines 570-643)
- Test: `apps/desktop/src/renderer/panels/Composer.test.tsx`

**Interfaces:**
- Consumes: `ModelPicker` (Task 2).
- Produces: no prop changes to `ComposerProps` — the existing `models`/`currentModelId`/`onPickModel`/`effortOptions`/`effortValue`/`onPickEffort` seam is exactly what `ModelPicker` needs. `ComposerProps.models` stays `{ id: string; label: string }[]`, so the composer maps it to `ModelDescriptor`-shaped options; keep that mapping local and typed.

- [ ] **Step 1: Write the failing test**

```tsx
it('filters the model list from the composer chip', async () => {
  const user = userEvent.setup();
  renderComposer({
    models: [
      { id: 'sonnet', label: 'Sonnet 4.6' },
      { id: 'opus', label: 'Opus 4.8' },
    ],
    currentModelId: 'sonnet',
  });
  await user.click(screen.getByRole('combobox', { name: 'Model' }));
  await user.type(screen.getByRole('textbox', { name: 'Filter models…' }), 'opus');
  expect(screen.queryByRole('option', { name: /Sonnet/ })).toBeNull();
  expect(screen.getByRole('option', { name: /Opus/ })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/desktop/src/renderer/panels/Composer.test.tsx -t "filters the model list"`
Expected: FAIL — no combobox; today's chip is a plain button over `MenuItem`s.

- [ ] **Step 3: Implement**

Delete `ModelChip` entirely. In the shelf, replace `<ModelChip … />` with:

```tsx
          <ModelPicker
            variant="chip"
            models={models.map((m) => ({ id: m.id, displayName: m.label }))}
            value={currentModelId}
            onChange={onPickModel}
            effortOptions={effortOptions}
            effortValue={effortValue}
            onEffortChange={onPickEffort}
            disabled={disabled}
          />
```

- [ ] **Step 4: Run the whole composer suite**

Run: `npx vitest run apps/desktop/src/renderer/panels/Composer.test.tsx`
Expected: PASS. Existing assertions that queried the old chip by its text label need re-pointing at `getByRole('combobox', { name: 'Model' })`; update them, do not delete them.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/Composer.tsx apps/desktop/src/renderer/panels/Composer.test.tsx
git commit -m "feat: make the composer's model chip filterable"
```

---

## Task 4: RunsOnField uses ModelPicker

**Files:**
- Modify: `apps/desktop/src/renderer/panels/AgentsPanel.tsx` (`RunsOnField`, ~lines 623-692)
- Test: `apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`

**Interfaces:**
- Consumes: `ModelPicker` (Task 2), `clampReasoning` (unchanged, stays in `AgentsPanel.tsx`).
- Produces: `RunsOnField` keeps its existing props and `onChange` patch contract exactly.

- [ ] **Step 1: Write the failing test**

```tsx
it('keeps the reasoning ladder visible on the agent editor', () => {
  renderAgents();
  expect(screen.getByRole('slider', { name: 'Reasoning effort' })).toBeInTheDocument();
});

it('does not repeat the effort on the editor trigger', () => {
  renderAgents();
  expect(screen.getByRole('combobox', { name: 'Model' })).not.toHaveTextContent('·');
});
```

- [ ] **Step 2: Run to verify the second fails**

Run: `npx vitest run apps/desktop/src/renderer/panels/AgentsPanel.test.tsx -t "effort on the editor trigger"`
Expected: FAIL — today's trigger renders the raw `Combobox` label, and the ladder is hand-rolled beside it.

- [ ] **Step 3: Implement**

`RunsOnField`'s body becomes the harness mark plus one `ModelPicker`; delete the hand-rolled `StepSlider` block and its three-caption row.

```tsx
  return (
    <div className="flex items-start gap-2">
      <Tooltip label={harnessBlurb(harness)} side="top">
        <span tabIndex={0} className="slip mt-0.5 flex flex-none rounded-r1">
          <BrandMark spec={mark} size={16} />
        </span>
      </Tooltip>
      <ModelPicker
        variant="bordered"
        models={models}
        value={agent.model}
        effortOptions={reasoningOptions}
        effortValue={reasoningVal}
        onEffortChange={(v) => onChange({ reasoning: toReasoning(v) })}
        onChange={(model) => {
          const picked = models.find((m) => m.id === model);
          const clamped = clampReasoning(agent.reasoning, picked);
          onChange({
            model,
            ...(picked?.provider !== undefined ? { provider: picked.provider } : {}),
            ...(clamped !== agent.reasoning ? { reasoning: clamped } : {}),
          });
        }}
      />
    </div>
  );
```

- [ ] **Step 4: Run**

Run: `npx vitest run apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/AgentsPanel.tsx apps/desktop/src/renderer/panels/AgentsPanel.test.tsx
git commit -m "refactor: build the agent's model field from the shared picker"
```

---

## Task 5: The Panel primitive

**Files:**
- Create: `apps/desktop/src/renderer/panels/Panel.tsx`
- Create: `apps/desktop/src/renderer/panels/Panel.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export interface PanelProps {
  label: string;
  /** Trailing fact in the header. A node, so a compound count ("6 tools") wears the
   *  same header. Omit entirely when a count would mislead. Zero renders nothing. */
  count?: React.ReactNode;
  /** Rendered on its own hairline beneath the body — the AddPicker trigger's home. */
  footer?: React.ReactNode;
  /** Body padding. 'rows' for a row list (tight, the rows carry their own padding),
   *  'prose' for free content. */
  density?: 'rows' | 'prose';
  children: React.ReactNode;
}
export function Panel(props: PanelProps): React.JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel.js';

describe('Panel', () => {
  it('names itself as a region', () => {
    render(<Panel label="Context">rows</Panel>);
    expect(screen.getByRole('region', { name: 'Context' })).toBeInTheDocument();
  });

  it('renders a count when given one', () => {
    render(<Panel label="Reach" count="6 tools">pills</Panel>);
    expect(screen.getByText('6 tools')).toBeInTheDocument();
  });

  it('renders nothing for an omitted count', () => {
    render(<Panel label="Runs on">field</Panel>);
    expect(screen.getByRole('region', { name: 'Runs on' })).toHaveTextContent(/^Runs onfield$/);
  });

  it('renders no footer hairline without a footer', () => {
    const { container } = render(<Panel label="Runs on">field</Panel>);
    expect(container.querySelector('[data-panel-footer]')).toBeNull();
  });

  it('renders the footer when given one', () => {
    render(<Panel label="Roles" footer={<button type="button">Add Role</button>}>rows</Panel>);
    expect(screen.getByRole('button', { name: 'Add Role' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/panels/Panel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { cx } from '@coa/console-kit';

/**
 * A contained region on the console's in-flow elevation — s2 ground, s4 hairline, r3,
 * NO shadow (docs/UI.md, elevation grounds). Deliberately not a card: it never floats,
 * never carries a drop shadow, and is never nested. The agent editor was the one console
 * surface whose content sat directly on the raw canvas; this is what gives it the same
 * containment the composer and the usage tiles already have.
 *
 * App-level rather than a kit member, on the `fields.tsx`/`resolvedSet.tsx` precedent:
 * it earns the kit only once a surface outside this one needs it.
 */
export function Panel({
  label,
  count,
  footer,
  density = 'rows',
  children,
}: PanelProps): React.JSX.Element {
  return (
    <div
      role="region"
      aria-label={label}
      className="flex flex-col overflow-hidden rounded-r3 border border-s4 bg-s2"
    >
      <div className="flex items-center justify-between gap-2.5 border-b border-s4 px-3 py-1.5">
        <span className="text-caption text-s9">{label}</span>
        {count !== undefined && <span className="font-mono text-meta text-s7">{count}</span>}
      </div>
      <div className={cx(density === 'rows' ? 'p-1.5' : 'px-3 py-2.5')}>{children}</div>
      {footer !== undefined && (
        <div data-panel-footer className="border-t border-s4 p-1.5">
          {footer}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run**

Run: `npx vitest run apps/desktop/src/renderer/panels/Panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/Panel.tsx apps/desktop/src/renderer/panels/Panel.test.tsx
git commit -m "feat: add a contained region for in-flow console sections"
```

---

## Task 6: The agent editor becomes a mirrored panel grid

**Files:**
- Modify: `apps/desktop/src/renderer/panels/AgentsPanel.tsx` (`SectionHeader` deleted; `RolesSection`, `ContextSection`, `ReachSection`, `AgentEditor`)
- Modify: `docs/UI.md`
- Test: `apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`

**Interfaces:**
- Consumes: `Panel` (Task 5), `ModelPicker` (Task 4).
- Produces: `AgentEditor` keeps its signature. `SectionHeader` is deleted — `Panel`'s header replaces it.

- [ ] **Step 1: Write the failing tests**

```tsx
it('contains each concern in its own named region', () => {
  renderAgents();
  for (const name of ['Runs on', 'Roles', 'Context', 'Reach']) {
    expect(screen.getByRole('region', { name })).toBeInTheDocument();
  }
});

it('lays the row list out to fill the width it is given', () => {
  const { container } = renderAgents();
  const grid = container.querySelector('[data-row-grid]');
  expect(grid?.className).toContain('auto-fit');
});

it('keeps an excluded package visible in the agent, ordered last', () => {
  renderAgents();
  const rows = screen.getAllByRole('checkbox');
  const names = rows.map((r) => r.getAttribute('aria-label'));
  expect(names).toContain('web-search');
  expect(names.indexOf('web-search')).toBe(names.length - 1);
});
```

- [ ] **Step 2: Run to verify the first two fail**

Run: `npx vitest run apps/desktop/src/renderer/panels/AgentsPanel.test.tsx -t "own named region"`
Expected: FAIL — no regions exist; only `Reach` has one today.

- [ ] **Step 3: Implement**

Delete `SectionHeader`. Wrap each section's content in `Panel`:

- `RolesSection` → `<Panel label="Roles" count={selected.length} footer={<AddPicker … />}>`, rows inside `<div data-row-grid className={ROW_GRID}>`.
- `ContextSection` → `<Panel label="Context" count={included.size} footer={<AddPicker … />}>`, same grid. The `InlineMessage` advisory moves inside the body, beneath the grid.
- `ReachSection` → `<Panel label="Reach" count={…} density="prose">`; the harness line and the "takes effect on the next message" prose both move inside it. Delete that paragraph from `AgentEditor`.
- `RunsOnField` → wrapped by `AgentEditor` in `<Panel label="Runs on" density="prose">`.

Add near the membership constants:

```tsx
/** The resolved-set row list fills the width it is given: at a wide pane a long package
 *  list reads as columns rather than as one stranded line each. `auto-fit` collapses to a
 *  single column with no breakpoint, so the narrow drill-down needs no special case. */
const ROW_GRID = 'grid grid-cols-[repeat(auto-fit,minmax(17rem,1fr))] gap-0.5';
```

`AgentEditor`'s layout, replacing the `max-w-160` / `max-w-md` pair:

```tsx
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-7">
      <div className="flex flex-col gap-3.5">
        {/* identity header — spans the whole measure, so the rule that introduces the
            content is never wider than the content (the 640-over-448 defect). */}
        <div className="flex items-start gap-3">…</div>
        <div className="border-t border-s3" />
        {/* The column gutter must read WIDER than the gap between stacked panels, or the
            grid collapses into one undifferentiated mesh. */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-3.5 lg:grid-cols-[16.5rem_minmax(0,1fr)]">
          …
        </div>
      </div>
    </div>
```

Order inside the grid: rail column (`Runs on`, `Reach`) first in the DOM, then the main column (`Roles`, `Context`). On one column that yields Runs on · Reach · Roles · Context, which is wrong for narrow — so instead emit the four panels as **direct grid children** with explicit placement, and let the single-column fallback order them Runs on · Roles · Context · Reach:

```tsx
<div className="grid grid-cols-1 gap-x-6 gap-y-3.5 lg:grid-cols-[16.5rem_minmax(0,1fr)]">
  <div className="flex flex-col gap-3.5 lg:col-start-1 lg:row-start-1">{/* Runs on */}</div>
  <div className="flex flex-col gap-3.5 lg:col-start-2 lg:row-start-1 lg:row-span-2">
    {/* Roles, Context */}
  </div>
  <div className="flex flex-col gap-3.5 lg:col-start-1 lg:row-start-2">{/* Reach */}</div>
</div>
```

The `lg:` breakpoint is not the pane measurement — `AGENTS_NARROW_PX` already drives the drill-down via `useNarrow`. Use the measured `narrow` flag instead of a media query: pass it into `AgentEditor` and switch the grid classes on it, so the editor responds to the **pane**, not the window.

Other vocabulary corrections in this task:
- `AddPicker`'s trigger className becomes `slip slip-press w-fit cursor-pointer rounded-r2 border border-s5 bg-s4 px-2 py-1 font-mono text-code text-s9 hover:bg-s5 hover:text-s12 active:scale-[0.97]` and its label gains a leading `+ ` at the call sites (`+ Add Role`, `+ Add Context` — Title Case commands).
- Reach's `Pill` usage becomes the well treatment: `rounded-r1 border border-s5 bg-s1 px-1.5 py-0.5 font-mono text-meta text-s9`. Keep `Pill` itself for the scope marker.

- [ ] **Step 4: Run**

Run: `npx vitest run apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update docs/UI.md**

Under "Design laws", extend the elevation-grounds bullet with the panel usage so the rule and its one in-repo consumer stay together. One sentence, no code.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/panels/AgentsPanel.tsx apps/desktop/src/renderer/panels/AgentsPanel.test.tsx docs/UI.md
git commit -m "feat: contain the agent editor's sections and fill the pane"
```

---

## Task 7: The filter moves onto the list

**Files:**
- Modify: `apps/desktop/src/renderer/panels/AgentsPanel.tsx` (`AgentsStrip`, `AgentList`)
- Test: `apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`

**Interfaces:**
- Consumes: `useAgentsUi` (`query`, `setQuery`, `filterFocus`, `narrow`, `open`) — unchanged.
- Produces: `AgentList` gains no new props; it reads `useAgentsUi` directly for the filter, exactly as the strip does today.

- [ ] **Step 1: Write the failing tests**

```tsx
it('puts the filter on the list, not in the title bar', () => {
  renderAgentsWithStrip();
  const strip = screen.getByTestId('agents-strip');
  expect(within(strip).queryByRole('searchbox', { name: 'Filter agents' })).toBeNull();
  expect(screen.getByRole('searchbox', { name: 'Filter agents' })).toBeInTheDocument();
});

it('keeps New Agent reachable inside the drill-down', () => {
  renderAgentsWithStrip({ narrow: true, open: true });
  expect(screen.getByRole('button', { name: '+ New Agent' })).toBeInTheDocument();
});

it('drops the filter in the drill-down, where there is no list', () => {
  renderAgentsWithStrip({ narrow: true, open: true });
  expect(screen.queryByRole('searchbox', { name: 'Filter agents' })).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/panels/AgentsPanel.test.tsx -t "filter on the list"`
Expected: FAIL — the input is in the strip; `+ New Agent` unmounts when `drilledOpen`.

- [ ] **Step 3: Implement**

In `AgentsStrip`: delete the `<input type="search">` and its `filterRef`/`useEffect`. Change the render guard so **only the filter** was conditional — `+ New Agent` moves outside the `!drilledOpen` check and always renders.

In `AgentList`, above the scroll container:

```tsx
      <div
        className={cx(
          'border-b border-s3 px-5 pt-3 pb-2.5',
          narrow && 'flex justify-center',
        )}
      >
        <div className={cx('relative', narrow ? 'w-full max-w-80' : 'w-full')}>
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 font-mono text-code text-s7"
          >
            ⌕
          </span>
          <input
            ref={filterRef}
            type="search"
            role="searchbox"
            aria-label="Filter agents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter agents…"
            className={cx(TEXT_INPUT_CLASS, 'w-full pl-6')}
          />
        </div>
      </div>
```

Move the `filterFocus` effect here verbatim; the nonce contract is unchanged, so the `filter-agents` command and its registry guard test keep passing untouched.

`AgentList`'s outer element loses `overflow-y-auto` (it now holds a fixed head plus a scrolling body); wrap the groups in a `min-h-0 flex-1 overflow-y-auto px-5 pt-1.5 pb-5` div.

- [ ] **Step 4: Run**

Run: `npx vitest run apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/AgentsPanel.tsx apps/desktop/src/renderer/panels/AgentsPanel.test.tsx
git commit -m "feat: dock the agent filter to the list it filters"
```

---

## Task 8: One metric for the name, in both faces

**Files:**
- Modify: `apps/desktop/src/renderer/panels/fields.tsx`
- Modify: `apps/desktop/src/renderer/panels/AgentsPanel.tsx` (`InlineEditName`)
- Test: `apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `TextInput` gains `skin?: string` — when present it **replaces** `TEXT_INPUT_CLASS` instead of appending. Existing callers pass nothing and are unaffected.

- [ ] **Step 1: Write the failing test**

```tsx
it('renames in the same face it displays', async () => {
  const user = userEvent.setup();
  renderAgents();
  const display = screen.getByRole('button', { name: /^Rename Agent name/ });
  const displayClass = display.querySelector('span')?.className ?? '';
  await user.click(display);
  const field = screen.getByRole('textbox', { name: 'Agent name' });
  // The edit face must not fall back to the mono/code input skin.
  expect(field.className).not.toContain('font-mono');
  expect(field.className).not.toContain('text-code');
  // Both faces are the same size and weight.
  expect(displayClass).toContain('text-body');
  expect(field.className).toContain('text-body');
  expect(field.className).toContain('font-semibold');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/desktop/src/renderer/panels/AgentsPanel.test.tsx -t "same face it displays"`
Expected: FAIL — the field carries `font-mono text-code` from `TEXT_INPUT_CLASS`, and both faces carry the non-existent `text-heading`.

- [ ] **Step 3: Implement**

In `fields.tsx`, add the prop and change the final className:

```tsx
  /** Replaces the shared input skin outright. Appending cannot win on font-family, so a
   *  field that must match a NON-input face (the agent name's inline edit) swaps the whole
   *  skin rather than layering on top of it. */
  skin?: string;
```
```tsx
      className={cx(skin ?? TEXT_INPUT_CLASS, className)}
```

In `AgentsPanel.tsx`, define the shared face above `InlineEditName` and use it in both branches:

```tsx
/** ONE metric for the agent name, worn by both faces: same size, weight, line-height,
 *  padding and border box. The display face just wears a transparent border and no
 *  ground, so clicking into the field moves nothing. (The previous `text-heading` was not
 *  a token at all — the ramp is body/sec/code/meta/caps/icon — so the two faces fell back
 *  to different families at different sizes.) */
const NAME_FACE =
  'w-fit min-w-0 rounded-r2 border px-1.5 py-0.5 text-body leading-5 font-semibold text-s12';
```

Edit branch: `<TextInput … skin={cx(NAME_FACE, 'slip border-s5 bg-s1 outline-none focus:border-s7')} />`.
Display branch: `className={cx(NAME_FACE, 'slip group -mx-1.5 inline-flex cursor-pointer items-center gap-2 border-transparent text-left hover:bg-s2')}`, with the inner span reduced to `truncate` (it no longer needs its own size/weight/colour).

- [ ] **Step 4: Run**

Run: `npx vitest run apps/desktop/src/renderer/panels/AgentsPanel.test.tsx apps/desktop/src/renderer/panels/AuthPanel.test.tsx apps/desktop/src/renderer/panels/LoginFlow.test.tsx apps/desktop/src/renderer/panels/ModelEditor.test.tsx`
Expected: PASS — the other three `TextInput` consumers must be unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/fields.tsx apps/desktop/src/renderer/panels/AgentsPanel.tsx apps/desktop/src/renderer/panels/AgentsPanel.test.tsx
git commit -m "fix: rename an agent in the face it is displayed in"
```

---

## Task 9: The pinned indicator becomes the pin control

**Files:**
- Modify: `apps/desktop/src/renderer/panels/AgentsPanel.tsx` (`AgentEditor` header)
- Test: `apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`

**Interfaces:**
- Consumes: `vm.togglePinAgent`, `vm.pinned` — unchanged.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

```tsx
it('offers the pin as a control, pressed when pinned', async () => {
  const user = userEvent.setup();
  const { togglePinAgent } = renderAgents({ pinned: ['roles/reviewer'] });
  const pin = screen.getByRole('button', { name: 'Unpin agent' });
  expect(pin).toHaveAttribute('aria-pressed', 'true');
  await user.click(pin);
  expect(togglePinAgent).toHaveBeenCalledWith('roles/reviewer');
});

it('still offers the control when the agent is not pinned', () => {
  renderAgents({ pinned: [] });
  expect(screen.getByRole('button', { name: 'Pin agent' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

it('no longer renders a pinned pill', () => {
  renderAgents({ pinned: ['roles/reviewer'] });
  expect(screen.queryByText('Pinned')).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/panels/AgentsPanel.test.tsx -t "pin"`
Expected: FAIL — today there is a `Pinned` `Pill` and no pin button.

- [ ] **Step 3: Implement**

Delete `{pinned && <Pill tone="info">Pinned</Pill>}` from the meta row. Wrap the header's trailing controls in a cluster and add the toggle before `RowMenu`:

```tsx
          <div className="flex flex-none items-center gap-0.5">
            <Tooltip label={pinned ? 'Unpin agent' : 'Pin agent'} side="top">
              <button
                type="button"
                aria-label={pinned ? 'Unpin agent' : 'Pin agent'}
                aria-pressed={pinned}
                onClick={() => vm.togglePinAgent(a.ref)}
                className={cx(
                  'slip slip-press flex h-6 w-6 cursor-pointer items-center justify-center rounded-r2 hover:bg-s4 active:scale-[0.95]',
                  pinned ? 'text-s11 hover:text-s12' : 'text-s7 hover:text-s11',
                )}
              >
                <Icon name={pinned ? 'pin-off' : 'pin'} size="sm" />
              </button>
            </Tooltip>
            <RowMenu label="Agent actions">…</RowMenu>
          </div>
```

If the kit's `Icon` registry has no `pin`/`pin-off` entry, add them (lucide `Pin` / `PinOff`) to `packages/console-kit/src/data/Icon.tsx` in this task — a drawn mark is correct here, since an icon-only control carries the whole meaning alone.

Keep `Pin` / `Unpin` in the `RowMenu` as the discoverable path.

- [ ] **Step 4: Run**

Run: `npx vitest run apps/desktop/src/renderer/panels/AgentsPanel.test.tsx packages/console-kit`
Expected: PASS. The kit's showcase test enumerates registered members — if `Icon` gained names, the showcase specimen list may need the new names added.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/AgentsPanel.tsx apps/desktop/src/renderer/panels/AgentsPanel.test.tsx packages/console-kit/src/data/Icon.tsx
git commit -m "feat: make the pinned marker the pin control"
```

---

## Task 10: Notices gain a summary, an order, and a cache key

**Files:**
- Modify: `apps/desktop/src/renderer/panels/banners.ts`
- Test: `apps/desktop/src/renderer/panels/banners.test.ts`

**Interfaces:**
- Consumes: `Banner` from `@coa/console-viewmodel` (unchanged — the summary is a console-local extension, so the M0 wire schema is not touched).
- Produces:

```ts
export interface ChatNotice extends Banner {
  /** One clause naming the state, permanently visible. `reason` keeps the full
   *  explanation and stays proximity detail. */
  summary: string;
}
export function cacheKey(input: Pick<ChatBannerInput, 'override' | 'pinned'>): string;
export function computeChatBanners(input: ChatBannerInput): ChatNotice[];
// ChatBannerInput gains: dismissedCacheKey?: string | undefined;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('leads with the actionable notice', () => {
  const out = computeChatBanners({ …bothRaised });
  expect(out.map((b) => b.kind)).toEqual(['drift', 'cache']);
});

it('carries a short summary alongside the full reason', () => {
  const [cache] = computeChatBanners({ …modelChanged });
  expect(cache?.summary).toBe('The model changed.');
  expect(cache?.reason).toContain('cold prompt cache');
});

it('suppresses a dismissed cache notice until the pick changes', () => {
  const input = { …modelChanged };
  const key = cacheKey(input);
  expect(computeChatBanners({ ...input, dismissedCacheKey: key })).toEqual([]);
  const moved = { ...input, override: { model: 'other' } };
  expect(computeChatBanners({ ...moved, dismissedCacheKey: key })).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/panels/banners.test.ts`
Expected: FAIL — order is cache-first, `summary` and `cacheKey` do not exist.

- [ ] **Step 3: Implement**

- Add `summary` to `DRIFT_BANNER`: `'Roles changed after this prompt compiled.'`
- Change `cacheBanner(reasons)` to build a summary from the same reasons array, capital-first with a terminal period (it is prose): `'The backend changed.'` / `'The model changed.'` / `'The session has been idle.'`, joined with `' '` when both apply.
- Add `cacheKey`, a `JSON.stringify` over `{ provider, model, pinnedProvider, pinnedModel }`, so dismissing suppresses until the pick or the pin moves. Idle-only staleness is covered by the same key, which is intended: dismissing an idle warning should hold until something actually changes.
- Gate the cache push on `input.dismissedCacheKey !== cacheKey(input)`.
- **Push drift before cache.** Update the function's doc comment, which currently states the opposite order.

- [ ] **Step 4: Run**

Run: `npx vitest run apps/desktop/src/renderer/panels/banners.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/banners.ts apps/desktop/src/renderer/panels/banners.test.ts
git commit -m "feat: let a chat notice state its cause and be dismissed"
```

---

## Task 11: The console remembers a dismissed cache notice

**Files:**
- Modify: `apps/desktop/src/renderer/panels/state.ts` (~line 67, ~line 161)
- Modify: `apps/desktop/src/renderer/console.ts` (`onBannerAction`, ~line 561; vm assembly, ~line 325)
- Test: `apps/desktop/src/renderer/console.test.tsx`

**Interfaces:**
- Consumes: `cacheKey` (Task 10).
- Produces: `ConsoleState['ui'].dismissedCache: Record<string, string>`, defaulted `{}` in the initial state.

- [ ] **Step 1: Write the failing test**

```tsx
it('keeps a dismissed cache notice down until the pick moves', async () => {
  const c = await bootConsole();
  c.actions.setSessionModel('s1', { model: 'opus' });
  expect(chatVm(c).banners.some((b) => b.kind === 'cache')).toBe(true);
  c.actions.onBannerAction('s1', 'cache', 'dismiss');
  expect(chatVm(c).banners.some((b) => b.kind === 'cache')).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/desktop/src/renderer/console.test.tsx -t "dismissed cache"`
Expected: FAIL — `onBannerAction` ignores `bannerId === 'cache'`.

- [ ] **Step 3: Implement**

Add the field and its default in `state.ts`. In `onBannerAction`, add before the drift branches:

```ts
    if (bannerId === 'cache' && actionId === 'dismiss') {
      // The cache notice is DERIVED, so hiding it means remembering what it was raised
      // for; a later change to the pick or the pin is a new key and re-raises it.
      const session = sessions.find((s) => s.id === sessionId);
      const key = cacheKey({
        ...(state.ui.modelOverride[sessionId] !== undefined
          ? { override: state.ui.modelOverride[sessionId] }
          : {}),
        ...(session !== undefined
          ? {
              pinned: {
                ...(session.provider !== undefined ? { provider: session.provider } : {}),
                ...(session.model !== undefined ? { model: session.model } : {}),
              },
            }
          : {}),
      });
      state = {
        ...state,
        ui: { ...state.ui, dismissedCache: { ...state.ui.dismissedCache, [sessionId]: key } },
      };
      push();
      return;
    }
```

Feed it into the vm beside `dismissedDriftKey`:

```ts
    ...(activeSessionId !== undefined && state.ui.dismissedCache[activeSessionId] !== undefined
      ? { dismissedCacheKey: state.ui.dismissedCache[activeSessionId] }
      : {}),
```

Also extend the comment above `onBannerAction`, which currently says the console holds only "the model override and the per-session drift dismissal".

- [ ] **Step 4: Run**

Run: `npx vitest run apps/desktop/src/renderer/console.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/panels/state.ts apps/desktop/src/renderer/console.ts apps/desktop/src/renderer/console.test.tsx
git commit -m "feat: remember a dismissed prompt cache notice per session"
```

---

## Task 12: The notices merge into the composer

**Files:**
- Modify: `apps/desktop/src/renderer/panels/NoticeLine.tsx`
- Modify: `apps/desktop/src/renderer/panels/Composer.tsx`
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx` (~line 678)
- Modify: `docs/UI.md`
- Test: `apps/desktop/src/renderer/panels/NoticeLine.test.tsx`, `Composer.test.tsx`

**Interfaces:**
- Consumes: `ChatNotice` (Task 10).
- Produces: `ComposerProps` gains `notices?: ChatNotice[]` and `onNoticeAction?: (id: string, actionId: string) => void`. `NoticeLine` keeps its name and export but renders composer-internal sections rather than free-floating pills. `ChatPanel` stops passing notices through `above`; `above` keeps carrying the jump-to-latest pill only.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows the cause without hovering, and keeps the full reason on hover', () => {
  render(<NoticeLine notices={[DRIFT]} onAction={() => {}} />);
  expect(screen.getByText('Roles changed after this prompt compiled.')).toBeInTheDocument();
  expect(screen.queryByText(DRIFT.reason)).toBeNull();
});

it('offers dismiss on the passive cache notice', async () => {
  const user = userEvent.setup();
  const onAction = vi.fn();
  render(<NoticeLine notices={[CACHE]} onAction={onAction} />);
  await user.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onAction).toHaveBeenCalledWith('cache', 'dismiss');
});

it('does not claim the composer edge while a turn is running', () => {
  const { container } = renderComposer({ running: true, notices: [DRIFT] });
  expect(container.querySelector('[data-composer-shell]')?.className).toContain('border-run');
});

it('takes the warn edge only when the composer is otherwise idle', () => {
  const { container } = renderComposer({ running: false, notices: [DRIFT] });
  expect(container.querySelector('[data-composer-shell]')?.className).toContain('border-warn');
});
```

Note the existing test asserting the reason is ABSENT by default must be **inverted**, not deleted: the summary is now visible and the full `reason` is what stays behind proximity.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/desktop/src/renderer/panels/NoticeLine.test.tsx apps/desktop/src/renderer/panels/Composer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`NoticeLine` renders one section per notice — no outer `mb-1.5`, no rounded corners, no shadow; it lives inside the composer's rect:

```tsx
        <div
          key={n.id}
          data-notice-kind={n.kind}
          className={cx(
            'slip-enter flex items-center gap-2 border-b border-s4 px-3 py-1.5',
            n.kind === 'drift' ? 'bg-warn/7' : 'bg-warn/4',
          )}
        >
          <StatusDot status={DOT[n.kind]} />
          <span className="flex-none text-sec text-s11">{NAME[n.kind]}</span>
          <Tooltip label={n.reason} side="top">
            <span tabIndex={0} className="min-w-0 flex-1 truncate text-code text-s8">
              {n.summary}
            </span>
          </Tooltip>
          {n.actions?.map((a) => (
            <Button key={a.id} onClick={() => onAction(n.id, a.id)}>
              {a.label}
            </Button>
          ))}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => onAction(n.id, 'dismiss')}
            className="slip flex-none cursor-pointer text-s7 hover:text-s10"
          >
            <Icon name="close" />
          </button>
        </div>
```

Both kinds are now dismissable, so the `n.kind === 'drift'` guard on the dismiss button goes away.

In `Composer`, render `<NoticeLine …/>` as the **first child of the shell**, above the approval gate. Add `data-composer-shell` to the shell div and extend its border expression so a notice contributes only at idle:

```tsx
          disabled
            ? 'border-s4'
            : edge === 'running'
              ? 'border-run/55'
              : edge === 'needs-you'
                ? 'border-warn/55'
                : notices.length > 0
                  ? 'border-warn/55'
                  : 'border-s5 focus-within:border-s6',
```

`edge` itself is unchanged, so the shimmer never fires for a notice.

In `ChatPanel`, pass `notices={vm.banners}` and `onNoticeAction={vm.onBannerAction}` to `Composer`; drop `NoticeLine` from the `above` prop.

- [ ] **Step 4: Run**

Run: `npx vitest run apps/desktop/src/renderer/panels/NoticeLine.test.tsx apps/desktop/src/renderer/panels/Composer.test.tsx apps/desktop/src/renderer/panels/ChatPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update docs/UI.md**

The "Banners' function, not banners" bullet currently says notices are "docked to the surface they concern". Extend it to record that they are merged into the composer's rect, and add the **flagged deviation**: the notice's one-clause summary is permanently visible, against the indicator law's "detail is proximity", because the copy law's "at the moment it is load-bearing" wins for a warning that carries an action. Flag it as a decision, not an oversight — that is the repo's rule for deviations.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/panels/NoticeLine.tsx apps/desktop/src/renderer/panels/NoticeLine.test.tsx apps/desktop/src/renderer/panels/Composer.tsx apps/desktop/src/renderer/panels/Composer.test.tsx apps/desktop/src/renderer/panels/ChatPanel.tsx apps/desktop/src/renderer/panels/ChatPanel.test.tsx docs/UI.md
git commit -m "feat: merge the prompt notices into the composer"
```

---

## Task 13: Close out

**Files:**
- Modify: `apps/desktop/src/renderer/panels/ShowcasePanel.tsx` and its test, if the kit gained `Icon` names in Task 9.

- [ ] **Step 1: Full suite**

Run: `npx vitest run apps/desktop packages/console-kit`
Expected: PASS. Anything failing in `packages/adapter-deepseek` or `packages/adapter-longcat` is baseline and out of scope.

- [ ] **Step 2: Typecheck both targets**

Run: `pnpm -r --filter @coa/desktop --filter @coa/console-kit exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Format only touched files**

Run prettier over the explicit file list from the commits above. Do **not** run it over `panels/`.

- [ ] **Step 4: Confirm the maintainer's files are untouched**

Run: `git status --short`
Expected: `DEV-NOTES.md` still ` M` and unstaged; `docs/superpowers/specs/2026-07-31-…` still `??`.

- [ ] **Step 5: Hand back**

The surface has never been seen running. Report to the maintainer that a drive-the-app pass is required, naming the highest-risk unseen areas: `AddPicker`'s popover placement inside the now-scrolling panel body, the narrow drill-down, the panel grid's gutter rhythm at real contrast, and the merged notice's tint against the composer's ground.

---

## Self-Review

**Spec coverage.** §1 panels → Tasks 5, 6. §1 grid and narrow order → Task 6. §1 add-chip and reach pills → Task 6. §1 no layout animation → honoured (no task adds one). §2 filter → Task 7. §3 picker → Tasks 1, 2, 3, 4. §4 notices → Tasks 10, 11, 12. §5 rename → Task 8. §5 pin → Task 9. Verification → Task 13.

**Type consistency.** `ChatNotice` is produced in Task 10 and consumed in Tasks 11 and 12. `ModelPickerProps` is produced in Task 2 and consumed in Tasks 3 and 4. `PanelProps` is produced in Task 5 and consumed in Task 6. `TextInput.skin` is produced and consumed within Task 8. `Combobox.footer` / `triggerLabel` / `variant` are produced in Tasks 1 and 2 and consumed in Task 2.

**Known risk carried forward.** Task 6 moves the row lists into a scrolling panel body; `AddPicker` renders a `PopoverCard` from inside it. The kit's popover already portals and repositions on scroll, so this should hold, but it is the single most likely thing to be visibly wrong on first launch and Task 13 names it explicitly.
