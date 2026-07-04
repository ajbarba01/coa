# Chat Professionalization — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the console chat foundation to be smooth, fully selectable/searchable, and correct — non-virtualized transcript, native stick-to-bottom scroll, per-session output routing, a real floating composer, and the render polish — over data already streaming.

**Architecture:** Replace the windowed `GroupedVirtuoso` + hand-rolled scroll-lerp with a **non-virtualized** scroll container (every frame in the DOM, `content-visibility` for off-screen perf, `React.memo` rows), native stick-to-bottom via a bottom sentinel + `pinned` state, and a `sessionId`-routed push handler. Then layer the professional polish (spacing, user-message restyle, composer rebuild, thinking/code fixes, copy/find/running-state).

**Tech Stack:** TypeScript (strict, no `any`), React 18, Tailwind (token utilities only), Vitest + Testing Library (jsdom), pnpm workspaces, lucide-react icons. Design authority: [docs/superpowers/specs/2026-07-04-chat-professionalization-design.md](../specs/2026-07-04-chat-professionalization-design.md).

## Global Constraints

- **TypeScript `strict`, no `any`.** `exactOptionalPropertyTypes` is on — optional props are typed `T | undefined`.
- **Token-only styling.** No raw hex/px colors; use semantic token utilities (`bg-raised`, `text-muted`, `info`, etc.). "Blue" = the `info` token.
- **Renderer isolation / D128.** No `dangerouslySetInnerHTML`; diffs/code render byte-faithfully.
- **SC-1 / D85.** Console adds no block; `coa raw` mode (all `kind:'raw'`) must remain byte-verbatim and untouched by any grouping/fold/tool change.
- **Kit boundary.** Reusable render lives in `packages/console-ui`; app composition/IPC in `apps/desktop`. New kit members need an intent block (match neighbors, e.g. `Transcript.intent.ts`).
- **Commits:** subject-only Conventional Commits — **no body, no `Co-Authored-By`, no "Generated with" trailer**. No project-internal identifiers (module IDs/phase numbers) in the subject. Stage files **by name** (never `git add -A`). One logical unit per commit; do not skip hooks.
- **Test commands:** `corepack pnpm -C packages/console-ui test`, `corepack pnpm -C apps/desktop test`, `corepack pnpm test` (workspace). Build gate: `corepack pnpm -C apps/desktop build` + `tsc -b`.
- **Same-commit doc rule:** a change that adds/moves/deletes files updates the relevant doc (`REPO_LAYOUT.md`, `COMPONENTS.md`, `UI.md`) in the same commit.

---

## File Structure

**Modified:**
- `apps/desktop/src/renderer/console.ts` — push routed by `sessionId`; per-session turn buffers + per-session run status.
- `apps/desktop/src/renderer/panels/state.ts` — state shape: `turnsBySession`, `statusBySession` (replacing the single `sending`/`sentAt`/`turns` where noted).
- `apps/desktop/src/renderer/panels/ChatPanel.tsx` — vm wiring for per-session status, composer slots, running-ring, find-bar host, switched-model note, jump-to-prompt.
- `packages/console-ui/src/dense/Transcript.tsx` — non-virtualized rebuild: native scroll, `content-visibility`, memoized rows, sentinel/`pinned`, jump-to-latest/prompt, find integration, copy-message, appear-animation.
- `packages/console-ui/src/dense/Composer.tsx` — floating rounded surface, glyph send/stop, attach/mic/permission inert, phantom-scrollbar fix, no-session disabled.
- `packages/console-ui/src/dense/Markdown.tsx` — GFM task-list checkbox styling.
- `packages/console-ui/src/dense/CodeBlock.tsx` — `overflow-x-auto`.
- `packages/console-viewmodel/src/turn-map.ts` — drop empty-text thinking frames.
- `packages/console-ui/src/index.ts` — export any new members/helpers.
- `apps/desktop/src/renderer/globals.css` — turn appear-animation keyframes.

**Created:**
- `packages/console-ui/src/dense/scrollState.ts` (+ `.test.ts`) — pure stick-to-bottom / jump-target logic.
- `packages/console-ui/src/dense/find.ts` (+ `.test.ts`) — pure find-in-conversation matcher.
- `packages/console-ui/src/dense/FindBar.tsx` — the Ctrl-F overlay control.

**Deleted:**
- `packages/console-ui/src/dense/smoothScroll.ts` + `smoothScroll.test.ts`.

---

## Task 1: Route live output by session (bug S)

**Files:**
- Modify: `apps/desktop/src/renderer/panels/state.ts`
- Modify: `apps/desktop/src/renderer/console.ts:334-428` (append/push handlers), `:393-437` (sending helpers)
- Test: `apps/desktop/src/renderer/console.test.tsx`

**Interfaces:**
- Consumes: `pushSchema` / `Push` (has `sessionId` on `turn` & `status`), `TurnFrame`.
- Produces: `state.data.turns` continues to be the **active** session's frames; new internal `turnsBySession: Record<string, TurnFrame[]>` and `runStatus: Record<string, { since: number }>`; `appendTurns(sessionId, frames)` now takes a session id.

- [ ] **Step 1: Write the failing test** — a `turn` push for a non-active session must NOT append to the active transcript, and a `status running` for a background session must not flip the active pill.

Add to `apps/desktop/src/renderer/console.test.tsx` (follow the file's existing bridge-mock + `startConsole` harness; find the `onPush` test group):

```ts
it('routes pushes by sessionId — background session output does not leak into the active one', async () => {
  const { bridge, emitPush } = makeBridge(); // existing helper in this file
  // two sessions exist; 's-active' is opened/active, 's-bg' is running in the background
  bridge.listSessions.mockResolvedValue([
    sessionSummary('s-active'), sessionSummary('s-bg'),
  ]);
  const ctrl = await startConsole(container, bridge);
  await flush();
  // a turn for the NON-active session
  emitPush({ kind: 'turn', sessionId: 's-bg', worktree: 'wt', seq: 1,
    frame: { t: 'text', text: 'background output' } });
  await flush();
  expect(container.textContent).not.toContain('background output');
  ctrl.dispose();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm -C apps/desktop test -- console.test`
Expected: FAIL — the frame currently appends to the active transcript.

- [ ] **Step 3: Add per-session state fields**

In `apps/desktop/src/renderer/panels/state.ts`, extend the console UI state (locate the `ui` shape holding `sending`/`sentAt`):

```ts
// Run status keyed by session so switching sessions shows the right pill and never
// leaks a running indicator across the switch.
runStatus: Record<string, { since: number }>;
```

Keep `sending`/`sentAt` for the ACTIVE session's optimistic feedback, but treat them as derived from `runStatus[activeSessionId]` (added in Step 4). Initialize `runStatus: {}` in `initialState`.

- [ ] **Step 4: Route the push handler by sessionId**

In `console.ts`, hold a module-local buffer and rewrite `appendTurns` + `onPush`:

```ts
// Per-session live buffers so a background session's streamed frames are retained,
// not misfiled into whatever transcript is active.
const turnsBySession = new Map<string, TurnFrame[]>();

/** Append frames to a session's buffer; publish to the visible transcript only when
 *  that session is the active one. */
const appendTurns = (sessionId: string, frames: TurnFrame[]): void => {
  if (frames.length === 0) return;
  const prev = turnsBySession.get(sessionId) ?? [];
  const next = [...prev, ...frames];
  turnsBySession.set(sessionId, next);
  if (sessionId === state.ui.activeSessionId) {
    state = { ...state, data: { ...state.data, turns: { status: 'ok', value: next } } };
    push();
  }
};

const unsubscribePush = bridge.onPush((payload) => {
  const parsed = pushSchema.safeParse(payload);
  if (!parsed.success) return;
  const data = parsed.data;
  if (data.kind === 'status') {
    const runStatus = { ...state.ui.runStatus };
    if (data.state === 'running') runStatus[data.sessionId] ??= { since: Date.now() };
    else delete runStatus[data.sessionId];
    state = { ...state, ui: { ...state.ui, runStatus } };
    if (data.state === 'done') void refreshSessionList();
    push();
    return;
  }
  if ('sessionId' in data) appendTurns(data.sessionId, pushToViewFrames(data));
});
```

Update `openSession` to seed `turnsBySession` from the reloaded store and read the active buffer:

```ts
async function openSession(id: string): Promise<void> {
  const loaded = await settle(() => bridge.reloadConversation({ id }));
  if (loaded.status === 'ok') turnsBySession.set(id, reloadToViewFrames(loaded.value));
  const turns: Remote<TurnFrame[]> =
    loaded.status === 'ok' ? { status: 'ok', value: turnsBySession.get(id) ?? [] } : loaded;
  state = { ...state, data: { ...state.data, turns }, ui: { ...state.ui, activeSessionId: id } };
  push();
}
```

Update `sendMessage` to append via the new signature (`appendTurns(id, [...])`) and set `runStatus[id]` instead of the global `sending`. Remove `clearSending`/`affirmSending` (replaced by `runStatus`). The dispatch-failure `catch` deletes `runStatus[id]`.

- [ ] **Step 5: Derive the active pill from runStatus in the vm**

In `ChatPanel.tsx` `selectChatVm`, replace the `sessionStatus`/`runningSince` derivation:

```ts
const active = activeSessionId ? state.ui.runStatus[activeSessionId] : undefined;
// ...
sessionStatus: active ? 'running' : 'idle',
...(active ? { runningSince: active.since } : {}),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `corepack pnpm -C apps/desktop test -- console.test`
Expected: PASS. Also run the full desktop suite: `corepack pnpm -C apps/desktop test` (fix any `sending`/`sentAt` references the refactor orphaned).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/console.ts apps/desktop/src/renderer/panels/state.ts apps/desktop/src/renderer/panels/ChatPanel.tsx apps/desktop/src/renderer/console.test.tsx
git commit -m "fix: route streamed session output by session id"
```

---

## Task 2: Pure stick-to-bottom / jump logic

**Files:**
- Create: `packages/console-ui/src/dense/scrollState.ts`, `packages/console-ui/src/dense/scrollState.test.ts`

**Interfaces:**
- Produces:
  - `nearBottom(scrollTop: number, clientHeight: number, scrollHeight: number, thresholdPx?: number): boolean`
  - `previousPromptIndex(frames: TranscriptFrame[], fromIndex: number): number | undefined` — index of the nearest `you` text frame strictly above `fromIndex`, for jump-to-prompt.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { nearBottom, previousPromptIndex } from './scrollState.js';
import type { TranscriptFrame } from './Transcript.js';

describe('nearBottom', () => {
  it('is true within the threshold and false beyond it', () => {
    expect(nearBottom(880, 100, 1000, 100)).toBe(true);   // 20px from bottom
    expect(nearBottom(700, 100, 1000, 100)).toBe(false);  // 200px from bottom
  });
});

describe('previousPromptIndex', () => {
  const f = (id: string, role: 'you' | 'agent'): TranscriptFrame =>
    ({ id, role, kind: 'text', text: id });
  const frames = [f('u1', 'you'), f('a1', 'agent'), f('u2', 'you'), f('a2', 'agent')];
  it('finds the nearest user prompt above the cursor', () => {
    expect(previousPromptIndex(frames, 3)).toBe(2);
    expect(previousPromptIndex(frames, 2)).toBe(0);
    expect(previousPromptIndex(frames, 0)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm -C packages/console-ui test -- scrollState`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { TranscriptFrame } from './Transcript.js';

/** Whether the scroll position is within `thresholdPx` of the bottom. A threshold
 *  (not exact equality) absorbs sub-pixel rounding so stick-to-bottom is stable. */
export function nearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  thresholdPx = 80,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= thresholdPx;
}

const isUserText = (fr: TranscriptFrame): boolean =>
  'role' in fr && fr.role === 'you' && fr.kind === 'text';

/** Index of the nearest user-prompt frame strictly above `fromIndex`, or undefined
 *  if none — drives the "↑ previous prompt" jump. */
export function previousPromptIndex(
  frames: TranscriptFrame[],
  fromIndex: number,
): number | undefined {
  for (let i = Math.min(fromIndex, frames.length) - 1; i >= 0; i--) {
    if (isUserText(frames[i]!)) return i;
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm -C packages/console-ui test -- scrollState`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/scrollState.ts packages/console-ui/src/dense/scrollState.test.ts
git commit -m "feat: add pure stick-to-bottom and jump-to-prompt helpers"
```

---

## Task 3: Non-virtualized Transcript foundation

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx`
- Delete: `packages/console-ui/src/dense/smoothScroll.ts`, `smoothScroll.test.ts`
- Modify: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:**
- Consumes: `foldToolFrames`, `TranscriptRow` (kept), `nearBottom`/`previousPromptIndex`, `dotTone`.
- Produces: `Transcript` renders a native scroll `<div role="log">` containing all rows + a bottom sentinel; keeps the existing `TranscriptProps` (`frames`, `onRespond`, `label`, `className`, `busy`, `busySince`, `showJumpToLatest`). Drops `GroupedVirtuoso`, `groupByUserTurn` as the layout mechanism, and `startSmoothScroll`.

- [ ] **Step 1: Delete the lerp module**

```bash
git rm packages/console-ui/src/dense/smoothScroll.ts packages/console-ui/src/dense/smoothScroll.test.ts
```

- [ ] **Step 2: Write the failing test** — the transcript renders every frame's content (no windowing) and exposes a memoized row.

In `Transcript.test.tsx`, replace/augment the container test:

```ts
it('renders every frame to the DOM (non-virtualized)', () => {
  const frames: TranscriptFrame[] = Array.from({ length: 60 }, (_, i) => ({
    id: `t${i}`, role: 'agent' as const, kind: 'text' as const, text: `line ${i}`,
  }));
  render(<Transcript frames={frames} />);
  // Every line is present — including ones far off-screen (would be absent if windowed).
  expect(screen.getByText('line 0')).toBeInTheDocument();
  expect(screen.getByText('line 59')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm -C packages/console-ui test -- Transcript`
Expected: FAIL — GroupedVirtuoso only mounts a window; `line 59` is absent in jsdom.

- [ ] **Step 4: Rebuild the container**

Replace the `Transcript` function body (keep `TranscriptRow`, `foldToolFrames`, `dotTone`, `WorkingFooter`, `SpineGutter`, `RowShell` and the frame types above it). New body:

```tsx
export function Transcript({
  frames, onRespond, label = 'Conversation', className, showJumpToLatest, busy, busySince,
}: TranscriptProps): React.JSX.Element | null {
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // Folded once per frames change (was recomputed every render).
  const items = useMemo(() => foldToolFrames(frames), [frames]);

  // Stick-to-bottom: while pinned and content grows, keep the sentinel in view. A
  // ResizeObserver on the content fires on every appended/streamed row.
  useLayoutEffect(() => {
    if (!pinned) return;
    sentinel.current?.scrollIntoView({ block: 'end' });
  });

  const onScroll = (): void => {
    const el = scroller.current;
    if (el === null) return;
    setPinned(nearBottom(el.scrollTop, el.clientHeight, el.scrollHeight));
  };

  const jumpToLatest = (): void => {
    setPinned(true);
    sentinel.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  };

  if (items.length === 0) return null;
  const showJump = showJumpToLatest ?? !pinned;

  return (
    <div className={cx('relative h-full min-h-0', className)}>
      <div
        ref={scroller}
        onScroll={onScroll}
        role="log"
        aria-label={label}
        // Native scroll; content capped to a readable measure and centered (§5.2).
        className="h-full overflow-y-auto"
      >
        <div className="mx-auto flex max-w-180 flex-col">
          {items.map((item, index) => (
            <MemoRow key={item.id} frame={item} onRespond={onRespond} index={index} />
          ))}
          {busy === true && <WorkingFooter busySince={busySince} />}
          <div ref={sentinel} aria-hidden className="h-0" />
        </div>
      </div>
      {showJump && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
          <Button variant="secondary" size="sm" className="pointer-events-auto bg-raised" onClick={jumpToLatest}>
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}
```

Add the memoized row wrapper (each row gets `content-visibility` for off-screen perf without unmounting — selection stays intact):

```tsx
/** Memoized so a streamed frame re-renders only the appended row, and `content-visibility`
 *  lets the browser skip layout/paint for off-screen rows while keeping them in the DOM
 *  (full-transcript selection + Ctrl-F). `contain-intrinsic-size` is a height estimate that
 *  prevents scrollbar jump; tuned to a typical row. */
const MemoRow = memo(function MemoRow({
  frame, onRespond,
}: { frame: TranscriptFrame; onRespond?: RespondFn | undefined; index: number }): React.JSX.Element {
  return (
    <div style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 60px' } as React.CSSProperties}>
      <TranscriptRow frame={frame} />
    </div>
  );
});
```

(Pass `onRespond` into `TranscriptRow` — its signature already accepts it; keep the existing spine props defaulting to full through-line now that grouping is gone. Remove `spineTop`/`spineBottom` container plumbing and the `itemSpine`/`groupItemStart`/`groupByUserTurn` usage; the spine now breaks at user rows purely via `RowShell`'s `isUser` check, so a run reads continuous and breaks at each user turn without group math.) Update imports: drop `GroupedVirtuoso`, `startSmoothScroll`, `groupByUserTurn`; add `useMemo`, `useLayoutEffect`, `memo`, `nearBottom`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `corepack pnpm -C packages/console-ui test -- Transcript`
Expected: PASS. Remove any now-dead tests for `groupItemStart`/`itemSpine`/`smoothScroll`.

- [ ] **Step 6: Build gate**

Run: `corepack pnpm -C apps/desktop build`
Expected: clean (surfaces any leftover import of the removed exports).

- [ ] **Step 7: Live verification** (scroll behavior isn't measurable in jsdom)

Run: `corepack pnpm -C apps/desktop dev`. In Chat: scroll a long conversation (smooth, no lag), select text from the first message through the last (unbroken), streaming pins to bottom, scrolling up shows "Jump to latest", clicking it locks to bottom and the button disappears.

- [ ] **Step 8: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "refactor: render the transcript non-virtualized with native stick-to-bottom"
```

---

## Task 4: Snap-to-sent + jump-to-prompt wiring

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx`
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx`
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:**
- Consumes: `previousPromptIndex`.
- Produces: `Transcript` gains a `jumpNonce?: number | undefined` prop — when it changes, the transcript force-pins to bottom (used on send). A "↑ previous prompt" control scrolls to the nearest user row above the current viewport top.

- [ ] **Step 1: Write the failing test** — bumping `jumpNonce` re-pins even after a manual scroll-up.

```ts
it('re-pins to bottom when jumpNonce changes', () => {
  const frames: TranscriptFrame[] = [{ id: 'a', role: 'agent', kind: 'text', text: 'hi' }];
  const { rerender } = render(<Transcript frames={frames} jumpNonce={0} showJumpToLatest />);
  // showJumpToLatest forces the button on; after a jumpNonce bump the component pins.
  rerender(<Transcript frames={frames} jumpNonce={1} />);
  // Not directly observable in jsdom; assert the sentinel scrollIntoView was called.
  // (spy set up in beforeEach — see existing scrollIntoView mock pattern)
  expect(scrollIntoViewSpy).toHaveBeenCalled();
});
```

Add a `beforeEach` spy if the file lacks one: `const scrollIntoViewSpy = vi.fn(); beforeEach(() => { Element.prototype.scrollIntoView = scrollIntoViewSpy; });`

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm -C packages/console-ui test -- Transcript`
Expected: FAIL — `jumpNonce` unhandled.

- [ ] **Step 3: Implement** — add the prop + effect + prompt control in `Transcript.tsx`:

```tsx
// in TranscriptProps
jumpNonce?: number | undefined;
```

```tsx
// inside Transcript, after the pinned effect
useLayoutEffect(() => {
  if (jumpNonce === undefined) return;
  setPinned(true);
  sentinel.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
}, [jumpNonce]);

const jumpToPrompt = (): void => {
  const el = scroller.current;
  if (el === null) return;
  // topmost fully-visible row index ≈ current scrollTop mapped to a row; use the last
  // user row above the viewport top via previousPromptIndex over the rendered rows.
  const rows = el.querySelectorAll('[data-row-index]');
  let top = 0;
  rows.forEach((r) => {
    if (r instanceof HTMLElement && r.offsetTop <= el.scrollTop + 4) top = Number(r.dataset.rowIndex);
  });
  const target = previousPromptIndex(items, top);
  if (target === undefined) return;
  const el2 = el.querySelector(`[data-row-index="${target}"]`);
  if (el2 instanceof HTMLElement) el2.scrollIntoView({ block: 'start', behavior: 'smooth' });
  setPinned(false);
};
```

Add `data-row-index={index}` to the `MemoRow` wrapper div. Render a "↑ previous prompt" `IconButton` next to jump-to-latest (only when `!pinned` or always; keep unobtrusive, `bg-raised`). Import `previousPromptIndex`, `ArrowUp` from lucide.

- [ ] **Step 4: Wire the send-nonce in ChatPanel**

In `ChatPanel.tsx`, pass a nonce that bumps on send. Simplest: derive from the active session's last user frame count, or add a `sendNonce` counter to console state incremented in `sendMessage`. Add to `ChatVm` + pass `jumpNonce={vm.sendNonce}` to `<Transcript>`.

- [ ] **Step 5: Run tests**

Run: `corepack pnpm -C packages/console-ui test -- Transcript`
Expected: PASS.

- [ ] **Step 6: Live verification** — scroll up, send a message → view snaps to your new message; "↑ previous prompt" jumps to the prior user turn.

- [ ] **Step 7: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.test.tsx apps/desktop/src/renderer/panels/ChatPanel.tsx
git commit -m "feat: snap to sent message and add jump-to-prompt navigation"
```

---

## Task 5: User message restyle + turn spacing

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (the shared text/tool branch + user row)
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:** no new exports; the user row's classes change.

- [ ] **Step 1: Write the failing test** — the user row is not a bordered button surface and carries no bottom rule.

```ts
it('renders a user turn as a tinted block without a full border or bottom rule', () => {
  render(<TranscriptRow frame={{ id: 'u', role: 'you', kind: 'text', text: 'hello' }} />);
  const block = screen.getByText('hello').closest('[data-role="you"]');
  expect(block?.className).toContain('bg-raised');
  expect(block?.className).not.toContain('border-hairline');
  expect(block?.className).not.toContain('border-b');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm -C packages/console-ui test -- Transcript`
Expected: FAIL — current class is `border border-hairline`.

- [ ] **Step 3: Implement** — in the shared text/tool branch of `TranscriptRow`, change the user styling:

```tsx
className={cx(
  'min-w-0',
  isUser && 'my-1 rounded-surface bg-raised px-3 py-2 shadow-sm',
)}
```

Increase inter-turn rhythm: bump the text branch padding from `pt-[6.5px] pb-3` to `py-3` and add vertical gap between turns via the container (`flex flex-col` already stacks; add `gap-1` on the inner column in `Transcript`, and rely on per-row padding for the ~20–24px rhythm). Keep long-prompt clamp: the user block already supports the expand caret from the polish spec — leave that intact.

- [ ] **Step 4: Run tests**

Run: `corepack pnpm -C packages/console-ui test -- Transcript`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "style: restyle user turns as tinted blocks and open up turn spacing"
```

---

## Task 6: Code-block overflow + task-list checkboxes

**Files:**
- Modify: `packages/console-ui/src/dense/CodeBlock.tsx`
- Modify: `packages/console-ui/src/dense/Markdown.tsx`
- Test: `packages/console-ui/src/dense/Markdown.test.tsx`

- [ ] **Step 1: Write the failing test** — fenced code sits in a horizontally scrollable container.

In `Markdown.test.tsx`:

```ts
it('wraps fenced code in a horizontally scrollable block', () => {
  render(<Markdown source={'```ts\nconst x = 1;\n```'} />);
  const pre = document.querySelector('pre');
  expect(pre?.parentElement?.className).toContain('overflow-x-auto');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm -C packages/console-ui test -- Markdown`
Expected: FAIL — no `overflow-x-auto` wrapper.

- [ ] **Step 3: Implement** — in `CodeBlock.tsx` add the scroll wrapper around the highlighter:

```tsx
<div className="overflow-x-auto p-2">
  <SyntaxHighlighter /* …unchanged… */>{code}</SyntaxHighlighter>
</div>
```

In `Markdown.tsx`, add token-styled task-list rendering. remark-gfm emits `<li className="task-list-item">` with an `<input type="checkbox" disabled>`; add an `input` component override:

```tsx
input: ({ type, checked }) =>
  type === 'checkbox' ? (
    <span
      aria-hidden
      className={cx(
        'mr-1.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border align-middle',
        checked ? 'border-accent bg-accent text-on-accent' : 'border-hairline',
      )}
    >
      {checked ? '✓' : ''}
    </span>
  ) : null,
li: ({ className: c, children }) => (
  <li className={cx('leading-normal', (c ?? '').includes('task-list-item') && 'list-none')}>{children}</li>
),
```

- [ ] **Step 4: Run tests**

Run: `corepack pnpm -C packages/console-ui test -- Markdown`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/CodeBlock.tsx packages/console-ui/src/dense/Markdown.tsx packages/console-ui/src/dense/Markdown.test.tsx
git commit -m "fix: scroll long code lines and theme gfm task-list checkboxes"
```

---

## Task 7: Thinking — hover tint + empty not expandable

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (`ThinkingCard`, and the `thinking` branch)
- Modify: `packages/console-viewmodel/src/turn-map.ts`
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`, `packages/console-viewmodel/src/turn-map.test.ts`

- [ ] **Step 1: Write the failing tests**

Transcript (component): an empty-text thinking frame renders no toggle; a non-empty one has a hover-tint class.

```ts
it('does not render an expandable thinking block when the text is empty', () => {
  render(<TranscriptRow frame={{ id: 't', role: 'agent', kind: 'thinking', text: '   ' }} />);
  expect(screen.queryByRole('button', { name: /thinking/i })).toBeNull();
});
it('tints the thinking label on hover', () => {
  render(<TranscriptRow frame={{ id: 't', role: 'agent', kind: 'thinking', text: 'reasoning' }} />);
  expect(screen.getByText('Thinking').className).toContain('group-hover:text-muted');
});
```

turn-map: an empty thinking push produces no frame.

```ts
it('drops empty-text thinking frames', () => {
  expect(pushToViewFrames({ kind: 'turn', sessionId: 's', worktree: 'w', seq: 1,
    frame: { t: 'thinking', text: '  ' } })).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm -C packages/console-ui test -- Transcript` and `corepack pnpm -C packages/console-viewmodel test -- turn-map`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `turn-map.ts`, the `thinking` case returns `[]` when blank (adjust the map to filter — the function returns `TurnFrame[]`, so return an empty array for blank thinking):

```ts
case 'thinking': {
  const text = frame.text.trim();
  return text.length === 0 ? [] : [{ id, role: 'agent', kind: 'thinking', text: frame.text, ...d }];
}
```

(If the surrounding function returns a single frame, refactor its `thinking` branch to skip the push — mirror how the file already returns arrays; keep other cases intact.)

In `TranscriptRow`'s `thinking` branch, guard empty and pass a hover group:

```tsx
if (frame.kind === 'thinking') {
  if (frame.text.trim().length === 0) return <></>; // defensive: no empty expander
  return (
    <RowShell frame={frame} indent={indent} className="pt-2.5 pb-2">
      <ThinkingCard text={frame.text} />
    </RowShell>
  );
}
```

In `ThinkingCard`, add the hover tint (the button is the hover group):

```tsx
<button type="button" onClick={() => setOpen((v) => !v)}
  className="group flex items-center gap-1.5 text-left motion-reduce:transition-none" aria-expanded={open}>
  <ChevronRight /* … */ />
  <span className="text-eyebrow uppercase tracking-[0.06em] text-faint transition-colors group-hover:text-muted">
    Thinking
  </span>
</button>
```

- [ ] **Step 4: Run tests**

Run both suites from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-viewmodel/src/turn-map.ts packages/console-ui/src/dense/Transcript.test.tsx packages/console-viewmodel/src/turn-map.test.ts
git commit -m "fix: hide empty thinking blocks and tint the thinking label on hover"
```

---

## Task 8: Composer rebuild

**Files:**
- Modify: `packages/console-ui/src/dense/Composer.tsx`
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx` (composer slots + no-session)
- Test: `packages/console-ui/src/dense/Composer.test.tsx`

**Interfaces:**
- Produces: `ComposerProps` gains `disabled` semantics for no-session, `slotStart`/`slotEnd` retained; new leading `onAttach?`, trailing `onMic?` (optional, inert when absent) and a `permission?: { value; options; onChange }` selector slot. Send/Stop become icon buttons.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows glyph send/stop and inert attach + mic controls', () => {
  render(<Composer onSend={() => {}} />);
  expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /attach/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /voice|mic/i })).toBeInTheDocument();
});
it('disables input and shows a hint when there is no session', () => {
  render(<Composer onSend={() => {}} disabled />);
  expect(screen.getByLabelText('Message the agent')).toBeDisabled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm -C packages/console-ui test -- Composer`
Expected: FAIL — no attach/mic; Send is text.

- [ ] **Step 3: Implement** — rewrite `Composer.tsx` as a floating rounded surface with a control row; fix the phantom scrollbar by toggling overflow off until the cap:

```tsx
import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Mic, Square } from 'lucide-react';
import { IconButton } from '../actions/IconButton.js';
import { cx } from '../lib/cx.js';

export interface ComposerProps {
  onSend: (text: string) => void;
  onInterrupt?: () => void;
  running?: boolean;
  disabled?: boolean;
  placeholder?: string;
  onAttach?: () => void;
  onMic?: () => void;
  slotStart?: React.ReactNode; // model/effort/permission
  slotEnd?: React.ReactNode;
}

export function Composer({
  onSend, onInterrupt, running, disabled, placeholder, onAttach, onMic, slotStart, slotEnd,
}: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    // Only allow a scrollbar once content actually exceeds the max height (fixes the
    // always-on scrollbar: the auto-grow makes scrollHeight ≥ clientHeight by ~1px).
    setOverflowing(el.scrollHeight > 160);
  }, [text]);

  const send = (): void => {
    const body = text.trim();
    if (body === '' || disabled === true) return;
    onSend(body); setText('');
  };

  return (
    <div className="p-2.5">
      <div className={cx(
        'flex flex-col gap-2 rounded-surface border border-border-default bg-raised p-2 shadow-md',
        disabled === true && 'opacity-60',
      )}>
        <textarea
          ref={ref} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
            else if (e.key === 'Escape' && running === true) { e.preventDefault(); onInterrupt?.(); }
          }}
          rows={1} disabled={disabled}
          placeholder={placeholder ?? 'Message the agent…'} aria-label="Message the agent"
          className={cx(
            'max-h-40 min-h-control-md w-full resize-none rounded-control bg-transparent px-1.5 py-1.5 text-body text-fg placeholder:text-faint',
            overflowing ? 'overflow-y-auto' : 'overflow-hidden',
          )}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <IconButton icon={Paperclip} label="Attach file" variant="tertiary" size="sm"
              onClick={onAttach} disabled={onAttach === undefined} />
            {slotStart}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {slotEnd}
            <IconButton icon={Mic} label="Voice input" variant="tertiary" size="sm"
              onClick={onMic} disabled={onMic === undefined} />
            {running === true ? (
              <IconButton icon={Square} label="Stop" variant="secondary" size="sm"
                onClick={() => onInterrupt?.()} disabled={onInterrupt === undefined} />
            ) : (
              <IconButton icon={ArrowUp} label="Send" variant="primary" size="sm"
                onClick={send} disabled={disabled === true || text.trim() === ''} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

In `ChatPanel.tsx`: pass `disabled={vm.activeSessionId === undefined}` and add the permission-mode `Select` (inert options: SDK default / auto-accept-edits / plan) to `slotStart` alongside model/effort. Add `activeSessionId` to the ready vm if not already exposed.

- [ ] **Step 4: Run tests + build**

Run: `corepack pnpm -C packages/console-ui test -- Composer` then `corepack pnpm -C apps/desktop build`.
Expected: PASS + clean.

- [ ] **Step 5: Live verification** — composer floats as a rounded card; no scrollbar until the text is tall; attach/mic/permission present; Send/Stop are glyphs; disabled with no session.

- [ ] **Step 6: Commit**

```bash
git add packages/console-ui/src/dense/Composer.tsx packages/console-ui/src/dense/Composer.test.tsx apps/desktop/src/renderer/panels/ChatPanel.tsx
git commit -m "feat: rebuild the composer as a floating control surface with full affordances"
```

---

## Task 9: Running-state ring + larger working indicator

**Files:**
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx` (panel ring)
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (`WorkingFooter` size)
- Test: `apps/desktop/src/renderer/panels/ChatPanel.test.tsx` (if present) or a `WorkingFooter` render test.

- [ ] **Step 1: Write the failing test** — the working footer uses body text, not caption.

```ts
it('renders the working footer at body size', () => {
  render(<WorkingFooter busySince={Date.now()} />);
  expect(screen.getByText(/working/i).closest('div')?.className).toContain('text-body');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm -C packages/console-ui test -- Transcript`
Expected: FAIL — it's `text-caption`.

- [ ] **Step 3: Implement**

`WorkingFooter`: change `text-caption text-faint` → `text-body text-muted`, spinner `size={14}`.

`ChatPanel.tsx`: wrap the chat column with an `info` ring while running. On the `<div className="flex min-h-0 min-w-0 flex-1 flex-col">` add:

```tsx
className={cx('flex min-h-0 min-w-0 flex-1 flex-col', vm.sessionStatus === 'running' && 'ring-1 ring-inset ring-info/50')}
```

Keep the `RunningPill` badge (already `info`-toned).

- [ ] **Step 4: Run tests**

Run: `corepack pnpm -C packages/console-ui test -- Transcript`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.tsx apps/desktop/src/renderer/panels/ChatPanel.tsx
git commit -m "feat: signal a running session with a panel ring and larger working indicator"
```

---

## Task 10: Copy-whole-message + appear animation

> **Workspace note:** `globals.css` and `App.tsx` carry an unrelated in-progress window-controls
> workstream — **do not touch them**. Define the appear animation with the Web Animations API
> (`element.animate(...)` on mount) instead of a CSS keyframe, and rely on `CopyButton`'s built-in
> inline "Copied" feedback instead of a global toast (`ToastProvider` is already mounted app-side).

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (assistant text row hover copy + WAAPI appear animation)
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

- [ ] **Step 1: Write the failing test** — an assistant text row exposes a copy control carrying the source.

```ts
it('offers a copy action on an assistant text turn', () => {
  render(<TranscriptRow frame={{ id: 'a', role: 'agent', kind: 'text', text: '# hi' }} />);
  expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm -C packages/console-ui test -- Transcript`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the text branch of `TranscriptRow`, for non-user text add a hover-revealed `CopyButton` (copies `frame.text`). Wrap the content in a `group relative` and position the button top-right, `opacity-0 group-hover:opacity-100`:

```tsx
{frame.kind === 'text' && (
  <div className="group relative">
    {!isUser && (
      <div className="absolute right-0 top-0 opacity-0 transition-opacity group-hover:opacity-100">
        <CopyButton text={frame.text} />
      </div>
    )}
    <Markdown source={frame.text} />
  </div>
)}
```

Import `CopyButton`. Add the appear animation with the **Web Animations API** (no CSS keyframe — `globals.css` is off-limits, see the workspace note). In `MemoRow`, animate on mount via a ref, honoring reduced-motion:

```tsx
const ref = useRef<HTMLDivElement>(null);
useLayoutEffect(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  ref.current?.animate(
    [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
    { duration: 140, easing: 'ease-out' },
  );
}, []);
// attach ref to the MemoRow wrapper div (the same one carrying content-visibility + data-row-index)
```

The copy-block toast (DEV-NOTES) rides `CopyButton`'s built-in inline "Copied" feedback; `ToastProvider` is already mounted app-side, so no `App.tsx` change is needed.

- [ ] **Step 4: Run tests**

Run: `corepack pnpm -C packages/console-ui test -- Transcript`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.tsx packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "feat: copy whole assistant messages and animate new turns in"
```

---

## Task 11: Find-in-conversation (Ctrl-F)

**Files:**
- Create: `packages/console-ui/src/dense/find.ts`, `find.test.ts`, `packages/console-ui/src/dense/FindBar.tsx`
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (host the find bar + match scroll)

> **Workspace note:** `FindBar` is consumed only by `Transcript` internally — **do not export it from
> `packages/console-ui/src/index.ts`** (that file carries unrelated window-controls WIP; leave it dirty).

**Interfaces:**
- Produces: `findMatches(frames: TranscriptFrame[], query: string): { frameId: string; index: number }[]` — frame ids (in order) whose text contains the query (case-insensitive). `FindBar` renders the query input + `n/total` + prev/next.

- [ ] **Step 1: Write the failing test**

```ts
import { findMatches } from './find.js';
it('matches frames by case-insensitive text', () => {
  const frames = [
    { id: 'a', role: 'agent', kind: 'text', text: 'Hello World' },
    { id: 'b', role: 'agent', kind: 'text', text: 'nothing here' },
    { id: 'c', role: 'you', kind: 'text', text: 'say hello again' },
  ] as const;
  expect(findMatches(frames as never, 'hello').map((m) => m.frameId)).toEqual(['a', 'c']);
  expect(findMatches(frames as never, '')).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm -C packages/console-ui test -- find`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `find.ts`**

```ts
import type { TranscriptFrame } from './Transcript.js';

/** Text content of a frame for search, or '' for non-text kinds. */
function frameText(fr: TranscriptFrame): string {
  if (fr.kind === 'text' || fr.kind === 'thinking') return fr.text;
  if (fr.kind === 'raw') return fr.text;
  if (fr.kind === 'error') return fr.message;
  return '';
}

export interface FindMatch { frameId: string; index: number; }

/** Frames (in order) whose text contains `query` (case-insensitive). Empty query → none. */
export function findMatches(frames: TranscriptFrame[], query: string): FindMatch[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const out: FindMatch[] = [];
  frames.forEach((fr, index) => {
    if (frameText(fr).toLowerCase().includes(q)) out.push({ frameId: fr.id, index });
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm -C packages/console-ui test -- find`
Expected: PASS.

- [ ] **Step 5: Implement `FindBar.tsx` + host it**

`FindBar` is a small overlay (top-right of the transcript): a text input, `current/total`, `ChevronUp`/`ChevronDown` prev/next, and a close `X`. In `Transcript.tsx`, add a `useEffect` keydown listener for `Ctrl/Cmd+F` that toggles a `findOpen` state (preventDefault), compute `matches = useMemo(() => findMatches(items, query), [items, query])`, and on prev/next `scrollIntoView` the matched frame's `[data-row-index]`. Highlight the active match row via a `data-find-active` flag + a token ring class.

- [ ] **Step 6: Run the console-ui suite + build**

Run: `corepack pnpm -C packages/console-ui test` then `corepack pnpm -C apps/desktop build`.
Expected: PASS + clean.

- [ ] **Step 7: Live verification** — Ctrl-F opens the bar; typing highlights matches; prev/next scrolls through them; Esc/X closes.

- [ ] **Step 8: Commit**

```bash
git add packages/console-ui/src/dense/find.ts packages/console-ui/src/dense/find.test.ts packages/console-ui/src/dense/FindBar.tsx packages/console-ui/src/dense/Transcript.tsx
git commit -m "feat: add in-conversation find with match navigation"
```

---

## Task 12: Inline "switched model" system note

**Files:**
- Modify: `packages/console-ui/src/dense/Transcript.tsx` (new `note` frame kind render)
- Modify: `apps/desktop/src/renderer/panels/ChatPanel.tsx` / `console.ts` (insert a note frame on model change)
- Test: `packages/console-ui/src/dense/Transcript.test.tsx`

**Interfaces:**
- Produces: a new `TranscriptFrame` variant `{ id; kind: 'note'; text: string }` — a console-local system note (never sent to the agent; degrades to the `raw` floor as a `raw` line in raw mode).

- [ ] **Step 1: Write the failing test**

```ts
it('renders a centered system note', () => {
  render(<TranscriptRow frame={{ id: 'n', kind: 'note', text: 'switched to Opus 4.8 · high' }} />);
  expect(screen.getByText(/switched to Opus/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm -C packages/console-ui test -- Transcript`
Expected: FAIL — `note` kind unhandled (TS union error).

- [ ] **Step 3: Implement** — add the `note` variant to the `TranscriptFrame` union, `dotTone` (→ `neutral`), and a render branch (a centered muted rule + label, no spine dot emphasis):

```tsx
if (frame.kind === 'note') {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-caption text-faint">
      <span className="h-px flex-1 bg-hairline" />
      <span>{frame.text}</span>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}
```

Ensure `foldToolFrames` passes `note` through untouched (it already passes non-tool kinds). In `console.ts`, when a model/effort change is applied on send (the `override` path in `sendMessage`), append a `note` view frame (mapped through the same buffer) describing the switch, e.g. `switched to <modelLabel> · <effort>`. In raw mode, `frameToRawLine` should emit `> control: note <text>` for the note kind.

- [ ] **Step 4: Run tests + build**

Run: `corepack pnpm -C packages/console-ui test -- Transcript` then `corepack pnpm -C apps/desktop build`.
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add packages/console-ui/src/dense/Transcript.tsx apps/desktop/src/renderer/panels/ChatPanel.tsx apps/desktop/src/renderer/console.ts packages/console-ui/src/dense/Transcript.test.tsx
git commit -m "feat: record mid-session model switches as an inline note"
```

---

## Task 13: Docs + full verification

> **Workspace note:** `packages/console-ui/package.json` carries an unrelated in-progress dependency
> (`@floating-ui/react`) from the window-controls workstream — **do not touch it**. Leave the now-unused
> `react-virtuoso` dependency in place (an unused dep is harmless) and note the removal as a follow-up in
> `REPO_LAYOUT.md`, rather than editing the entangled `package.json`/lockfile here.

**Files:**
- Modify: `docs/REPO_LAYOUT.md`, `docs/UI.md`, `packages/console-ui/COMPONENTS.md`

- [ ] **Step 1: Confirm react-virtuoso is no longer imported**

Run: `corepack pnpm -C packages/console-ui exec grep -rl "react-virtuoso" src || echo none`
Expected: `none`. Record in `REPO_LAYOUT.md` that the dependency is now unused and can be dropped once the window-controls WIP lands (do not edit `package.json` in this dirty-tree state).

- [ ] **Step 2: Update docs**

- `REPO_LAYOUT.md`: note `smoothScroll.ts` removed; `scrollState.ts`, `find.ts`, `FindBar.tsx` added; transcript is non-virtualized (react-virtuoso dropped).
- `COMPONENTS.md` / `UI.md`: document the rebuilt `Composer`, the non-virtualized `Transcript` + find bar, the `note` frame kind, and the virtualization reversal (was pinned in the two prior chat specs).

- [ ] **Step 3: Full workspace verification**

Run: `corepack pnpm test`
Expected: green.

Run: `corepack pnpm -C apps/desktop build` and `corepack pnpm -C apps/desktop exec tsc -b`
Expected: clean, 0 errors.

- [ ] **Step 4: Full live smoke** (`corepack pnpm -C apps/desktop dev`)

Confirm end-to-end: smooth scroll + full-transcript selection + Ctrl-F on a long session; jump-to-latest locks and clears; send snaps to your message; switching sessions mid-run keeps output on the right session and shows the correct pill; composer floats, no phantom scrollbar, attach/mic/permission present, glyph send/stop; thinking hides when empty and tints on hover; code blocks scroll horizontally; task-list checkboxes themed; running ring shows; copy-message + appear animation; switched-model note appears on a model change.

- [ ] **Step 5: Commit**

```bash
git add docs/REPO_LAYOUT.md docs/UI.md packages/console-ui/COMPONENTS.md
git commit -m "docs: record the non-virtualized chat rebuild and new members"
```

---

## Follow-up plans (not this document)

- **Phase 2 — tool-block design gate:** per-tool registry + three showcase variants in `ChatMockups.tsx`; reviewer picks. (Own short plan.)
- **Phase 3 — implement the chosen tool block** as the live `ToolCard` replacement. (Planned after the pick.)
- **Phase 4 — backend thinking tails:** DeepSeek `reasoning_content` → thinking-frame emission; Claude adapter empty-thinking drop at source. (Independent; can land any time after Phase 1.)

---

## Self-Review

- **Spec coverage:** issues 1 (T3/T6 perf+overflow), 2 (T5 spacing), 4 (T3 sticky drop + T5 user block), 5 (T3/T4 scroll), 6 (T7 thinking; DeepSeek → Phase 4), 7 (T8 composer), 8 (T9 running); bug S (T1); selection/Ctrl-F (T3/T11); DEV-NOTES folded (T6 overflow, T9 working size, T10 copy toast/appear, T11 find, T12 switched-model). Issue 3 (tool blocks) → Phases 2/3 (design-gated) — intentionally not here.
- **Placeholder scan:** every code step carries real code; live-only scroll behavior is explicitly marked as manual verification (spec-sanctioned), not a placeholder.
- **Type consistency:** `appendTurns(sessionId, frames)`, `runStatus`, `jumpNonce`, `note` frame kind, `findMatches`/`FindMatch`, `nearBottom`/`previousPromptIndex` are used consistently across tasks.

---

_Last reviewed: 2026-07-04_
