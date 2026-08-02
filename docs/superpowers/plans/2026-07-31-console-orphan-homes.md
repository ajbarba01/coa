# Console Orphan Homes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rehouse every console feature the new IA has not yet given a real home, retire the prototype app, and close the workbench rebuild arc.

**Architecture:** The agents surface is rebuilt as master–detail on `@coa/console-kit`, mirroring the `auth` surface's structure (list pane, cross-faded detail, narrow drill-down, title-strip furniture). Its composition model is a *resolved set*: a shared row vocabulary where the control mark states how an item got in (added / inherited / available / excluded), reusing the existing `includedPackageIds` + `togglePackage` resolver rather than replacing it. Everything else in the plan is a conversion or a close-out chore.

**Tech Stack:** TypeScript strict, React 19, Tailwind v4 (semantic tokens only), Base UI primitives, Zustand for shell/UI stores, Vitest + Testing Library (jsdom), Electron.

**Spec:** [docs/superpowers/specs/2026-07-31-console-orphan-homes-design.md](../specs/2026-07-31-console-orphan-homes-design.md)

## Global Constraints

- **TypeScript `strict`, no `any`.** Validate external data at the edges with Zod.
- **No raw values in components.** Colour, space, radius, duration and z come from tokens. The one sanctioned raw px is a value that must match a main-process pixel, and it carries a comment saying so.
- **Build from the kit.** A new control is a kit member with its intent block (Intent / Use-it-when / Don't-use-it-when / Anatomy / Variants & States / Accessibility / Related), a registry entry, regenerated `COMPONENTS.md` (`pnpm --filter @coa/console-kit gen`, test-enforced), and a showcase specimen. A panel is kit composition plus a pure `selectVm`.
- **Every state ships:** default, hover, focus-visible, active, disabled, loading, empty, error. A disabled control shows no hover.
- **Copy law.** Commands are Title Case (`Add Context`), state labels and field names are sentence case (`No agents yet`), prose is sentence case with a terminal period, keycaps stay lowercase. No em dashes. An accessible name matches its visible label verbatim.
- **Indicator law.** State is a dot, magnitude is a count (zero renders nothing), text is for names, detail is proximity. Membership is *not* a status dot; it is the row's own control.
- **SC-1.** The console surfaces, it never denies. No new blocking path.
- **Keybinds are data.** A bind cannot exist outside `DEFAULT_KEYBINDS`, and a surface-local bind declares a `scope`.
- **Tests run from the repo root:** `npx vitest run <paths>`. `pnpm --filter … test` is a silent no-op.
- **Typecheck:** `npx tsc -b apps/desktop`, and `npx tsc -p packages/console-kit/tsconfig.json --noEmit` when the kit is touched.
- **Format and lint:** `npx prettier --write <files>` then `npx eslint <paths>`.
- **Commits are subject-only Conventional Commits.** No body, no trailers, no `Co-Authored-By`, no internal identifiers (no phase codes, no module IDs). Stage files by name; never `git add -A`.
- **Pre-existing baseline failures, do not chase:** `packages/adapter-deepseek` and `packages/adapter-longcat` fail ~10 adapter tests on `main`. `pnpm docs:check` currently fails on a gitignored `TEMP.md` at the repo root, which is the maintainer's file.

## Not in this plan

- **No skills section.** The designed shape is in the spec, but there is no skills data seam today (pieces are dropped from the role and package summaries, and no read serves them). Building it would mean rendering invented data, which is exactly the dishonesty this redesign removes. It lands with the declaration-plane widening.
- **No editable tool or MCP grants.** The Reach band is derived and read-only here.
- **No real project switching**, no account management, no system-prompt viewer.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/console-kit/src/inputs/Combobox.tsx` | New kit member: a searchable select. Trigger, filter field, grouped options, keyboard contract. |
| `packages/console-kit/src/inputs/Combobox.intent.ts` | Its design contract. |
| `apps/desktop/src/renderer/panels/resolvedSet.tsx` | Shared app-level vocabulary for resolved sets: the membership mark, the row, and the pure classifier. |
| `apps/desktop/src/renderer/panels/AddPicker.tsx` | The sticky, anchored, multi-select add overlay. |
| `apps/desktop/src/renderer/panels/agentsUi.ts` | Agents-surface-local UI store: filter query, narrow flag. |
| `apps/desktop/src/renderer/panels/harness.ts` | Pure: model provider to harness identity, plus the coa mark spec. |
| `apps/desktop/src/renderer/panels/AgentsPanel.tsx` | Rewritten surface: `AgentsStrip`, `AgentsSurface`, list pane, detail, the pure `selectAgentsVm`. |
| `apps/desktop/src/renderer/panels/banners.ts` | Notice logic, kept; gains a "has run" guard. |
| `apps/desktop/src/renderer/panels/NoticeLine.tsx` | The composer-docked indicator line that replaces the banner strip. |
| `apps/desktop/src/renderer/panels/showcase/KitSpecimens.tsx` | The kit showcase, ported from the prototype. |
| `apps/desktop/src/renderer/shell/Nav.tsx` | Project dialog floor copy. |
| `apps/desktop/src/renderer/shell/Center.tsx` | Registers `AgentsStrip` in the title strip. |

---

### Task 1: Port the kit showcase into the console

The kit showcase lives only in the prototype while the console's showcase surface renders legacy-kit specimens. This lands first so every kit member added later in the plan has a home for its specimen.

**Files:**
- Create: `apps/desktop/src/renderer/panels/showcase/KitSpecimens.tsx`
- Modify: `apps/desktop/src/renderer/panels/ShowcasePanel.tsx`
- Test: `apps/desktop/src/renderer/panels/showcase/KitSpecimens.test.tsx`
- Read for reference: `apps/workbench-proto/src/Showcase.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `KitSpecimens` (a component rendering one `<section>` per kit member, each with `data-specimen="<registryId>"`), consumed by Task 2's specimen step.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { allIntents } from '@coa/console-kit';
import { KitSpecimens } from './KitSpecimens.js';

describe('KitSpecimens', () => {
  it('renders a specimen for every registered kit member', () => {
    const { container } = render(<KitSpecimens />);
    const shown = new Set(
      [...container.querySelectorAll('[data-specimen]')].map((el) =>
        el.getAttribute('data-specimen'),
      ),
    );
    const missing = allIntents.map((m) => m.name).filter((name) => !shown.has(name));
    expect(missing).toEqual([]);
  });
});
```

Verified: `packages/console-kit/package.json` exports only `.` and `./tokens.css`, and `src/registry.ts` exports `allIntents: ComponentIntent[]` but `src/index.ts` does not re-export it. So this task also adds `export { allIntents } from './registry.js';` to the kit's `index.ts`. Read `ComponentIntent` before writing the test and key the specimens on whatever field actually names a member (`name` above is the assumption to verify, not to trust).

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/desktop/src/renderer/panels/showcase/KitSpecimens.test.tsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Port the specimens**

Copy the specimen bodies from `apps/workbench-proto/src/Showcase.tsx` into `KitSpecimens.tsx`, wrapping each in a section that carries `data-specimen`, and rendering every state the intent block lists:

```tsx
function Specimen({ id, children }: { id: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section data-specimen={id} className="flex flex-col gap-2 border-b border-s3 py-4">
      <h3 className="font-mono text-caps tracking-[0.07em] text-s8 uppercase">{id}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run apps/desktop/src/renderer/panels/showcase/KitSpecimens.test.tsx`
Expected: PASS.

- [ ] **Step 5: Swap the surface and trim the legacy specimens**

In `ShowcasePanel.tsx`, render `KitSpecimens` first, then keep legacy specimens for only the `console-ui` components still shipping in chat: `Transcript`, `Toast`, `ToastProvider`, `PaneOverlayProvider`, `Banner`, `Button`, `InlineMessage`. Delete the rest, and delete any now-unreferenced files under `panels/showcase/`.

- [ ] **Step 6: Verify the whole surface still renders**

Run: `npx vitest run apps/desktop/src/renderer/panels/ShowcasePanel.test.tsx apps/desktop/src/renderer/panels/showcase`
Expected: PASS. Fix assertions that referenced deleted specimens.

- [ ] **Step 7: Typecheck, format, lint**

```bash
npx tsc -b apps/desktop
npx prettier --write apps/desktop/src/renderer/panels/showcase apps/desktop/src/renderer/panels/ShowcasePanel.tsx
npx eslint apps/desktop/src/renderer/panels
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/panels/showcase apps/desktop/src/renderer/panels/ShowcasePanel.tsx
git commit -m "feat: render the kit's own specimens in the showcase surface"
```

---

### Task 2: Add a searchable Combobox to the kit

The model picker must filter as you type. The kit's `Select` is a Base UI select with typeahead, not a filter field, so this is a genuine missing primitive.

**Files:**
- Create: `packages/console-kit/src/inputs/Combobox.tsx`, `packages/console-kit/src/inputs/Combobox.intent.ts`, `packages/console-kit/src/inputs/Combobox.test.tsx`
- Modify: `packages/console-kit/src/index.ts`, `packages/console-kit/src/registry.ts`, `apps/desktop/src/renderer/panels/showcase/KitSpecimens.tsx`

**Interfaces:**
- Consumes: `KitSpecimens` from Task 1.
- Produces:
  ```ts
  export interface ComboboxOption { value: string; label: string; group?: string; leading?: React.ReactNode }
  export interface ComboboxProps {
    options: readonly ComboboxOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    'aria-label': string;
  }
  export function Combobox(props: ComboboxProps): React.JSX.Element;
  export function filterOptions(options: readonly ComboboxOption[], query: string): ComboboxOption[];
  ```
  Task 5 consumes both.

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Combobox, filterOptions, type ComboboxOption } from './Combobox.js';

const OPTIONS: ComboboxOption[] = [
  { value: 'opus-5', label: 'Claude · Opus 5', group: 'Claude Code' },
  { value: 'sonnet-5', label: 'Claude · Sonnet 5', group: 'Claude Code' },
  { value: 'ds-v4', label: 'DeepSeek · V4 Pro', group: 'coa scaffold' },
];

describe('filterOptions', () => {
  it('matches on label, case-insensitively', () => {
    expect(filterOptions(OPTIONS, 'opus').map((o) => o.value)).toEqual(['opus-5']);
  });

  it('matches on group so a harness name finds its models', () => {
    expect(filterOptions(OPTIONS, 'scaffold').map((o) => o.value)).toEqual(['ds-v4']);
  });

  it('returns everything for an empty query', () => {
    expect(filterOptions(OPTIONS, '   ')).toHaveLength(3);
  });
});

describe('Combobox', () => {
  it('shows the selected option label on the trigger', () => {
    render(
      <Combobox
        options={OPTIONS}
        value="ds-v4"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('DeepSeek · V4 Pro');
  });

  it('filters as you type and selects with enter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={onChange}
        placeholder="Filter models…"
        aria-label="Model"
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.type(screen.getByPlaceholderText('Filter models…'), 'deep');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('ds-v4');
  });

  it('says so when nothing matches instead of showing an empty popup', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value="opus-5"
        onChange={() => {}}
        placeholder="Filter models…"
        aria-label="Model"
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.type(screen.getByPlaceholderText('Filter models…'), 'zzz');
    expect(screen.getByText('No match')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run packages/console-kit/src/inputs/Combobox.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Build on `PopoverCard` for the floating list so it rides the kit's single Escape authority and the one-open-popover registry. Requirements the tests pin: trigger is `role="combobox"` carrying the resolved label and `aria-expanded`; opening focuses the filter input; options are `role="option"` inside `role="listbox"`; `ArrowUp`/`ArrowDown` move a cursor, `Enter` selects the cursor, `Escape` closes; group headers render when an option carries `group` and its neighbours differ; the selected row wears the s4 tint and a trailing mono `Current`; a no-match state renders the words `No match`. Keep the filter pure by delegating to `filterOptions`.

```ts
export function filterOptions(
  options: readonly ComboboxOption[],
  query: string,
): ComboboxOption[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...options];
  return options.filter(
    (o) => o.label.toLowerCase().includes(q) || (o.group?.toLowerCase().includes(q) ?? false),
  );
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run packages/console-kit/src/inputs/Combobox.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the intent block and register it**

`Combobox.intent.ts` carries all seven required headings. Use-it-when: a set too long to scan, where the value is one choice. Don't-use-it-when: fewer than about seven fixed options (use `Select`), or the choice is set membership (use the resolved-set row). Then add the export to `src/index.ts`, the entry to `src/registry.ts`, and a specimen to `KitSpecimens.tsx` rendering default, open, filtered, no-match and disabled.

- [ ] **Step 6: Regenerate the component doc and verify**

```bash
pnpm --filter @coa/console-kit gen
npx vitest run packages/console-kit/src/registry.test.ts apps/desktop/src/renderer/panels/showcase/KitSpecimens.test.tsx
npx tsc -p packages/console-kit/tsconfig.json --noEmit
```
Expected: PASS on both suites.

- [ ] **Step 7: Format, lint, commit**

```bash
npx prettier --write packages/console-kit/src/inputs apps/desktop/src/renderer/panels/showcase
npx eslint packages/console-kit/src apps/desktop/src/renderer/panels
git add packages/console-kit/src packages/console-kit/COMPONENTS.md apps/desktop/src/renderer/panels/showcase
git commit -m "feat: add a searchable combobox to the kit"
```

---

### Task 3: The resolved-set vocabulary

One row grammar for roles and context (and, later, everything the declaration plane adds). The existing resolver is reused, not replaced.

**Files:**
- Create: `apps/desktop/src/renderer/panels/resolvedSet.tsx`, `apps/desktop/src/renderer/panels/resolvedSet.test.tsx`
- Read for reference: `apps/desktop/src/renderer/panels/AgentsPanel.tsx` (`includedPackageIds`, `togglePackage`)

**Interfaces:**
- Consumes: `includedPackageIds`, `togglePackage` (existing, currently exported from `AgentsPanel.tsx`; Task 4 moves them here unchanged).
- Produces:
  ```ts
  export type Membership = 'added' | 'inherited' | 'available' | 'excluded';
  export function packageMembership(
    packages: PackageSummary[], roles: RoleSummary[],
    agent: Pick<AgentSummary, 'packageIds' | 'exclude'>, id: string,
  ): Membership;
  export function membershipSource(
    packages: PackageSummary[], roles: RoleSummary[], id: string,
  ): string | undefined;
  export function SetBox({ membership }: { membership: Membership }): React.JSX.Element;
  export interface SetRowProps {
    name: string; description?: string; membership: Membership;
    meta?: string; onToggle: () => void;
  }
  export function SetRow(props: SetRowProps): React.JSX.Element;
  ```
  Tasks 4, 6 and 7 consume these.

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentSummary, PackageSummary, RoleSummary } from '@coa/console-viewmodel';
import { SetRow, membershipSource, packageMembership } from './resolvedSet.js';

const PKGS: PackageSummary[] = [
  { id: 'core', name: 'Core', description: 'The floor.', inclusion: 'default', toolRefs: ['Read'] },
  { id: 'coding', name: 'Coding', description: 'Edits.', inclusion: 'opt-in', toolRefs: ['Edit'] },
  { id: 'research', name: 'Research', description: 'Search.', inclusion: 'opt-in', toolRefs: [] },
];
const ROLES: RoleSummary[] = [
  { id: 'swe', name: 'Software Engineer', description: 'Writes code.', packageIds: ['coding'] },
];
const agent = (p: Partial<AgentSummary>): Pick<AgentSummary, 'packageIds' | 'exclude'> => ({
  packageIds: p.packageIds ?? [],
  exclude: p.exclude ?? [],
});

describe('packageMembership', () => {
  it('calls a default inherited', () => {
    expect(packageMembership(PKGS, [], agent({}), 'core')).toBe('inherited');
  });

  it('calls a role-supplied package inherited', () => {
    expect(packageMembership(PKGS, ROLES, agent({}), 'coding')).toBe('inherited');
  });

  it('calls a user opt-in added', () => {
    expect(packageMembership(PKGS, [], agent({ packageIds: ['research'] }), 'research')).toBe(
      'added',
    );
  });

  it('calls an untouched opt-in available', () => {
    expect(packageMembership(PKGS, [], agent({}), 'research')).toBe('available');
  });

  it('calls a turned-off default excluded, not available', () => {
    expect(packageMembership(PKGS, [], agent({ exclude: ['core'] }), 'core')).toBe('excluded');
  });
});

describe('membershipSource', () => {
  it('names the role that brings a package', () => {
    expect(membershipSource(PKGS, ROLES, 'coding')).toBe('Software Engineer');
  });

  it('names a default as its own source', () => {
    expect(membershipSource(PKGS, ROLES, 'core')).toBe('default');
  });

  it('has no source for a package nothing brings', () => {
    expect(membershipSource(PKGS, ROLES, 'research')).toBeUndefined();
  });
});

describe('SetRow', () => {
  it('exposes membership through a checkbox a screen reader can read', () => {
    render(<SetRow name="Core" membership="inherited" meta="default" onToggle={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Core' });
    expect(box).toHaveAttribute('aria-checked', 'mixed');
  });

  it('reports an excluded row as unchecked and says so in its meta', () => {
    render(<SetRow name="Core" membership="excluded" meta="was default" onToggle={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Core' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('was default')).toBeInTheDocument();
  });

  it('toggles on click', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<SetRow name="Coding" membership="available" onToggle={onToggle} />);
    await user.click(screen.getByRole('checkbox', { name: 'Coding' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/desktop/src/renderer/panels/resolvedSet.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```tsx
export type Membership = 'added' | 'inherited' | 'available' | 'excluded';

/** How an id got into (or out of) the resolved set. `excluded` is the state today's flat
 *  checkboxes erase: a default or role-supplied item the user actively turned off reads
 *  identically to one they never wanted, which is the confusion this vocabulary removes. */
export function packageMembership(
  packages: PackageSummary[],
  roles: RoleSummary[],
  agent: Pick<AgentSummary, 'packageIds' | 'exclude'>,
  id: string,
): Membership {
  const included = includedPackageIds(packages, roles, agent);
  if (included.has(id)) return (agent.packageIds ?? []).includes(id) ? 'added' : 'inherited';
  return (agent.exclude ?? []).includes(id) ? 'excluded' : 'available';
}
```

`membershipSource` returns the first role whose `packageIds` contain the id, else `'default'` when the package's `inclusion` is `default`, else `undefined`.

`SetBox` renders a `<span>` with the four visual states; `SetRow` renders a `<button type="button" role="checkbox">` carrying `aria-checked` (`true` for added, `mixed` for inherited, `false` otherwise) and an accessible name equal to the visible name, with the description on a quiet second line and `meta` at the trailing edge. `inherited` and `added` rows sit on the s3 ground; `excluded` strikes the name; `available` is quiet. Hover, focus-visible and active states on every row; no hover when disabled.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run apps/desktop/src/renderer/panels/resolvedSet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add a specimen and verify**

Add a `KitSpecimens`-adjacent specimen section in `ShowcasePanel.tsx` (this is app-level, not a kit member, so it does not need a registry entry) rendering all four membership states plus hover and focus.

Run: `npx vitest run apps/desktop/src/renderer/panels`
Expected: PASS.

- [ ] **Step 6: Format, lint, commit**

```bash
npx prettier --write apps/desktop/src/renderer/panels
npx eslint apps/desktop/src/renderer/panels
git add apps/desktop/src/renderer/panels/resolvedSet.tsx apps/desktop/src/renderer/panels/resolvedSet.test.tsx apps/desktop/src/renderer/panels/ShowcasePanel.tsx
git commit -m "feat: give resolved sets one row vocabulary with visible provenance"
```

---

### Task 4: The agents surface shell

Master–detail, the title-strip filter, and the identity header, on the kit. The old `Pane` wrapper and the `SwitcherMenu` dropdown go away.

**Files:**
- Create: `apps/desktop/src/renderer/panels/agentsUi.ts`
- Modify: `apps/desktop/src/renderer/panels/AgentsPanel.tsx`, `apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`, `apps/desktop/src/renderer/shell/Center.tsx`, `apps/desktop/src/renderer/shell/keybinds.ts`
- Read for reference: `apps/desktop/src/renderer/panels/AuthPanel.tsx` lines 91-249 (strip, master–detail, narrow drill-down, dismiss layer)

**Interfaces:**
- Consumes: `SetRow`, `packageMembership`, `membershipSource` (Task 3); `SurfaceEmpty`, `SurfaceError`, `SkeletonLines` (existing `surfaceStates.tsx`); `useNarrow` (existing).
- Produces:
  ```ts
  export function AgentsStrip(): React.JSX.Element;      // consumed by Center.tsx
  export function AgentsSurface({ state }: { state: ConsoleState }): React.JSX.Element;
  export function matchesAgent(a: AgentSummary, query: string, roles: RoleSummary[]): boolean;
  export const useAgentsUi: /* zustand store */ { query: string; setQuery: (q: string) => void;
    narrow: boolean; setNarrow: (n: boolean) => void };
  ```
  Tasks 5, 6 and 7 fill the detail this task lays out. `includedPackageIds` and `togglePackage` move to `resolvedSet.ts` in this task, unchanged, with their existing tests moved alongside.

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AgentsStrip, AgentsSurface, matchesAgent, useAgentsUi } from './AgentsPanel.js';
import { makeState } from './fixtures.js';
import { MOCK_AGENTS } from './mockAgents.js';

const ready = () =>
  makeState({
    data: { agents: { status: 'ok', value: MOCK_AGENTS } },
    ui: { selectedAgentRef: MOCK_AGENTS[0]!.ref },
  });

describe('matchesAgent', () => {
  it('matches on the agent name', () => {
    expect(matchesAgent(MOCK_AGENTS[0]!, MOCK_AGENTS[0]!.name.slice(0, 3), [])).toBe(true);
  });

  it('matches on the model, so a backend name finds its agents', () => {
    const a = { ...MOCK_AGENTS[0]!, model: 'claude-opus-5' };
    expect(matchesAgent(a, 'opus', [])).toBe(true);
  });

  it('rejects a query that matches nothing', () => {
    expect(matchesAgent(MOCK_AGENTS[0]!, 'zzzz', [])).toBe(false);
  });
});

describe('AgentsSurface', () => {
  it('lists every agent beside the detail on a wide pane', () => {
    render(<AgentsSurface state={ready()} />);
    // Scope to the list: the selected agent's name also appears in the detail's editable
    // heading, and an unscoped exact-match query would collide with it. Do NOT resolve that
    // collision by changing what a row renders — the query is what needs to be precise.
    const list = screen.getByRole('list', { name: 'Agents' });
    for (const a of MOCK_AGENTS) expect(within(list).getByText(a.name)).toBeInTheDocument();
  });

  it('teaches the surface when there are no agents', () => {
    render(<AgentsSurface state={makeState({ data: { agents: { status: 'ok', value: [] } } })} />);
    expect(screen.getByText('No agents yet')).toBeInTheDocument();
  });

  it('surfaces a read failure as an alert', () => {
    render(
      <AgentsSurface
        state={makeState({ data: { agents: { status: 'error', message: 'daemon is down' } } })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('daemon is down');
  });

  it('filters the list from the strip query', async () => {
    useAgentsUi.setState({ query: '' });
    const user = userEvent.setup();
    render(
      <>
        <AgentsStrip />
        <AgentsSurface state={ready()} />
      </>,
    );
    await user.type(screen.getByRole('searchbox', { name: 'Filter agents' }), MOCK_AGENTS[0]!.name);
    expect(screen.getByText(MOCK_AGENTS[0]!.name)).toBeInTheDocument();
    expect(screen.queryByText(MOCK_AGENTS[1]!.name)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`
Expected: FAIL on the new cases.

- [ ] **Step 3: Build the store and the strip**

`agentsUi.ts` is a small zustand store holding `query` and `narrow`. `AgentsStrip` renders the filter field (`role="searchbox"`, accessible name `Filter agents`) plus a `New Agent` action, in the same title-strip slot `AuthStrip` occupies. On a narrow pane with an agent open it also renders the back control, mirroring auth.

- [ ] **Step 4: Rebuild the surface body**

Replace `<Pane title="Agents">` and the `SwitcherMenu` with: a list pane grouped Pinned / Project / Personal, filtered through `matchesAgent`; a detail region that cross-fades between agents; `useNarrow` at the same 640px breakpoint as auth, landing on the list when it becomes narrow and clearing the selection; `useDismissLayer` so Escape climbs out of the drill-down. Carry the identity header over unchanged in behaviour (icon and colour picker, inline-edit name, scope badge, ref, and the overflow menu with pin, duplicate, move and the typed-confirm delete), rebuilt on kit components and `panels/fields.tsx`.

- [ ] **Step 5: Move the resolver**

Move `includedPackageIds`, `togglePackage` and `packageAdvisories` from `AgentsPanel.tsx` into `resolvedSet.tsx` with no behaviour change, update imports, and move their existing tests into `resolvedSet.test.tsx`.

- [ ] **Step 6: Wire the strip and a scoped keybind**

In `Center.tsx`, render `<AgentsStrip />` for `surface === 'agents'` beside the existing `auth` and `usage` branches. Add to `DEFAULT_KEYBINDS`:

```ts
{ id: 'filter-agents', keys: ['ctrl', 'f'], label: 'Filter Agents', group: 'workbench', scope: 'agents' },
```

and extend `scopeOf` to return `'agents'` when `shell.surface === 'agents'` and no dialog is open, so the bind cannot reach across surfaces. Update the `Scope` type and `keybinds.test.ts` accordingly.

- [ ] **Step 7: Run the suites**

Run: `npx vitest run apps/desktop/src/renderer/panels apps/desktop/src/renderer/shell`
Expected: PASS. Reset `useAgentsUi` and `useShell` per test where a kept-alive surface would otherwise leak state.

- [ ] **Step 8: Typecheck, format, lint, commit**

```bash
npx tsc -b apps/desktop
npx prettier --write apps/desktop/src/renderer
npx eslint apps/desktop/src
git add apps/desktop/src/renderer/panels/AgentsPanel.tsx apps/desktop/src/renderer/panels/AgentsPanel.test.tsx apps/desktop/src/renderer/panels/agentsUi.ts apps/desktop/src/renderer/panels/resolvedSet.tsx apps/desktop/src/renderer/panels/resolvedSet.test.tsx apps/desktop/src/renderer/shell/Center.tsx apps/desktop/src/renderer/shell/keybinds.ts apps/desktop/src/renderer/shell/keybinds.test.ts
git commit -m "feat: rebuild the agents surface as master-detail with a filter"
```

- [ ] **Step 9: Show the maintainer**

Run the daemon and the app, open the agents surface, and confirm the list, the filter, the drill-down and the identity header read right before continuing.

```powershell
node "C:\Users\Zander\Documents\Side Projects\coa\apps\cli\dist\bin.js" serve
pnpm --filter @coa/desktop dev
```

---

### Task 5: Runs on — model, harness mark, reasoning ladder

**Files:**
- Create: `apps/desktop/src/renderer/panels/harness.ts`, `apps/desktop/src/renderer/panels/harness.test.ts`
- Modify: `apps/desktop/src/renderer/panels/AgentsPanel.tsx`, `apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`

**Interfaces:**
- Consumes: `Combobox`, `filterOptions` (Task 2); `StepSlider` (kit); `effortOptions`, `reasoningValue`, `toReasoning` (`@coa/console-viewmodel`); `CLAUDE_MARK` (`panels/providerMarks.ts`); `BrandMark` (kit).
- Produces:
  ```ts
  export type Harness = 'claude-code' | 'coa';
  export function harnessOf(provider: string | undefined): Harness;
  export function harnessLabel(h: Harness): string;      // 'Claude Code' | 'coa scaffold'
  export function harnessBlurb(h: Harness): string;      // the tooltip sentence
  export const COA_MARK: BrandMarkSpec;                  // monogram tile, no bundled path
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { harnessLabel, harnessOf } from './harness.js';

describe('harnessOf', () => {
  it('puts Claude models on the vendor harness coa layers onto', () => {
    expect(harnessOf('claude')).toBe('claude-code');
  });

  it('puts a pure-API backend on coa\u2019s own scaffold', () => {
    expect(harnessOf('deepseek')).toBe('coa');
    expect(harnessOf('longcat')).toBe('coa');
  });

  it('follows the runtime default when no provider is set', () => {
    expect(harnessOf(undefined)).toBe('claude-code');
  });

  it('labels each harness the way the dropdown groups them', () => {
    expect(harnessLabel('claude-code')).toBe('Claude Code');
    expect(harnessLabel('coa')).toBe('coa scaffold');
  });
});
```

```tsx
// appended to AgentsPanel.test.tsx
it('wears the reasoning ladder rather than a separate on/off control', () => {
  render(<AgentsSurface state={ready()} />);
  expect(screen.getByRole('slider', { name: 'Reasoning effort' })).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Reasoning' })).not.toBeInTheDocument();
});

it('offers the model list through one searchable control', () => {
  render(<AgentsSurface state={ready()} />);
  expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/desktop/src/renderer/panels/harness.test.ts apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the harness module**

```ts
/** Which harness actually runs an agent. Derived, never chosen: the Claude path layers coa's
 *  prompt onto the vendor's `claude_code` preset, while a pure-API backend gets no vendor
 *  frame at all, so coa supplies the whole thing. An unset provider mirrors the daemon's own
 *  `?? 'claude'` default (session.ts, prompt-freeze.ts, session-handlers.ts) — this line
 *  states what RUNS, so it has to resolve the default the same way the runtime does. */
export function harnessOf(provider: string | undefined): Harness {
  return provider === undefined || provider === 'claude' ? 'claude-code' : 'coa';
}
```

`COA_MARK` is a `BrandMarkSpec` with `monogram: 'c'` and no `paths`, so `BrandMark` draws its monogram tile.

- [ ] **Step 4: Build the cluster**

Replace the `Combobox`-from-`console-ui` model field and the whole bespoke reasoning control (`ReasoningField`, `SELECT_LABEL`, `reasoningToValue`) with:

- a kit `Combobox` whose options carry `group: harnessLabel(harnessOf(m.provider))` and `leading: <BrandMark spec={mark} size={15} />`, labelled by `modelPickerLabel`;
- a `StepSlider` fed by `effortOptions(selectedModel)`, valued by `reasoningValue`, writing through `toReasoning`, with `aria-label="Reasoning effort"` and no visible label, the current stop reading centred beneath it between the end captions.

No section heading and no field labels. The block is left-aligned and capped at the form width.

Delete `clampReasoning`'s budget branch along with the budget field, and delete its now-dead tests. Keep clamping across a model switch: when the newly selected model does not offer the current stop, fall back to the shared seam's first stop.

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run apps/desktop/src/renderer/panels`
Expected: PASS.

- [ ] **Step 6: Typecheck, format, lint, commit**

```bash
npx tsc -b apps/desktop
npx prettier --write apps/desktop/src/renderer/panels
npx eslint apps/desktop/src/renderer/panels
git add apps/desktop/src/renderer/panels/harness.ts apps/desktop/src/renderer/panels/harness.test.ts apps/desktop/src/renderer/panels/AgentsPanel.tsx apps/desktop/src/renderer/panels/AgentsPanel.test.tsx
git commit -m "feat: state the harness on the model and share one reasoning ladder"
```

---

### Task 6: Roles and context, with the add picker

**Files:**
- Create: `apps/desktop/src/renderer/panels/AddPicker.tsx`, `apps/desktop/src/renderer/panels/AddPicker.test.tsx`
- Modify: `apps/desktop/src/renderer/panels/AgentsPanel.tsx`, `apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`

**Interfaces:**
- Consumes: `SetRow`, `Membership`, `packageMembership`, `membershipSource`, `togglePackage`, `packageAdvisories` (Task 3); `PopoverCard` (kit); `TextInput` (`panels/fields.tsx`).
- Produces:
  ```ts
  export interface AddPickerItem { id: string; name: string; description?: string; membership: Membership }
  export interface AddPickerProps {
    label: string;                    // the trigger's visible text, e.g. 'Add Context'
    items: AddPickerItem[];
    onToggle: (id: string) => void;
    placeholder: string;              // the filter field's placeholder
  }
  export function AddPicker(props: AddPickerProps): React.JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddPicker, type AddPickerItem } from './AddPicker.js';

const ITEMS: AddPickerItem[] = [
  { id: 'core', name: 'Core', membership: 'inherited' },
  { id: 'coding', name: 'Coding', membership: 'available' },
  { id: 'research', name: 'Research', membership: 'available' },
];

describe('AddPicker', () => {
  it('stays open across selections so adding several is one visit', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <AddPicker label="Add Context" items={ITEMS} onToggle={onToggle} placeholder="Filter…" />,
    );
    await user.click(screen.getByRole('button', { name: 'Add Context' }));
    await user.click(screen.getByRole('checkbox', { name: 'Coding' }));
    await user.click(screen.getByRole('checkbox', { name: 'Research' }));
    expect(onToggle).toHaveBeenNthCalledWith(1, 'coding');
    expect(onToggle).toHaveBeenNthCalledWith(2, 'research');
    expect(screen.getByPlaceholderText('Filter…')).toBeInTheDocument();
  });

  it('filters its rows as you type', async () => {
    const user = userEvent.setup();
    render(<AddPicker label="Add Context" items={ITEMS} onToggle={() => {}} placeholder="Filter…" />);
    await user.click(screen.getByRole('button', { name: 'Add Context' }));
    await user.type(screen.getByPlaceholderText('Filter…'), 'res');
    expect(screen.getByRole('checkbox', { name: 'Research' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Coding' })).not.toBeInTheDocument();
  });

  it('mirrors what is already in, so the registry never lies about state', async () => {
    const user = userEvent.setup();
    render(<AddPicker label="Add Context" items={ITEMS} onToggle={() => {}} placeholder="Filter…" />);
    await user.click(screen.getByRole('button', { name: 'Add Context' }));
    expect(screen.getByRole('checkbox', { name: 'Core' })).toHaveAttribute('aria-checked', 'mixed');
  });

  it('closes on escape', async () => {
    const user = userEvent.setup();
    render(<AddPicker label="Add Context" items={ITEMS} onToggle={() => {}} placeholder="Filter…" />);
    await user.click(screen.getByRole('button', { name: 'Add Context' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByPlaceholderText('Filter…')).not.toBeInTheDocument();
  });
});
```

```tsx
// appended to AgentsPanel.test.tsx
it('keeps an excluded package visible in the agent rather than hiding it', () => {
  const agents = [{ ...MOCK_AGENTS[0]!, exclude: ['core'] }];
  render(
    <AgentsSurface
      state={makeState({
        data: {
          agents: { status: 'ok', value: agents },
          packages: { status: 'ok', value: PKGS },
          roles: { status: 'ok', value: [] },
        },
        ui: { selectedAgentRef: agents[0]!.ref },
      })}
    />,
  );
  expect(screen.getByRole('checkbox', { name: 'Core' })).toHaveAttribute('aria-checked', 'false');
});
```

(`PKGS` is the same fixture defined in `resolvedSet.test.tsx`; export it from there and import it here rather than redefining.)

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/desktop/src/renderer/panels/AddPicker.test.tsx apps/desktop/src/renderer/panels/AgentsPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement AddPicker**

A `PopoverCard` anchored to its trigger, not a modal. Opening focuses the filter field; `ArrowUp`/`ArrowDown` move a cursor; `Enter` toggles the cursor row **without closing**; `Escape` closes through the kit's dismiss-layer stack. Rows are `SetRow`s, so a row already in the agent wears its real membership. A filter matching nothing renders `No match`.

- [ ] **Step 4: Build the two sections**

Roles: one `SetRow` per role, description as the second line, meta naming what it brings, toggled through the existing role patch. Context: rows for the resolved set only, ordered inherited then added then excluded, each with `membershipSource` as its meta; the advisory line renders below from `packageAdvisories`; both sections end with an `AddPicker`. Section headers carry a count of what is in.

`membershipSource` returns a role's name (already capitalised) or the sentinel `'default'`. That sentinel is data, not copy, so **capitalise it at the point of render** rather than changing the returned value: every visible meta string starts with a capital letter, like every other label in the app. Do not "fix" this by editing `membershipSource`'s return value or its pinned test.

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run apps/desktop/src/renderer/panels`
Expected: PASS.

- [ ] **Step 6: Typecheck, format, lint, commit**

```bash
npx tsc -b apps/desktop
npx prettier --write apps/desktop/src/renderer/panels
npx eslint apps/desktop/src/renderer/panels
git add apps/desktop/src/renderer/panels/AddPicker.tsx apps/desktop/src/renderer/panels/AddPicker.test.tsx apps/desktop/src/renderer/panels/AgentsPanel.tsx apps/desktop/src/renderer/panels/AgentsPanel.test.tsx apps/desktop/src/renderer/panels/resolvedSet.test.tsx
git commit -m "feat: compose an agent from a resolved set with a searchable add picker"
```

- [ ] **Step 7: Show the maintainer**

Drive the app: add two packages in one visit, exclude a default, confirm the exclusion stays visible and the advisory nudge reads right.

---

### Task 7: The Reach band

**Files:**
- Modify: `apps/desktop/src/renderer/panels/resolvedSet.tsx`, `apps/desktop/src/renderer/panels/resolvedSet.test.tsx`, `apps/desktop/src/renderer/panels/AgentsPanel.tsx`

**Interfaces:**
- Consumes: `includedPackageIds` (Task 4's move), `harnessLabel` (Task 5).
- Produces:
  ```ts
  export function reachOf(
    packages: PackageSummary[], included: ReadonlySet<string>,
  ): { tools: string[]; mcp: string[] };
  ```

- [ ] **Step 1: Write the failing test**

```ts
describe('reachOf', () => {
  it('unions the tools of the included packages, deduped and stable', () => {
    const pkgs: PackageSummary[] = [
      { id: 'a', name: 'A', description: '', inclusion: 'default', toolRefs: ['Read', 'Grep'] },
      { id: 'b', name: 'B', description: '', inclusion: 'opt-in', toolRefs: ['Grep', 'Edit'] },
    ];
    expect(reachOf(pkgs, new Set(['a', 'b'])).tools).toEqual(['Read', 'Grep', 'Edit']);
  });

  it('ignores packages that are not included', () => {
    const pkgs: PackageSummary[] = [
      { id: 'a', name: 'A', description: '', inclusion: 'default', toolRefs: ['Read'] },
      { id: 'b', name: 'B', description: '', inclusion: 'opt-in', toolRefs: ['Bash'] },
    ];
    expect(reachOf(pkgs, new Set(['a'])).tools).toEqual(['Read']);
  });

  it('collects mcp servers where a package declares them', () => {
    const pkgs: PackageSummary[] = [
      { id: 'a', name: 'A', description: '', inclusion: 'opt-in', toolRefs: [], mcpServers: ['fs'] },
    ];
    expect(reachOf(pkgs, new Set(['a'])).mcp).toEqual(['fs']);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/desktop/src/renderer/panels/resolvedSet.test.tsx`
Expected: FAIL, `reachOf` is not exported.

- [ ] **Step 3: Implement and render the band**

`reachOf` dedupes while preserving first-seen order. The band renders a count in its header (`14 tools · 0 MCP`), the tool names in mono, and one quiet closing line naming the harness this declaration is realized on. It is read-only: no controls, and the header count renders nothing when the set is empty (the band itself then states that the agent reaches nothing yet).

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run apps/desktop/src/renderer/panels`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write apps/desktop/src/renderer/panels
npx eslint apps/desktop/src/renderer/panels
git add apps/desktop/src/renderer/panels/resolvedSet.tsx apps/desktop/src/renderer/panels/resolvedSet.test.tsx apps/desktop/src/renderer/panels/AgentsPanel.tsx
git commit -m "feat: show what an agent's composition can actually reach"
```

---

### Task 8: Drift and cache notices become one docked line

**Files:**
- Create: `apps/desktop/src/renderer/panels/NoticeLine.tsx`, `apps/desktop/src/renderer/panels/NoticeLine.test.tsx`
- Modify: `apps/desktop/src/renderer/panels/banners.ts`, `apps/desktop/src/renderer/panels/banners.test.ts`, `apps/desktop/src/renderer/panels/ChatPanel.tsx`, `apps/desktop/src/renderer/panels/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `computeChatBanners`, `Banner` (existing).
- Produces:
  ```ts
  export function NoticeLine({ notices, onAction }: {
    notices: Banner[];
    onAction: (id: string, actionId: string) => void;
  }): React.JSX.Element | null;
  ```
  `ChatBannerInput` gains `hasRun: boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// banners.test.ts
it('does not call a session cold before it has ever run', () => {
  const notices = computeChatBanners({
    agentConfig: {},
    hasRun: false,
    pinned: { provider: 'claude', model: 'opus', updatedAt: '2026-07-31T10:00:00.000Z' },
    now: '2026-07-31T11:00:00.000Z',
  });
  expect(notices.find((n) => n.kind === 'cache')).toBeUndefined();
});

it('still calls an idle session that has run cold', () => {
  const notices = computeChatBanners({
    agentConfig: {},
    hasRun: true,
    pinned: { provider: 'claude', model: 'opus', updatedAt: '2026-07-31T10:00:00.000Z' },
    now: '2026-07-31T11:00:00.000Z',
  });
  expect(notices.find((n) => n.kind === 'cache')).toBeDefined();
});
```

```tsx
// NoticeLine.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NoticeLine } from './NoticeLine.js';

describe('NoticeLine', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<NoticeLine notices={[]} onAction={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the notice and offers its action inline', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <NoticeLine
        notices={[
          { id: 'drift', kind: 'drift', reason: 'The configuration changed.',
            actions: [{ id: 'recompile', label: 'Recompile', primary: true }] },
        ]}
        onAction={onAction}
      />,
    );
    expect(screen.getByText('Configuration drift')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Recompile' }));
    expect(onAction).toHaveBeenCalledWith('drift', 'recompile');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/desktop/src/renderer/panels/banners.test.ts apps/desktop/src/renderer/panels/NoticeLine.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Guard staleness behind a real run**

In `computeChatBanners`, gate the idle-staleness reason on `input.hasRun`. A session that has never produced a turn has no warm cache to have gone cold, so claiming otherwise is the defect the maintainer logged. Pass `hasRun` from the chat vm, derived from whether the session has any turns.

- [ ] **Step 4: Build the line**

One row per notice: a dot in the notice's own severity (cache informational, drift needs-you), the notice name in text, the reason available on hover or focus rather than permanently, and the inline action as a quiet button. Drift keeps its dismiss. Render it through the `Composer`'s existing `above` slot alongside the jump-to-latest pill; do not add a new prop.

- [ ] **Step 5: Delete the strip**

Remove `BannerStrip` and the `Banner as BannerCard` import from `ChatPanel.tsx`. Update `ChatPanel.test.tsx` assertions that looked for the card.

- [ ] **Step 6: Run and confirm pass**

Run: `npx vitest run apps/desktop/src/renderer/panels`
Expected: PASS.

- [ ] **Step 7: Typecheck, format, lint, commit**

```bash
npx tsc -b apps/desktop
npx prettier --write apps/desktop/src/renderer/panels
npx eslint apps/desktop/src/renderer/panels
git add apps/desktop/src/renderer/panels/NoticeLine.tsx apps/desktop/src/renderer/panels/NoticeLine.test.tsx apps/desktop/src/renderer/panels/banners.ts apps/desktop/src/renderer/panels/banners.test.ts apps/desktop/src/renderer/panels/ChatPanel.tsx apps/desktop/src/renderer/panels/ChatPanel.test.tsx
git commit -m "fix: dock drift and cache notices to the composer as one quiet line"
```

---

### Task 9: The project dialog, honest at its floor

**Files:**
- Modify: `apps/desktop/src/renderer/shell/Nav.tsx`
- Test: `apps/desktop/src/renderer/shell/Nav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('states that switching is not available rather than offering a dead control', async () => {
  const user = userEvent.setup();
  useShell.setState({ projectOpen: false, workspace: { name: 'coa', root: 'C:/repo/coa' } });
  render(<Nav />);
  await user.click(screen.getByRole('button', { name: /coa/ }));
  expect(screen.getByText('Opening another project is not available yet.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Open Project…' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/desktop/src/renderer/shell/Nav.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the dialog, keep the open project and its root, and replace the stale "switching arrives later" comment with a rendered sentence: `Opening another project is not available yet.` Add no affordance. Update the code comment to say the honest reason (one daemon, one pipe, the workspace derived from its cwd) rather than referring to a phase.

- [ ] **Step 4: Run, format, lint, commit**

```bash
npx vitest run apps/desktop/src/renderer/shell/Nav.test.tsx
npx prettier --write apps/desktop/src/renderer/shell/Nav.tsx
npx eslint apps/desktop/src/renderer/shell
git add apps/desktop/src/renderer/shell/Nav.tsx apps/desktop/src/renderer/shell/Nav.test.tsx
git commit -m "fix: say plainly that another project cannot be opened yet"
```

---

### Task 10: Retire the prototype

Only after Task 1's showcase has been landed and shown.

**Files:**
- Delete: `apps/workbench-proto/`
- Modify: `pnpm-workspace.yaml` if it names the app explicitly, `docs/REPO_LAYOUT.md`, `docs/UI.md`, `docs/adr/0014-workbench-design-system.md`

- [ ] **Step 1: Confirm nothing depends on it**

```bash
grep -rn "workbench-proto" --include=*.ts --include=*.tsx --include=*.json --include=*.md --include=*.yaml . | grep -v node_modules
```
Expected: only the app's own files plus the doc references listed above.

- [ ] **Step 2: Delete the app**

```bash
git rm -r apps/workbench-proto
```

- [ ] **Step 3: Update the docs in the same commit**

`REPO_LAYOUT.md` drops the app from the package map. `UI.md`'s status block currently names the prototype as the motion-true reference implementation; it now names the console's showcase surface instead. ADR-0014 is immutable as a decision, so do not rewrite its reasoning; add a dated consequence line recording that the prototype has been retired into the console.

- [ ] **Step 4: Verify the workspace still builds**

```bash
pnpm install
npx tsc -b
npx vitest run
pnpm docs:check
```
Expected: typecheck clean; tests green apart from the two known adapter suites; `docs:check` failing only on the maintainer's `TEMP.md`.

- [ ] **Step 5: Commit**

```bash
git add -u
git add docs/REPO_LAYOUT.md docs/UI.md docs/adr/0014-workbench-design-system.md
git commit -m "chore: retire the prototype now the showcase lives in the console"
```

---

### Task 11: Re-measure the performance items

Measure first. At least one item is already fixed: layout persistence is debounced 300ms trailing today.

**Files:**
- Modify (only what measurement justifies): `apps/desktop/electron.vite.config.ts`, `apps/desktop/src/renderer/globals.css`, `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/console.ts`
- Modify: `ROADMAP.md`
- Test: `apps/desktop/src/renderer/console.test.tsx`

- [ ] **Step 1: Fix the hollow push-stream test first**

`console.test.tsx`'s "subscribes to the push stream" case pushes under `sessionId: 's'` while the fixture's active session is `'c1'`, so it asserts nothing. Push under the active id and assert the row renders.

Run: `npx vitest run apps/desktop/src/renderer/console.test.tsx`
Expected: PASS, and confirm it fails if you break the merge deliberately.

- [ ] **Step 2: Measure each item against current code**

Record a number or a verified code fact for each, in a scratch file outside the repo:

1. Dev cold start with and without `optimizeDeps.include` in `electron.vite.config.ts`.
2. Whether the Tailwind `@source` globs at `globals.css:14-15` pull in `*.test.tsx`.
3. Whether the `setInterval` refresh at `App.tsx:94` replaces state with no equality guard, and how many renders one tick causes.
4. Which components carry `React.memo` / `useCallback` today.
5. Layout persistence debounce: already present, confirm and close.
6. Count the sequential IPC round trips on boot.

- [ ] **Step 3: Fix only what measurement justifies**

Likely: add `optimizeDeps.include` for the heavy renderer deps; narrow the `@source` globs to exclude tests; add a shallow-equality guard so an unchanged poll result does not replace state; batch the boot reads. Each fix lands with the measurement that justified it in the commit's own diff context, not in the subject line.

- [ ] **Step 4: Guard the poll with a test**

The console controller is `startConsole(bridge: ConsoleBridge, …)` in `console.ts`; `console.test.tsx`
already builds a fake bridge, so follow that file's existing pattern rather than inventing a helper.
Assert that an unchanged poll does not publish a new state object:

```ts
it('publishes nothing when a poll returns unchanged data', async () => {
  const published: ConsoleState[] = [];
  const controller = startConsole(fakeBridge(), (s) => published.push(s));
  await controller.refresh();
  const afterFirst = published.length;
  await controller.refresh();
  expect(published.length).toBe(afterFirst);
});
```

Read `startConsole`'s real signature and `console.test.tsx`'s fake-bridge helper first, and match
them; the shape above is the assertion to make, not a signature to trust.

- [ ] **Step 5: Close or re-file each item in ROADMAP.md**

Every item under the console performance known-issue moves to either closed (with what fixed it) or re-filed as its own entry. The poll-and-replace architecture is re-filed with its measurement attached.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run apps/desktop
npx tsc -b apps/desktop
git add apps/desktop ROADMAP.md
git commit -m "perf: cut the measured console startup and poll costs"
```

---

### Task 12: Confirm the audit and close the arc

**Files:**
- Modify: `ROADMAP.md`
- Delete: `.superpowers/sdd/w4-orphan-homes-handoff.md`

- [ ] **Step 1: Walk the audit table**

Open the spec's audit table and confirm every row against the running app, clicking to each home. Add any row found missing rather than dropping it.

- [ ] **Step 2: Flip the phase and close the section**

Mark the phase done in `ROADMAP.md` with what actually shipped, and close the arc's in-flight section, moving anything genuinely deferred into the deferred list with a reason.

- [ ] **Step 3: Delete the stale handoff**

The starting handoff describes account management as in scope, which is wrong since the auth surface took it. It has served its purpose.

- [ ] **Step 4: Full verification**

```bash
npx tsc -b
npx vitest run
npx eslint .
npx prettier --check .
pnpm docs:check
pnpm depcruise
```
Expected: green apart from the two known adapter suites and the maintainer's `TEMP.md`.

- [ ] **Step 5: Commit**

```bash
git add ROADMAP.md
git rm .superpowers/sdd/w4-orphan-homes-handoff.md
git commit -m "docs: record the console rebuild as complete"
```

---

## Self-review notes

- **Spec coverage:** agents surface (Tasks 3-7), notices (8), project floor (9), showcase and prototype (1, 10), performance (11), audit and close (12). The spec's skills section is explicitly deferred above, with its reason.
- **Type consistency:** `Membership` is defined once in Task 3 and consumed by Tasks 4, 6 and 7. `harnessOf` / `harnessLabel` are defined in Task 5 and consumed by Task 7. `ComboboxOption` is defined in Task 2 and consumed by Task 5. `includedPackageIds`, `togglePackage` and `packageAdvisories` keep their existing names through the move in Task 4.
- **Sequencing:** the showcase is ported before any kit member is added, so every new member has somewhere to render its specimen; the prototype is deleted only after that surface is shown working.

---

_Last reviewed: 2026-07-31_
