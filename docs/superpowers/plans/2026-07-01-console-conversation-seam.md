# Console Conversation Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the console's right-dock conversation slot a real mock surface — a structured, virtualized chat transcript with inline approval cards, a surfaced (never-fabricated) deny notice, and a working `coa raw` verbatim toggle — rendered through the existing registry + selector seam so it swaps mock→verb with no shell or panel refactor.

**Architecture:** Three parts, three commits. (1) A new **`Transcript`** Dense/Viz component in `@coa/console-ui` (the first P11 family member) that renders role-tagged turn frames — text / tool-use / tool-result / approval / deny / raw — virtualized with `react-virtuoso`, states handled by its container, byte-faithful payloads via the existing `Code` block, and the SC-1 `DenyNotice` reused for the deny frame. Its per-frame renderer (`TranscriptRow`) is exported and unit-tested exhaustively so no test depends on Virtuoso rendering virtualized items under jsdom. (2) The **chat panel** in `apps/desktop`: a `TurnFrame` edge schema in `console-viewmodel`, a shell-owned mock fixture, a pure `selectChatVm` that projects the daemon stream into `Transcript` frames, and a `ChatPanel` replacing the `conversation` placeholder — states-first. (3) **Interactivity**: inline approval cards resolved by an inert mock action (the console surfaces, never denies — SC-1), a mock cost-cap deny frame, and the `coa raw` title-bar affordance made live as a `ui.rawMode` toggle that reprojects the same stream to verbatim frames (D85).

**Tech Stack:** TypeScript (strict), React 19, `react-virtuoso` (new renderer-only dep), `@coa/console-ui` (kit + tokens), `@coa/console-layout` (registry + StaticEngine + `PanelDefinition`/`PanelHostApi`), `@coa/console-viewmodel` (pure edge schemas + selectors), Zod 4, Vitest + jsdom + @testing-library/react, Lucide icons.

## Global Constraints

- **TypeScript `strict`, no `any`.** Use `unknown` + narrow casts where unavoidable.
- **`exactOptionalPropertyTypes` is ON.** Type an omittable optional field `x?: T | undefined`.
- **SC-1 — help, never cage.** Nothing here denies or gates. The approval card's Approve/Deny are **inert mock actions** that only resolve the mock card locally; the card *surfaces* an approval the daemon would issue and never originates a block. The deny frame reuses the existing `DenyNotice` (which "gates nothing itself"); it renders a **mock** cost-cap deny to validate the surface. The **live** deny channel wiring stays deferred (needs the R-12 push bridge). (spec §3, §21.3)
- **`coa raw` stays reachable (D85).** The existing title-bar `raw` affordance is made live as a mode toggle; it never disappears. (spec §21.3)
- **M10 is a leaf; talks only to M8.** This surface adds **no daemon verb** — the stream is a shell-owned mock typed by a `console-viewmodel` edge schema shaped like the future turn-store frame, so the mock→verb swap is a one-line data-source change. (spec §16, §21.3)
- **Byte-faithful renders (D128).** Tool payloads and the raw/verbatim projection render exactly via the existing `Code` block (whitespace-preserving `<pre>`, "no truncation or normalization"). (spec §3, §11.4)
- **Renderer isolation (D128).** `console-ui` imports only `react`/`radix-ui`/`lucide-react`/`react-virtuoso` (+ its own tokens) — never `electron` or `@coa/core` (enforced: `console-ui-no-electron-core`). The renderer imports no `electron`; edge types reach it via `@coa/console-viewmodel`, never `@coa/core`.
- **Zod at the edges.** The `TurnFrame` edge schema lives in `@coa/console-viewmodel/src/reads.ts` and validates the mock fixture in a test.
- **States-first (§5.1 #12).** The chat panel ships loading + error + empty with real content before the happy path; the transcript renders every frame kind.
- **NO emoji anywhere** — Lucide icons only. **WAI-ARIA + visible focus** (the transcript is a labelled `role="log"`; approval buttons are native focusable `Button`s).
- **pnpm PATH quirk:** prefix every pnpm command with `pnpm_config_verify_deps_before_run=false corepack pnpm …` (PowerShell: `$env:pnpm_config_verify_deps_before_run='false'` once per terminal, then `corepack pnpm …`). Run gates individually via `corepack pnpm <gate>` (the composite `check` calls bare `pnpm` and fails).
- **Single test from the repo ROOT:** `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run <path>`.
- **DOM tests** start with a `// @vitest-environment jsdom` docblock (node is default). `vitest.setup.ts` polyfills pointer-capture/scrollIntoView/ResizeObserver.
- **New console-ui component obligations:** colocated `*.intent.ts` + register in `src/registry.ts` + export in `src/index.ts` + **regenerate `COMPONENTS.md`** (diff-checked by `registry.test.ts`; no `tsx`/`vite-node` — use the throwaway-test pattern in Task 1.5).
- **Commits: subject-only Conventional Commits** — no body/trailers, **no internal identifiers** (module IDs / plan numbers / decision codes / "4c") in the subject. **Stage files by name.** **Developer-sized commits** — one per Part (three total), NOT per task.
- **Same-commit doc rule:** the Part that adds `react-virtuoso` to `console-ui` updates `docs/REPO_LAYOUT.md`'s "imports only react/radix/lucide" line and the `.dependency-cruiser.cjs` rule comment in the same commit.

---

## File structure

```
packages/console-ui/
  src/dense/Transcript.tsx           new (P1) — Transcript + exported TranscriptRow (the P11 Dense/Viz component)
  src/dense/Transcript.intent.ts     new (P1) — the intent declaration (family 'Dense/Viz')
  src/dense/Transcript.test.tsx      new (P1) — per-kind row tests + container states
  src/registry.ts                    modify (P1) — register transcriptIntent
  src/registry.test.ts               modify (P1) — require the 'Dense/Viz' family
  src/index.ts                       modify (P1) — export Transcript + types
  COMPONENTS.md                      regenerated (P1) — catalogue is diff-checked
  package.json                       modify (P1) — add react-virtuoso dep (via pnpm add)

packages/console-viewmodel/
  src/reads.ts                       modify (P2) — TurnFrame discriminated-union schema + TurnStream
  src/reads.test.ts                  modify (P2) — TurnFrame parse/reject

apps/desktop/
  src/renderer/panels/mockConversation.ts       new (P2) — MOCK_TURNS fixture (typed TurnFrame[])
  src/renderer/panels/mockConversation.test.ts  new (P2) — fixture conforms to the edge schema
  src/renderer/panels/ChatPanel.tsx             new (P2; P3 raw+approval projection) — selectChatVm + ChatView
  src/renderer/panels/ChatPanel.test.tsx        new (P2; P3) — pure selector + states-first render
  src/renderer/panels/state.ts                  modify (P2 data.turns; P3 ui.rawMode/resolvedApprovals + actions)
  src/renderer/panels/registry.ts               modify (P2) — replace the 'conversation' placeholder with chatPanel
  src/renderer/panels/registry.test.ts          modify (P2) — assert chat panel registered
  src/renderer/console.ts                        modify (P2 seed turns; P3 toggleRaw/respondApproval + controller)
  src/renderer/console.test.tsx                  modify (P2; P3) — chat renders; raw toggles
  src/renderer/App.tsx                           modify (P3) — wire onRaw → controller.toggleRaw()
docs/REPO_LAYOUT.md                              modify (P1) — note react-virtuoso in the console-ui allow-set
.dependency-cruiser.cjs                          modify (P1) — extend the console-ui rule comment
```

No `@coa/console-layout` change. No new daemon verb, so no `methods.ts`/`main`/`preload` change.

---

# Part 1 — the Transcript Dense/Viz component

Build the first §7 Dense/Viz family member in the kit: a virtualized transcript that renders six frame kinds. Its per-frame renderer is exported and tested exhaustively (jsdom-safe); the container adds virtualization + the empty guard.

### Task 1.1: Add the react-virtuoso dependency

**Files:**
- Modify: `packages/console-ui/package.json` (via `pnpm add`)

- [ ] **Step 1: Add the dependency**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm --filter @coa/console-ui add react-virtuoso`
Expected: `package.json` gains `"react-virtuoso"` under `dependencies`; the lockfile updates. (react-virtuoso 4.x supports React 19.)

- [ ] **Step 2: Verify it resolves from source**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm --filter @coa/console-ui typecheck`
Expected: PASS (no new type errors; the dep is present).

### Task 1.2: The TranscriptRow renderer (exhaustively tested)

**Files:**
- Create: `packages/console-ui/src/dense/Transcript.tsx`
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:**
- Consumes: `react-virtuoso` (`Virtuoso`); `../data/Code.js` (`Code`); `../feedback/DenyNotice.js` (`DenyNotice`); `../actions/Button.js` (`Button`); `../lib/cx.js` (`cx`).
- Produces:
  - `type TranscriptRole = 'you' | 'agent' | 'subagent'`
  - `type TranscriptFrame` (discriminated union by `kind`: `text` | `tool-use` | `tool-result` | `approval` | `deny` | `raw`)
  - `type RespondFn = (requestId: string, decision: 'approve' | 'deny') => void`
  - `function TranscriptRow(props: { frame: TranscriptFrame; onRespond?: RespondFn | undefined }): React.JSX.Element`
  - `interface TranscriptProps { frames: TranscriptFrame[]; onRespond?: RespondFn | undefined; label?: string | undefined; className?: string | undefined }`
  - `function Transcript(props: TranscriptProps): React.JSX.Element`

- [ ] **Step 1: Write the failing test** `packages/console-ui/src/dense/Transcript.test.tsx`

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Transcript, TranscriptRow, type TranscriptFrame } from './Transcript.js';

describe('TranscriptRow', () => {
  it('renders a text frame with its role and text', () => {
    render(<TranscriptRow frame={{ id: 't1', role: 'you', kind: 'text', text: 'do the thing' }} />);
    expect(screen.getByText('do the thing')).toBeTruthy();
    expect(screen.getByText('you')).toBeTruthy();
  });

  it('renders a tool-use frame byte-faithfully in a monospace block', () => {
    const input = '{\n  "path": "src/auth.ts"\n}';
    const { container } = render(
      <TranscriptRow frame={{ id: 't2', role: 'agent', kind: 'tool-use', tool: 'read_file', input }} />,
    );
    expect(screen.getByText('read_file')).toBeTruthy();
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(input); // exact bytes, no normalization
  });

  it('renders a tool-result frame with an ok/error marker', () => {
    render(
      <TranscriptRow
        frame={{ id: 't3', role: 'agent', kind: 'tool-result', tool: 'read_file', output: '42 lines', ok: true }}
      />,
    );
    expect(screen.getByText(/42 lines/)).toBeTruthy();
    expect(screen.getByText(/ok/i)).toBeTruthy();
  });

  it('indents a nested subagent frame', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: 't4', role: 'subagent', kind: 'text', text: 'reviewing', depth: 1 }} />,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.marginLeft).not.toBe('');
  });

  it('renders an approval card and fires onRespond on Approve/Deny', () => {
    const onRespond = vi.fn();
    render(
      <TranscriptRow
        frame={{ id: 't5', kind: 'approval', requestId: 'r1', tool: 'write_file', summary: 'src/auth.ts', diffStat: '+42 -18' }}
        onRespond={onRespond}
      />,
    );
    expect(screen.getByText('write_file')).toBeTruthy();
    expect(screen.getByText('+42 -18')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    expect(onRespond).toHaveBeenNthCalledWith(1, 'r1', 'approve');
    expect(onRespond).toHaveBeenNthCalledWith(2, 'r1', 'deny');
  });

  it('shows a resolved approval without live buttons', () => {
    render(
      <TranscriptRow
        frame={{ id: 't6', kind: 'approval', requestId: 'r2', tool: 'write_file', summary: 's', resolved: 'approved' }}
      />,
    );
    expect(screen.getByText(/approved/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });

  it('renders a deny frame through the SC-1 DenyNotice (it gates nothing)', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: 't7', kind: 'deny', denyKind: 'cost-cap', reason: 'cap reached' }} />,
    );
    expect(container.querySelector('[data-deny-kind="cost-cap"]')).not.toBeNull();
    expect(screen.getByText('cap reached')).toBeTruthy();
  });

  it('renders a raw frame verbatim in a monospace block', () => {
    const text = '> assistant: hello\n> tool_use read_file {"path":"a"}';
    const { container } = render(<TranscriptRow frame={{ id: 't8', kind: 'raw', text }} />);
    expect(container.querySelector('pre')?.textContent).toBe(text);
  });
});

describe('Transcript container', () => {
  const frames: TranscriptFrame[] = [{ id: 'a', role: 'you', kind: 'text', text: 'hi' }];

  it('is a labelled log region', () => {
    render(<Transcript frames={frames} label="Conversation" />);
    expect(screen.getByRole('log', { name: 'Conversation' })).toBeTruthy();
  });

  it('renders nothing structural for an empty stream (the panel owns EmptyState)', () => {
    const { container } = render(<Transcript frames={[]} />);
    expect(container.querySelector('[role="log"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-ui/src/dense/Transcript.test.tsx`
Expected: FAIL (cannot resolve `./Transcript.js`).

- [ ] **Step 3: Implement** `packages/console-ui/src/dense/Transcript.tsx`

```tsx
import { Virtuoso } from 'react-virtuoso';
import { Button } from '../actions/Button.js';
import { Code } from '../data/Code.js';
import { DenyNotice } from '../feedback/DenyNotice.js';
import { cx } from '../lib/cx.js';

export type TranscriptRole = 'you' | 'agent' | 'subagent';

/** One rendered turn frame. A discriminated union so each kind renders on its own
 *  footing; `raw` is the verbatim (unfiltered-loop) projection. */
export type TranscriptFrame =
  | { id: string; role: TranscriptRole; kind: 'text'; text: string; depth?: number | undefined }
  | { id: string; role: TranscriptRole; kind: 'tool-use'; tool: string; input: string; depth?: number | undefined }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'tool-result';
      tool: string;
      output: string;
      ok: boolean;
      depth?: number | undefined;
    }
  | {
      id: string;
      kind: 'approval';
      requestId: string;
      tool: string;
      summary: string;
      diffStat?: string | undefined;
      resolved?: 'approved' | 'denied' | undefined;
    }
  | { id: string; kind: 'deny'; denyKind: 'close-gate' | 'cost-cap'; reason: string }
  | { id: string; kind: 'raw'; text: string };

export type RespondFn = (requestId: string, decision: 'approve' | 'deny') => void;

export interface TranscriptProps {
  frames: TranscriptFrame[];
  /** Fired when an inline approval card is actioned. Surfacing only — the console
   *  never denies; the daemon owns the real decision (SC-1). */
  onRespond?: RespondFn | undefined;
  label?: string | undefined;
  className?: string | undefined;
}

const roleTint: Record<TranscriptRole, string> = {
  you: 'text-fg',
  agent: 'text-fg',
  subagent: 'text-muted',
};

function RoleGutter({ role }: { role: TranscriptRole }): React.JSX.Element {
  return (
    <span className={cx('w-16 shrink-0 text-[11px] uppercase tracking-[0.04em]', roleTint[role])}>
      {role}
    </span>
  );
}

/** Renders a single frame by kind. Exported so it is unit-testable without the
 *  virtualized container (which needs measured heights jsdom does not provide). */
export function TranscriptRow({
  frame,
  onRespond,
}: {
  frame: TranscriptFrame;
  onRespond?: RespondFn | undefined;
}): React.JSX.Element {
  const depth = 'depth' in frame ? frame.depth : undefined;
  const indent = depth ? { marginLeft: depth * 16 } : undefined;

  if (frame.kind === 'approval') {
    return (
      <div style={indent} className="px-2 py-1.5">
        <div className="rounded-surface border border-border-default bg-raised p-2">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-faint">approval</span>
            <span className="font-medium text-fg">{frame.tool}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{frame.summary}</span>
            {frame.diffStat !== undefined && <span className="text-[11px] text-faint">{frame.diffStat}</span>}
          </div>
          {frame.resolved !== undefined ? (
            <div className="mt-1.5 text-[11px] text-muted">Request {frame.resolved}.</div>
          ) : (
            <div className="mt-1.5 flex justify-end gap-2">
              <Button variant="tertiary" size="sm" onClick={() => onRespond?.(frame.requestId, 'deny')}>
                Deny
              </Button>
              <Button variant="primary" size="sm" onClick={() => onRespond?.(frame.requestId, 'approve')}>
                Approve
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (frame.kind === 'deny') {
    return (
      <div className="px-2 py-1.5">
        <DenyNotice kind={frame.denyKind} reason={frame.reason} />
      </div>
    );
  }

  if (frame.kind === 'raw') {
    return (
      <div className="px-2 py-0.5">
        <Code block>{frame.text}</Code>
      </div>
    );
  }

  return (
    <div style={indent} className="flex gap-2 px-2 py-1.5">
      <RoleGutter role={frame.role} />
      <div className="min-w-0 flex-1">
        {frame.kind === 'text' && <div className="text-[13px] leading-[1.5] text-fg">{frame.text}</div>}
        {frame.kind === 'tool-use' && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">{frame.tool}</span>
            <Code block>{frame.input}</Code>
          </div>
        )}
        {frame.kind === 'tool-result' && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">
              {frame.tool} · {frame.ok ? 'ok' : 'error'}
            </span>
            <Code block>{frame.output}</Code>
          </div>
        )}
      </div>
    </div>
  );
}

/** A virtualized turn stream (react-virtuoso). Empty is the panel's concern (it owns
 *  the EmptyState), so an empty stream renders nothing here. */
export function Transcript({ frames, onRespond, label = 'Conversation', className }: TranscriptProps): React.JSX.Element | null {
  if (frames.length === 0) return null;
  return (
    <div role="log" aria-label={label} className={cx('h-full min-h-0', className)}>
      <Virtuoso
        data={frames}
        initialItemCount={Math.min(frames.length, 20)}
        itemContent={(_index, frame) => <TranscriptRow frame={frame} onRespond={onRespond} />}
        computeItemKey={(_index, frame) => frame.id}
      />
    </div>
  );
}
```

> Note: the `Transcript` return type is `React.JSX.Element | null` (the empty guard returns `null`). Keep that exact type.

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-ui/src/dense/Transcript.test.tsx`
Expected: PASS (10 tests).

### Task 1.3: The intent declaration

**Files:**
- Create: `packages/console-ui/src/dense/Transcript.intent.ts`

**Interfaces:**
- Consumes: `../lib/intent.js` (`assertIntent`, `ComponentIntent`).
- Produces: `transcriptIntent`.

- [ ] **Step 1: Create** `packages/console-ui/src/dense/Transcript.intent.ts`

```ts
import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const transcriptIntent: ComponentIntent = assertIntent({
  name: 'Transcript',
  family: 'Dense/Viz',
  intent: 'A virtualized turn stream of role-tagged conversation frames.',
  useWhen: ['Showing the agent conversation — text, tool calls, approvals, denies, or the raw loop.'],
  dontUseWhen: [
    'Showing one long document — use Longform/PromptView.',
    'Showing tabular records — use Table.',
  ],
  anatomy: 'A labelled log region virtualizing per-kind rows (text, tool-use, tool-result, approval, deny, raw).',
  variantsStates: ['text', 'tool-use', 'tool-result', 'approval', 'approval-resolved', 'deny', 'raw', 'empty'],
  accessibility: 'role=log with an aria-label; approval actions are native focusable buttons; payloads render byte-faithfully.',
  related: ['DenyNotice', 'Code', 'Table'],
});
```

### Task 1.4: Register + export the component

**Files:**
- Modify: `packages/console-ui/src/registry.ts`
- Modify: `packages/console-ui/src/registry.test.ts`
- Modify: `packages/console-ui/src/index.ts`

- [ ] **Step 1: Register the intent.** In `packages/console-ui/src/registry.ts`, add the import (after the `statIntent` import line) and append to `allIntents`:

```ts
import { transcriptIntent } from './dense/Transcript.intent.js';
```
Append `transcriptIntent,` to the `allIntents` array (after `statIntent,`).

- [ ] **Step 2: Require the Dense/Viz family.** In `packages/console-ui/src/registry.test.ts`, add `'Dense/Viz'` to the family-coverage list:

```ts
    for (const f of [
      'Foundations',
      'Actions',
      'Inputs',
      'Layout',
      'Data-display',
      'Feedback',
      'Overlays',
      'Dense/Viz',
    ]) {
```

- [ ] **Step 3: Export from the barrel.** In `packages/console-ui/src/index.ts`, add:

```ts
export {
  Transcript,
  TranscriptRow,
  type TranscriptProps,
  type TranscriptFrame,
  type TranscriptRole,
  type RespondFn,
} from './dense/Transcript.js';
```

- [ ] **Step 4: Confirm the catalogue test now fails** (COMPONENTS.md is stale, family now required)

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-ui/src/registry.test.ts`
Expected: FAIL on "COMPONENTS.md is regenerated from the current intents".

### Task 1.5: Regenerate the catalogue

**Files:**
- Regenerate: `packages/console-ui/COMPONENTS.md`
- Create then delete: `packages/console-ui/src/_regen-catalog.test.ts`

- [ ] **Step 1: Regenerate via a throwaway test** (no `tsx`/`vite-node` in repo — the blessed pattern). Create `packages/console-ui/src/_regen-catalog.test.ts`:

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
Expected: PASS (writes the file — a new `## Dense/Viz` section with `### Transcript` appears).

- [ ] **Step 2: Delete the throwaway test**

Run (bash): `rm packages/console-ui/src/_regen-catalog.test.ts`
(PowerShell: `Remove-Item packages/console-ui/src/_regen-catalog.test.ts`)

- [ ] **Step 3: Confirm the real catalogue test now passes**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-ui/src/registry.test.ts`
Expected: PASS (4 tests; COMPONENTS.md matches, Dense/Viz family present).

### Task 1.6: Same-commit doc + ruleset

**Files:**
- Modify: `docs/REPO_LAYOUT.md`
- Modify: `.dependency-cruiser.cjs`

- [ ] **Step 1: Update REPO_LAYOUT.** In `docs/REPO_LAYOUT.md`, change the `console-ui` allow-set line (currently "it imports only `react`/`radix-ui`/`lucide-react` (+ its own tokens)") to include `react-virtuoso`:

```
- **`console-ui` is a pure UI kit** — it imports only `react`/`radix-ui`/`lucide-react`/`react-virtuoso` (+ its own
  tokens), never `electron`/`core` (enforced: `console-ui-no-electron-core`).
```

- [ ] **Step 2: Update the depcruise comment.** In `.dependency-cruiser.cjs`, change the `console-ui-no-electron-core` rule `comment` to reflect the new allow-set:

```js
      comment:
        'The UI kit is a pure renderer-side library; it never imports electron or the daemon core (only react/radix/lucide/react-virtuoso).',
```
(The `from`/`to` paths are unchanged — react-virtuoso is a third-party dep and was never forbidden.)

### Task 1.7: Part 1 gate sweep + commit

- [ ] **Step 1: Run the full gate sweep**

```
pnpm_config_verify_deps_before_run=false corepack pnpm typecheck
pnpm_config_verify_deps_before_run=false corepack pnpm lint
pnpm_config_verify_deps_before_run=false corepack pnpm format:write
pnpm_config_verify_deps_before_run=false corepack pnpm format
pnpm_config_verify_deps_before_run=false corepack pnpm test
pnpm_config_verify_deps_before_run=false corepack pnpm depcruise
pnpm_config_verify_deps_before_run=false corepack pnpm --filter @coa/desktop build
```
Expected: all PASS; depcruise 0 violations; `electron-vite build` green (react-virtuoso bundles into the renderer).

- [ ] **Step 2: Commit Part 1** (stage by name; subject-only)

```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.intent.ts \
  packages/console-ui/src/dense/Transcript.test.tsx packages/console-ui/src/registry.ts \
  packages/console-ui/src/registry.test.ts packages/console-ui/src/index.ts \
  packages/console-ui/COMPONENTS.md packages/console-ui/package.json pnpm-lock.yaml \
  docs/REPO_LAYOUT.md .dependency-cruiser.cjs
git commit -m "feat: add a virtualized conversation transcript component"
```

---

# Part 2 — the mock chat panel (governed stream)

Add the `TurnFrame` edge schema, a shell-owned mock fixture, and a `ChatPanel` that projects the stream into `Transcript` frames — states-first — replacing the `conversation` placeholder. Governed kinds only (text / tool-use / tool-result); approvals, deny, and raw arrive in Part 3.

### Task 2.1: The TurnFrame edge schema

**Files:**
- Modify: `packages/console-viewmodel/src/reads.ts`
- Modify: `packages/console-viewmodel/src/reads.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `TurnRoleSchema`; `TurnFrameSchema` (discriminated union); `TurnStreamSchema`; `type TurnFrame`; `type TurnStream`.

- [ ] **Step 1: Write the failing test.** In `packages/console-viewmodel/src/reads.test.ts`, add:

```ts
import { TurnFrameSchema, TurnStreamSchema } from './reads.js';

describe('turn frame schema', () => {
  it('accepts each governed frame kind', () => {
    const frames = [
      { id: '1', role: 'you', kind: 'text', text: 'go' },
      { id: '2', role: 'agent', kind: 'tool-use', tool: 'read_file', input: '{}' },
      { id: '3', role: 'agent', kind: 'tool-result', tool: 'read_file', output: 'ok', ok: true },
      { id: '4', kind: 'approval', requestId: 'r1', tool: 'write_file', summary: 's' },
      { id: '5', kind: 'deny', denyKind: 'cost-cap', reason: 'cap' },
    ];
    expect(TurnStreamSchema.parse(frames)).toHaveLength(5);
  });

  it('rejects an unknown frame kind', () => {
    expect(() => TurnFrameSchema.parse({ id: 'x', kind: 'nope' })).toThrow();
  });

  it('carries optional subagent depth', () => {
    const f = TurnFrameSchema.parse({ id: '6', role: 'subagent', kind: 'text', text: 'r', depth: 1 });
    expect(f).toMatchObject({ depth: 1 });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-viewmodel/src/reads.test.ts`
Expected: FAIL (no `TurnFrameSchema` export).

- [ ] **Step 3: Implement.** Append to `packages/console-viewmodel/src/reads.ts`:

```ts
/** A conversation turn frame — the console mock is shaped like the future turn-store
 *  frame so the mock→verb swap is a data-source change, not a reshape. The `raw`
 *  verbatim projection is a UI concern (derived in the shell), not a wire field. */
export const TurnRoleSchema = z.enum(['you', 'agent', 'subagent']);
export type TurnRole = z.infer<typeof TurnRoleSchema>;

export const TurnFrameSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), role: TurnRoleSchema, kind: z.literal('text'), text: z.string(), depth: z.number().optional() }),
  z.object({ id: z.string(), role: TurnRoleSchema, kind: z.literal('tool-use'), tool: z.string(), input: z.string(), depth: z.number().optional() }),
  z.object({
    id: z.string(),
    role: TurnRoleSchema,
    kind: z.literal('tool-result'),
    tool: z.string(),
    output: z.string(),
    ok: z.boolean(),
    depth: z.number().optional(),
  }),
  z.object({ id: z.string(), kind: z.literal('approval'), requestId: z.string(), tool: z.string(), summary: z.string(), diffStat: z.string().optional() }),
  z.object({ id: z.string(), kind: z.literal('deny'), denyKind: z.enum(['close-gate', 'cost-cap']), reason: z.string() }),
]);
export type TurnFrame = z.infer<typeof TurnFrameSchema>;

export const TurnStreamSchema = z.array(TurnFrameSchema);
export type TurnStream = z.infer<typeof TurnStreamSchema>;
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run packages/console-viewmodel/src/reads.test.ts`
Expected: PASS (existing + 3 new tests).

### Task 2.2: The mock conversation fixture

**Files:**
- Create: `apps/desktop/src/renderer/panels/mockConversation.ts`
- Test: `apps/desktop/src/renderer/panels/mockConversation.test.ts`

**Interfaces:**
- Consumes: `@coa/console-viewmodel` (`TurnFrame`, `TurnStreamSchema`).
- Produces: `MOCK_TURNS: TurnFrame[]`.

- [ ] **Step 1: Write the failing test** `apps/desktop/src/renderer/panels/mockConversation.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { TurnStreamSchema } from '@coa/console-viewmodel';
import { MOCK_TURNS } from './mockConversation.js';

describe('MOCK_TURNS', () => {
  it('conforms to the turn-stream edge schema', () => {
    expect(() => TurnStreamSchema.parse(MOCK_TURNS)).not.toThrow();
  });

  it('exercises the states the transcript must render', () => {
    const kinds = new Set(MOCK_TURNS.map((f) => f.kind));
    for (const k of ['text', 'tool-use', 'tool-result', 'approval', 'deny']) expect(kinds.has(k)).toBe(true);
    expect(MOCK_TURNS.some((f) => 'depth' in f && f.depth)).toBe(true); // a nested subagent
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/mockConversation.test.ts`
Expected: FAIL (cannot resolve `./mockConversation.js`).

- [ ] **Step 3: Implement** `apps/desktop/src/renderer/panels/mockConversation.ts`

```ts
import type { TurnFrame } from '@coa/console-viewmodel';

/** A realistic mock conversation covering every frame kind the transcript renders.
 *  Shaped exactly like the future turn-store read (§21.3) so swapping this constant
 *  for the daemon verb is a one-line data-source change. The cost-cap deny frame is a
 *  MOCK that validates the SC-1 DenyNotice surface — the console gates nothing. */
export const MOCK_TURNS: TurnFrame[] = [
  { id: 'u1', role: 'you', kind: 'text', text: 'Refactor the auth module to use the new token helper.' },
  { id: 'a1', role: 'agent', kind: 'text', text: "I'll read src/auth.ts and the token helper first." },
  { id: 'a2', role: 'agent', kind: 'tool-use', tool: 'read_file', input: '{\n  "path": "src/auth.ts"\n}' },
  {
    id: 'a3',
    role: 'agent',
    kind: 'tool-result',
    tool: 'read_file',
    output: 'export function authenticate(req) {\n  // 42 lines\n}',
    ok: true,
  },
  { id: 'a4', role: 'agent', kind: 'text', text: 'Swapping the imports and the helper call now.' },
  { id: 'a5', role: 'agent', kind: 'approval', requestId: 'req-auth-1', tool: 'write_file', summary: 'src/auth.ts', diffStat: '+42 -18' },
  { id: 's1', role: 'subagent', kind: 'text', text: 'review · checking the change against the SSOT constraint', depth: 1 },
  { id: 'd1', kind: 'deny', denyKind: 'cost-cap', reason: 'Session paused: the daemon cost cap was reached.' },
];
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/mockConversation.test.ts`
Expected: PASS (2 tests).

### Task 2.3: ConsoleState gains the turn stream

**Files:**
- Modify: `apps/desktop/src/renderer/panels/state.ts`

- [ ] **Step 1: Add the turn stream to `ConsoleData`.** In `apps/desktop/src/renderer/panels/state.ts`:

Change the import to add `TurnFrame`:
```ts
import type { CapState, Checkpoint, FeedView, TurnFrame } from '@coa/console-viewmodel';
```
Add the field to `ConsoleData` (after `accounts`):
```ts
export interface ConsoleData {
  cap: Remote<CapState>;
  flags: Remote<FeedView>;
  timeline: Remote<Checkpoint[]>;
  accounts: Remote<AccountsInfo>;
  turns: Remote<TurnFrame[]>;
}
```
Seed it in `initialState`'s `data` block (after `accounts`):
```ts
      turns: { status: 'loading' },
```

### Task 2.4: The chat panel (governed projection, states-first)

**Files:**
- Create: `apps/desktop/src/renderer/panels/ChatPanel.tsx`
- Test: `apps/desktop/src/renderer/panels/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `@coa/console-layout` (`PanelDefinition`, `PanelHostApi`); `@coa/console-ui` (`Transcript`, `TranscriptFrame`, `Pane`, `Skeleton`, `InlineMessage`, `EmptyState`); `@coa/console-viewmodel` (`TurnFrame`); `ConsoleState`.
- Produces: `type ChatVm`; `function selectChatVm(state): ChatVm`; `function toGovernedFrame(f: TurnFrame): TranscriptFrame`; `chatPanel: PanelDefinition<ChatVm, ConsoleState>`.

- [ ] **Step 1: Write the failing test** `apps/desktop/src/renderer/panels/ChatPanel.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TurnFrame } from '@coa/console-viewmodel';
import { chatPanel, selectChatVm, toGovernedFrame } from './ChatPanel.js';
import type { ConsoleState } from './state.js';

const ChatView = chatPanel.render;
const host = { title: 'Chat', setTitle: () => {}, onVisibilityChange: () => () => {}, requestFocus: () => {} };

const stateWith = (turns: ConsoleState['data']['turns']): ConsoleState => ({
  data: {
    cap: { status: 'loading' },
    flags: { status: 'loading' },
    timeline: { status: 'loading' },
    accounts: { status: 'loading' },
    turns,
  },
  ui: { activeMainPanelId: 'cost', settings: { theme: 'dark', density: 'comfortable', motion: 'full' } },
  actions: {
    setRoute: () => {},
    refresh: () => {},
    switchAccount: () => {},
    setSettings: () => {},
  },
});

describe('toGovernedFrame', () => {
  it('maps a text turn to a text transcript frame', () => {
    const f: TurnFrame = { id: '1', role: 'you', kind: 'text', text: 'hi' };
    expect(toGovernedFrame(f)).toMatchObject({ id: '1', role: 'you', kind: 'text', text: 'hi' });
  });

  it('maps an approval turn to an approval frame', () => {
    const f: TurnFrame = { id: '2', kind: 'approval', requestId: 'r1', tool: 'write_file', summary: 's' };
    expect(toGovernedFrame(f)).toMatchObject({ kind: 'approval', requestId: 'r1' });
  });
});

describe('selectChatVm', () => {
  it('passes loading/error through', () => {
    expect(selectChatVm(stateWith({ status: 'loading' }))).toEqual({ status: 'loading' });
    expect(selectChatVm(stateWith({ status: 'error', message: 'boom' }))).toEqual({
      status: 'error',
      message: 'boom',
    });
  });

  it('projects an ok stream into governed frames', () => {
    const vm = selectChatVm(stateWith({ status: 'ok', value: [{ id: '1', role: 'you', kind: 'text', text: 'hi' }] }));
    expect(vm.status).toBe('ready');
    if (vm.status === 'ready') {
      expect(vm.rawMode).toBe(false);
      expect(vm.frames).toHaveLength(1);
    }
  });
});

describe('ChatView states-first', () => {
  it('skeletons while loading', () => {
    const { container } = render(<ChatView vm={{ status: 'loading' }} host={host} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows an error inline', () => {
    render(<ChatView vm={{ status: 'error', message: 'daemon down' }} host={host} />);
    expect(screen.getByText('daemon down')).toBeTruthy();
  });

  it('empty state when the stream is empty', () => {
    render(<ChatView vm={{ status: 'ready', rawMode: false, frames: [], onRespond: () => {} }} host={host} />);
    expect(screen.getByText(/no conversation/i)).toBeTruthy();
  });

  it('renders the transcript log when there are frames', () => {
    render(
      <ChatView
        vm={{ status: 'ready', rawMode: false, frames: [{ id: '1', role: 'you', kind: 'text', text: 'hi' }], onRespond: () => {} }}
        host={host}
      />,
    );
    expect(screen.getByRole('log')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/ChatPanel.test.tsx`
Expected: FAIL (cannot resolve `./ChatPanel.js`).

- [ ] **Step 3: Implement** `apps/desktop/src/renderer/panels/ChatPanel.tsx`

```tsx
import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { EmptyState, InlineMessage, Pane, Skeleton, Transcript } from '@coa/console-ui';
import type { RespondFn, TranscriptFrame } from '@coa/console-ui';
import type { TurnFrame } from '@coa/console-viewmodel';
import type { ConsoleState } from './state.js';

export type ChatVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rawMode: boolean; frames: TranscriptFrame[]; onRespond: RespondFn };

/** Map a daemon turn frame to its governed transcript frame. Approvals/denies pass
 *  their fields straight through; `resolved` is layered on in Part 3 from ui state. */
export function toGovernedFrame(f: TurnFrame): TranscriptFrame {
  switch (f.kind) {
    case 'text':
      return { id: f.id, role: f.role, kind: 'text', text: f.text, depth: f.depth };
    case 'tool-use':
      return { id: f.id, role: f.role, kind: 'tool-use', tool: f.tool, input: f.input, depth: f.depth };
    case 'tool-result':
      return { id: f.id, role: f.role, kind: 'tool-result', tool: f.tool, output: f.output, ok: f.ok, depth: f.depth };
    case 'approval':
      return { id: f.id, kind: 'approval', requestId: f.requestId, tool: f.tool, summary: f.summary, diffStat: f.diffStat };
    case 'deny':
      return { id: f.id, kind: 'deny', denyKind: f.denyKind, reason: f.reason };
  }
}

/** Pure: projects the polled turn stream into transcript frames. Part 3 adds the raw
 *  reprojection and approval-resolution overlay. */
export function selectChatVm(state: ConsoleState): ChatVm {
  const r = state.data.turns;
  if (r.status !== 'ok') return r;
  return {
    status: 'ready',
    rawMode: false,
    frames: r.value.map(toGovernedFrame),
    onRespond: () => {},
  };
}

function ChatView({ vm }: { vm: ChatVm; host: PanelHostApi }): React.JSX.Element {
  const title = vm.status === 'ready' && vm.rawMode ? 'Chat · raw' : 'Chat';
  return (
    <Pane title={title} className="h-full">
      {vm.status === 'loading' && (
        <div className="flex flex-col gap-2">
          <Skeleton className="w-2/3" />
          <Skeleton className="w-1/2" />
        </div>
      )}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {vm.status === 'ready' && vm.frames.length === 0 && (
        <EmptyState title="No conversation yet" description="Turns appear here as you drive the agent." />
      )}
      {vm.status === 'ready' && vm.frames.length > 0 && (
        <Transcript frames={vm.frames} onRespond={vm.onRespond} label="Conversation" />
      )}
    </Pane>
  );
}

export const chatPanel: PanelDefinition<ChatVm, ConsoleState> = {
  id: 'conversation',
  displayName: 'Chat',
  render: ChatView,
  selectVm: selectChatVm,
};
```

> The panel id is **`conversation`** — it replaces the placeholder of the same id, so the descriptor (which already places a `conversation` leaf in the dock) needs no change.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/ChatPanel.test.tsx`
Expected: PASS (7 tests).

### Task 2.5: Register the chat panel + seed the stream

**Files:**
- Modify: `apps/desktop/src/renderer/panels/registry.ts`
- Modify: `apps/desktop/src/renderer/panels/registry.test.ts`
- Modify: `apps/desktop/src/renderer/console.ts`
- Modify: `apps/desktop/src/renderer/console.test.tsx`

**Interfaces:**
- Consumes: `chatPanel`; `MOCK_TURNS`.
- Produces: the dock `conversation` leaf resolves to the live mock chat; `console.ts` seeds `data.turns`.

- [ ] **Step 1: Register the chat panel.** In `apps/desktop/src/renderer/panels/registry.ts`, import it and replace the `conversation` placeholder registration:

Add the import (after the `costPanel` import):
```ts
import { chatPanel } from './ChatPanel.js';
```
Register it (after `registry.register(accountPanel);`):
```ts
  registry.register(chatPanel);
```
Delete the `conversation` placeholder registration block (the `makePlaceholderPanel('conversation', …)` call). Keep the `agent` placeholder.

- [ ] **Step 2: Assert it in the registry test.** In `apps/desktop/src/renderer/panels/registry.test.ts`, the existing test already checks `conversation` is registered; add an assertion that it is the real chat panel (has a `displayName` of `'Chat'`):

```ts
  it('registers the live chat panel at the conversation id', () => {
    const reg = buildPanelRegistry();
    expect(reg.resolve('conversation')?.displayName).toBe('Chat');
  });
```

- [ ] **Step 3: Seed the mock stream.** In `apps/desktop/src/renderer/console.ts`:

Add the import (after the registry import):
```ts
import { MOCK_TURNS } from './panels/mockConversation.js';
```
After the line `state = { ...state, ui: { ...state.ui, settings } };` (before `engine.mount`), seed the turns so the panel is ready on first paint:
```ts
  state = { ...state, data: { ...state.data, turns: { status: 'ok', value: MOCK_TURNS } } };
```

- [ ] **Step 4: Assert the chat renders.** In `apps/desktop/src/renderer/console.test.tsx`, add a test (the fake bridge is unchanged — turns are shell mock, not a bridge read):

```tsx
  it('renders the mock chat transcript in the dock', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-panel-id="conversation"]')).not.toBeNull();
    expect(container.textContent).toContain('Refactor the auth module');
  });
```

> This asserts a governed **text** frame ("Refactor the auth module") — a `TranscriptRow` rendered directly by the panel's non-virtualized path is not guaranteed, so if Virtuoso renders nothing under jsdom this assertion may need to target the `role="log"` region instead. Prefer asserting `container.querySelector('[role="log"]')` is present if the text assertion is flaky; the row content is already covered by `Transcript.test.tsx`. Adjust at execution time per what jsdom renders.

- [ ] **Step 5: Run the chat + console tests**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/registry.test.ts apps/desktop/src/renderer/console.test.tsx`
Expected: PASS.

### Task 2.6: Part 2 gate sweep + commit

- [ ] **Step 1: Run the full gate sweep**

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

> Other panel test fixtures that construct a full `ConsoleState` (`CostPanel.test.tsx`, `FlagsPanel.test.tsx`, `TimelinePanel.test.tsx`, `AccountPanel.test.tsx`, `SettingsPanel.test.tsx`) now miss `data.turns` and will fail typecheck. Add `turns: { status: 'loading' },` to each such fixture's `data` block. Search: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels` and fix each `stateWith`/state literal the compiler flags. (4b did the same when it grew `ConsoleData`.)

- [ ] **Step 2: Commit Part 2** (stage by name; subject-only)

```bash
git add packages/console-viewmodel/src/reads.ts packages/console-viewmodel/src/reads.test.ts \
  apps/desktop/src/renderer/panels/mockConversation.ts apps/desktop/src/renderer/panels/mockConversation.test.ts \
  apps/desktop/src/renderer/panels/ChatPanel.tsx apps/desktop/src/renderer/panels/ChatPanel.test.tsx \
  apps/desktop/src/renderer/panels/state.ts apps/desktop/src/renderer/panels/registry.ts \
  apps/desktop/src/renderer/panels/registry.test.ts apps/desktop/src/renderer/console.ts \
  apps/desktop/src/renderer/console.test.tsx \
  apps/desktop/src/renderer/panels/CostPanel.test.tsx apps/desktop/src/renderer/panels/FlagsPanel.test.tsx \
  apps/desktop/src/renderer/panels/TimelinePanel.test.tsx apps/desktop/src/renderer/panels/AccountPanel.test.tsx \
  apps/desktop/src/renderer/panels/SettingsPanel.test.tsx
git commit -m "feat: render the mock conversation stream in the console dock"
```

---

# Part 3 — approvals, the deny surface, and the raw toggle

Make the conversation interactive-as-mock: inline approval cards resolved by an inert mock action (SC-1 — the console surfaces, never denies), and the `coa raw` title-bar affordance made live as a mode toggle that reprojects the same stream to verbatim frames (D85). The mock deny frame already lands in the stream from Part 2; here the approval resolution and raw projection are wired.

### Task 3.1: ConsoleState gains raw mode + approval resolution

**Files:**
- Modify: `apps/desktop/src/renderer/panels/state.ts`

**Interfaces:**
- Produces: `ConsoleUi` gains `rawMode: boolean` + `resolvedApprovals: Record<string, 'approved' | 'denied'>`; `ConsoleActions` gains `toggleRaw: () => void` + `respondApproval: (requestId: string, decision: 'approve' | 'deny') => void`.

- [ ] **Step 1: Extend `ConsoleUi` and `ConsoleActions`.** In `apps/desktop/src/renderer/panels/state.ts`:

`ConsoleUi`:
```ts
export interface ConsoleUi {
  /** Which surface panel currently fills the nav-driven main region. */
  activeMainPanelId: string;
  settings: ConsoleSettings;
  /** When true the conversation renders the unfiltered loop (D85). */
  rawMode: boolean;
  /** Inert local record of mock approvals the operator resolved (SC-1: surfacing
   *  only — the daemon owns the real decision). */
  resolvedApprovals: Record<string, 'approved' | 'denied'>;
}
```
`ConsoleActions`:
```ts
export interface ConsoleActions {
  setRoute: (panelId: string) => void;
  refresh: () => void;
  switchAccount: (label: string) => void;
  setSettings: (patch: Partial<ConsoleSettings>) => void;
  toggleRaw: () => void;
  respondApproval: (requestId: string, decision: 'approve' | 'deny') => void;
}
```
Seed the new `ui` fields in `initialState` (in the `ui` block):
```ts
    ui: {
      activeMainPanelId: DEFAULT_MAIN_PANEL_ID,
      settings: DEFAULT_SETTINGS,
      rawMode: false,
      resolvedApprovals: {},
    },
```

### Task 3.2: The raw + approval projection in the chat selector

**Files:**
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx`
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.test.tsx`

**Interfaces:**
- Produces: `function frameToRawLine(f: TurnFrame): string`; `selectChatVm` now honors `ui.rawMode` + `ui.resolvedApprovals` + wires `state.actions.respondApproval`.

- [ ] **Step 1: Add raw/approval tests.** In `apps/desktop/src/renderer/panels/ChatPanel.test.tsx`, extend the `stateWith` helper to accept ui overrides, and add tests. Replace the `stateWith` definition with:

```tsx
const stateWith = (
  turns: ConsoleState['data']['turns'],
  ui: Partial<ConsoleState['ui']> = {},
): ConsoleState => ({
  data: {
    cap: { status: 'loading' },
    flags: { status: 'loading' },
    timeline: { status: 'loading' },
    accounts: { status: 'loading' },
    turns,
  },
  ui: {
    activeMainPanelId: 'cost',
    settings: { theme: 'dark', density: 'comfortable', motion: 'full' },
    rawMode: false,
    resolvedApprovals: {},
    ...ui,
  },
  actions: {
    setRoute: () => {},
    refresh: () => {},
    switchAccount: () => {},
    setSettings: () => {},
    toggleRaw: () => {},
    respondApproval: () => {},
  },
});
```

Add these tests (after the existing `selectChatVm` block):

```tsx
import { frameToRawLine } from './ChatPanel.js';

describe('raw + approval projection', () => {
  const stream: TurnFrame[] = [
    { id: '1', role: 'agent', kind: 'text', text: 'hi' },
    { id: '2', kind: 'approval', requestId: 'r1', tool: 'write_file', summary: 's' },
  ];

  it('serializes each frame to a verbatim raw line', () => {
    expect(frameToRawLine({ id: '1', role: 'agent', kind: 'text', text: 'hi' })).toContain('agent');
    expect(frameToRawLine({ id: '1', role: 'agent', kind: 'text', text: 'hi' })).toContain('hi');
  });

  it('reprojects the stream to raw frames in raw mode', () => {
    const vm = selectChatVm(stateWith({ status: 'ok', value: stream }, { rawMode: true }));
    expect(vm.status).toBe('ready');
    if (vm.status === 'ready') {
      expect(vm.rawMode).toBe(true);
      expect(vm.frames.every((f) => f.kind === 'raw')).toBe(true);
    }
  });

  it('overlays a resolved approval from ui state', () => {
    const vm = selectChatVm(stateWith({ status: 'ok', value: stream }, { resolvedApprovals: { r1: 'approved' } }));
    if (vm.status === 'ready') {
      const approval = vm.frames.find((f) => f.kind === 'approval');
      expect(approval).toMatchObject({ resolved: 'approved' });
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/ChatPanel.test.tsx`
Expected: FAIL (no `frameToRawLine`; `selectChatVm` ignores `rawMode`/`resolvedApprovals`).

- [ ] **Step 3: Implement the projection.** In `apps/desktop/src/renderer/panels/ChatPanel.tsx`, add `frameToRawLine` (after `toGovernedFrame`) and rewrite `selectChatVm`:

```ts
/** The verbatim (unfiltered-loop) projection of one frame. Mock stand-in for the
 *  turn store's raw bytes; rendered byte-faithfully via the Code block (D128). */
export function frameToRawLine(f: TurnFrame): string {
  switch (f.kind) {
    case 'text':
      return `> ${f.role}: ${f.text}`;
    case 'tool-use':
      return `> ${f.role}: tool_use ${f.tool} ${f.input}`;
    case 'tool-result':
      return `> ${f.role}: tool_result ${f.tool} ${f.ok ? 'ok' : 'error'} ${f.output}`;
    case 'approval':
      return `> control: approval_request ${f.tool} (${f.requestId})`;
    case 'deny':
      return `> control: deny ${f.denyKind} ${f.reason}`;
  }
}
```

Replace `selectChatVm` with:
```ts
export function selectChatVm(state: ConsoleState): ChatVm {
  const r = state.data.turns;
  if (r.status !== 'ok') return r;
  const { rawMode, resolvedApprovals } = state.ui;
  const frames: TranscriptFrame[] = rawMode
    ? r.value.map((f) => ({ id: f.id, kind: 'raw', text: frameToRawLine(f) }))
    : r.value.map((f) => {
        const g = toGovernedFrame(f);
        if (g.kind === 'approval' && resolvedApprovals[g.requestId] !== undefined) {
          return { ...g, resolved: resolvedApprovals[g.requestId] };
        }
        return g;
      });
  return { status: 'ready', rawMode, frames, onRespond: state.actions.respondApproval };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/panels/ChatPanel.test.tsx`
Expected: PASS (10 tests).

### Task 3.3: Controller — toggleRaw + respondApproval; App wiring

**Files:**
- Modify: `apps/desktop/src/renderer/console.ts`
- Modify: `apps/desktop/src/renderer/console.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

**Interfaces:**
- Produces: `ConsoleController` gains `toggleRaw(): void`; the console installs `toggleRaw` + `respondApproval` into `state.actions`; `App.tsx` wires `onRaw → controller.toggleRaw()`.

- [ ] **Step 1: Implement the actions.** In `apps/desktop/src/renderer/console.ts`:

Extend the `ConsoleController` interface:
```ts
export interface ConsoleController {
  refresh(): Promise<void>;
  toggleRaw(): void;
  dispose(): void;
}
```
Add the two action closures (after `setSettings`, before the final `state = { ...state, actions: … }`):
```ts
  const toggleRaw = (): void => {
    state = { ...state, ui: { ...state.ui, rawMode: !state.ui.rawMode } };
    push();
  };

  const respondApproval = (requestId: string, decision: 'approve' | 'deny'): void => {
    const resolved = decision === 'approve' ? 'approved' : 'denied';
    state = {
      ...state,
      ui: { ...state.ui, resolvedApprovals: { ...state.ui.resolvedApprovals, [requestId]: resolved } },
    };
    push();
  };
```
Add them to the `actions` install:
```ts
  state = {
    ...state,
    actions: {
      setRoute,
      refresh: () => void refresh(),
      switchAccount,
      setSettings,
      toggleRaw,
      respondApproval,
    },
  };
```
Return `toggleRaw` from the controller:
```ts
  return { refresh, toggleRaw, dispose: () => handle.dispose() };
```

- [ ] **Step 2: Add a raw-toggle test.** In `apps/desktop/src/renderer/console.test.tsx`, add:

```tsx
  it('toggles the conversation into raw mode', async () => {
    const { container, controller } = await mount();
    expect(container.textContent).not.toContain('Chat · raw');
    await act(async () => {
      controller.toggleRaw();
    });
    expect(container.textContent).toContain('Chat · raw');
  });
```

- [ ] **Step 3: Wire the title-bar affordance.** Replace `apps/desktop/src/renderer/App.tsx` with:

```tsx
import { useEffect, useRef } from 'react';
import { AppShell } from '@coa/console-ui';
import { startConsole, type ConsoleController } from './console.js';

const POLL_MS = 2000;

export function App(): React.JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ConsoleController | undefined>(undefined);

  useEffect(() => {
    const container = slotRef.current;
    if (!container) return;
    let controller: ConsoleController | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    void (async () => {
      controller = await startConsole(container, window.coa);
      controllerRef.current = controller;
      if (disposed) {
        controller.dispose();
        return;
      }
      await controller.refresh();
      timer = setInterval(() => void controller?.refresh(), POLL_MS);
    })();
    return () => {
      disposed = true;
      controllerRef.current = undefined;
      if (timer) clearInterval(timer);
      controller?.dispose();
    };
  }, []);

  return (
    <AppShell
      platform={window.coa.platform}
      workspaceName="myproject"
      onRaw={() => controllerRef.current?.toggleRaw()}
    >
      <div ref={slotRef} style={{ height: '100%' }} />
    </AppShell>
  );
}
```

- [ ] **Step 4: Run the console tests**

Run: `pnpm_config_verify_deps_before_run=false corepack pnpm exec vitest run apps/desktop/src/renderer/console.test.tsx`
Expected: PASS.

### Task 3.4: Part 3 gate sweep + commit

- [ ] **Step 1: Run the full gate sweep**

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

> Any panel test fixture that constructs a full `ConsoleState['ui']` or `actions` (from Part 2's fixups) now misses `rawMode`/`resolvedApprovals`/`toggleRaw`/`respondApproval` and will fail typecheck. Add them to each flagged fixture (`rawMode: false, resolvedApprovals: {}` in `ui`; `toggleRaw: () => {}, respondApproval: () => {}` in `actions`). Fix each compiler-flagged site.

- [ ] **Step 2: Commit Part 3** (stage by name; subject-only)

```bash
git add apps/desktop/src/renderer/panels/state.ts apps/desktop/src/renderer/panels/ChatPanel.tsx \
  apps/desktop/src/renderer/panels/ChatPanel.test.tsx apps/desktop/src/renderer/console.ts \
  apps/desktop/src/renderer/console.test.tsx apps/desktop/src/renderer/App.tsx
# plus any panel *.test.tsx fixtures updated for the new ui/actions fields
git commit -m "feat: add inline approval cards and a raw conversation toggle"
```

---

## Self-review checklist (run after execution planning, before executing)

- **Spec coverage (§21.3):** structured chat stream → Part 2 (`Transcript` + `ChatPanel`); inline approval cards → Parts 1+3; `coa raw` mode → Part 3; the new **Transcript** Dense/Viz component built real (react-virtuoso), byte-faithful, states-first → Part 1; mock shape mirrored in `console-viewmodel` → Part 2; SC-1 inert approvals + mock DenyNotice, live deny wiring deferred → Parts 1/2/3 + noted. Compiled-prompt/graph/agent-config are **out of scope** (sub-plans 4c-2/4c-3). ✔
- **Placeholder scan:** no TBD/TODO; every code step has full code. ✔
- **Type consistency:** `TranscriptFrame` (console-ui) vs `TurnFrame` (console-viewmodel) are distinct and mapped by `toGovernedFrame`/`frameToRawLine`; `RespondFn` signature `(requestId, 'approve'|'deny')` matches `Transcript.onRespond`, `ChatVm.onRespond`, and `actions.respondApproval`; `resolved` values `'approved'|'denied'` are consistent between the component, the ui record, and the selector overlay. ✔
- **jsdom risk:** all rendering logic is covered by direct `TranscriptRow` tests + the pure `selectChatVm`/`frameToRawLine`/`toGovernedFrame` tests, so no assertion depends on Virtuoso virtualizing items under jsdom (Task 2.5 Step 4 carries an explicit fallback). ✔

_Last reviewed: 2026-07-01_
