# Handoff — Surface DeepSeek reasoning as a thinking block

Paste the block below into a fresh Claude Code session in this repo to continue. It is written for an agent
with **zero prior context**.

---

You are continuing the coa console work. The rich tool card and the pure-API tool-result rendering are done and
on `main`. Your job is a **small, self-contained backend feature**: surface a DeepSeek session's **reasoning
("thinking") output** as a collapsible thinking block in the transcript. Today it is requested but **dropped**.

## What coa is (one paragraph)
coa is a local-first, single-user **governance/audit layer over a rented Claude Agent SDK loop** — it governs a
coding agent rather than replacing it. It is backend-neutral: the Claude SDK is one backend; a thin pure-API
backend (DeepSeek) reuses a shared governed loop (`@coa/loop-driver`). The shippable UI is an Electron console
(`apps/desktop`) whose transcript renders neutral `TurnFrame`s. Read `AGENTS.md` + `CLAUDE.md` first (routing +
non-negotiables). Skills-first: TDD each unit (`superpowers:test-driven-development`); if you refine the design
first, use `superpowers:brainstorming`.

## The problem (root-caused)
DeepSeek's reasoning is handled only on the **request** side — the adapter maps coa's reasoning selection to
DeepSeek's `reasoning_effort` / `thinking:{type:'disabled'}` (thinking-high is the V4 default). But the
**response** side drops it: `packages/adapter-deepseek/src/complete.ts` (~line 76) returns only
`text: choice.message.content ?? ''` and **never reads `choice.message.reasoning_content`**. The driver
(`packages/loop-driver/src/driver.ts`) then emits only `text`/tool frames — no thinking frame. So a DeepSeek
session shows its answer but never its reasoning.

**Good news — the consumer side already exists.** The neutral wire frame already has a thinking variant
(`packages/shared/src/push.ts:12` → `z.object({ t: z.literal('thinking'), text: z.string() })`), the Claude
backend already produces thinking frames, and the console already renders them (a collapse-by-default
`ThinkingBlock` in `packages/console-ui/src/dense/Transcript.tsx`). So this is a **producer-only** change —
no console, daemon, schema, or wire changes needed.

## Your mission — the exact changes
1. **Capture `reasoning_content` off the DeepSeek response.**
   - `packages/adapter-deepseek/src/wire.ts` — in `wireMessageSchema` (the `message` object, ~line 21, beside
     `content`), add `reasoning_content: z.string().nullable().optional()`.
   - `packages/adapter-deepseek/src/complete.ts` — in the returned object (~line 75), add
     `reasoning: choice.message.reasoning_content ?? undefined` (surface only a non-empty string; leave it
     `undefined` when thinking is off/absent).
2. **Carry it through the neutral result type.**
   - `packages/loop-driver/src/complete.ts` — add `reasoning?: string | undefined` to `CompletionResult`
     (the `interface CompletionResult` at ~line 35).
3. **Emit a thinking frame in the loop.**
   - `packages/loop-driver/src/driver.ts` — in `runGovernedLoop`, right after `const result = await
     deps.complete(...)` and BEFORE the existing `if (result.text !== '') emit({ t: 'text', text: result.text })`,
     add: `if (result.reasoning !== undefined && result.reasoning !== '') emit({ t: 'thinking', text:
     result.reasoning });` (reasoning precedes the answer).
   - **Do NOT** add reasoning to the `messages.push({ role: 'assistant', content: result.text, … })` — see the
     correctness note below.

## Correctness notes (read before coding)
- **Never resend `reasoning_content` to the API.** DeepSeek rejects `reasoning_content` in *input* messages. The
  loop resends the whole history each round-trip via `toWireMessage` (`complete.ts`), which already sends
  assistant `content` only — keep it that way. Reasoning is **display-only**; it must not enter `messages`.
- **Emit thinking BEFORE the text frame** (it's the pre-answer reasoning).
- **Non-streaming only.** The adapter is non-streaming, so read `choice.message.reasoning_content` from the final
  message. A future streaming path would read `delta.reasoning_content` — out of scope here.
- **No console/daemon/schema work.** `{ t: 'thinking', text }` already flows through the daemon push and renders
  as a collapse-by-default block; the Claude path exercises this today. If you find otherwise, stop and confirm
  before widening scope.
- DeepSeek returns `reasoning_content` only when thinking is enabled (the default effort). Off ⇒ absent/null ⇒
  the `?? undefined` guard means no thinking frame. That's correct.

## Where things live
- DeepSeek adapter: `packages/adapter-deepseek/src/{wire.ts,complete.ts}` (+ their `*.test.ts`).
- Shared governed loop: `packages/loop-driver/src/{complete.ts,driver.ts}` (+ `driver.test.ts`).
- Neutral thinking frame (reference, no change): `packages/shared/src/push.ts`.
- Console thinking renderer (reference, no change): `packages/console-ui/src/dense/Transcript.tsx` (`ThinkingBlock`).

## Hard constraints
- **TDD** each unit first (RED→GREEN): the wire schema parses a message carrying `reasoning_content`; `complete`
  returns `reasoning` from a mocked response (and `undefined` when absent); the driver emits a `{ t: 'thinking' }`
  frame *before* the `text` frame when `result.reasoning` is set, and none when it isn't; and it never puts
  reasoning into `messages`.
- **TypeScript strict**, no `any`, `exactOptionalPropertyTypes` (optional fields typed `T | undefined`),
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- **Determinism-first / SC-1** — this is display-only surfacing; it adds no block and no critical-path model call.
- **Do NOT touch the Claude adapter.** Do not stage `LOCAL.md` / `harness-system-prompt.md` (intentionally
  untracked).
- Commits: subject-only Conventional Commits — no body, no `Co-Authored-By`/"Generated with" trailer, no internal
  IDs (module/phase numbers). **Stage files by name; never `git add -A`.** Hooks enabled — never `--no-verify`.
  One logical unit per commit (this is naturally one commit).

## Commands (Windows, from repo root)
- Focused test: `corepack pnpm vitest run <path>` (the per-package `pnpm -C <pkg> test` does NOT resolve — use
  root vitest).
- Typecheck: `corepack pnpm -C packages/adapter-deepseek exec tsc -b`, `-C packages/loop-driver`,
  `-C packages/shared` — must be **0 errors** each.
- Build gate (unaffected but cheap): `corepack pnpm -C apps/desktop build`.

## Definition of done
- A DeepSeek turn with thinking enabled emits a `{ t: 'thinking', text }` frame carrying the model's
  `reasoning_content`, before its answer; thinking-off emits none. Reasoning never enters the resent `messages`.
- New/updated unit tests green (wire schema, `complete`, driver); `tsc -b` clean for the three packages.
- A short summary to the maintainer, plus a **live DeepSeek smoke** request: confirm the reasoning shows as a
  collapsible thinking block above the answer in the running console (`corepack pnpm -C apps/desktop dev`) — the
  unit tests can't exercise the live render.

---

_Handoff written 2026-07-05. Producer-only change; the thinking frame + console rendering already exist (the
Claude path uses them)._
