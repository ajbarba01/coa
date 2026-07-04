# Handoff — Chat Phase 2: tool-block design gate

Paste the block below into a fresh Claude Code session in this repo to continue. It is written for an agent
with **zero prior context**.

---

You are the senior designer/engineer continuing the coa console chat overhaul. **Phase 1 (chat
professionalization) is done and on `main`**; you are starting **Phase 2 — the tool-block design gate.**

## What coa is (one paragraph)
coa is a local-first, single-user **governance/audit layer over a rented Claude Agent SDK loop** — it governs a
coding agent rather than replacing it. The shippable UI is an **Electron console** (`apps/desktop`) built from a
token-driven kit (`packages/console-ui`, the "forge" warm-dark design system). The chat surface renders a live
governed session. Read `AGENTS.md` + `CLAUDE.md` first (routing + non-negotiables), then `docs/UI.md` (design
system + authoring rules).

## Where Phase 1 left things
The chat surface was rebuilt (commits `11310d8`..`e1dff05` on `main`): non-virtualized transcript (full-DOM +
`content-visibility`, native stick-to-bottom, jump-to-latest/prompt, full-transcript selection + Ctrl-F),
per-session output routing, rebuilt floating composer, thinking/code/markdown fixes, running-state ring,
copy-message, find-in-conversation, switched-model note, and memoized frame identity. Design authority is
`docs/superpowers/specs/2026-07-04-chat-professionalization-design.md`; the executed plan is
`docs/superpowers/plans/2026-07-04-chat-professionalization-phase-1.md`.

## Your mission — Phase 2 (this handoff)
**The tool blocks were deliberately deferred to a design gate.** Today every tool call renders as one generic
collapse-by-default box (`ToolCard` in `packages/console-ui/src/dense/Transcript.tsx`) — no per-tool intelligence.
Build **three distinct tool-block directions as real, reviewable showcase specimens**, so the maintainer can look
at them in the running app and **pick one (or a hybrid)** before any live wiring. This is a *gate*: **do NOT
replace the live `ToolCard` yet** — that is Phase 3, after the pick.

Authoritative design for this: spec **§5.3 "Tool blocks (issue 3) — showcase design gate."** The three directions
(already agreed with the maintainer) are:

1. **Per-tool compact line** — one line: tool icon + verb + target + status glyph (e.g. `▤ Read auth.ts:1-40`,
   `⌘ Bash npm test ✓`, `✎ Edit auth.ts +3 −1`); click to expand full detail.
2. **Grouped activity log** — consecutive tool calls collapse into one "working" group
   (`▾ Worked on auth module` → the individual steps); denser, closer to Cursor's agent log.
3. **Rich card with inline diff** — edits/writes lead with a byte-faithful mini-diff; reads/greps show a result
   preview; commands show an output tail. Heaviest, most informative.

All three sit on a shared, pure **per-tool registry** (build this first): `(tool, input, output?, ok?) →
{ icon, verb, summary }` for the known tools (**Read, Write, Edit, NotebookEdit, Glob, Grep, Bash, TodoWrite**,
extend as sensible) with a **universal fallback** for unknown tools. Defensive JSON parse — never throws
(malformed input → no summary). Live in `packages/console-ui`, unit-tested. (There's a smaller precedent already:
`toolQuickInfo` in `Transcript.tsx` — supersede it.)

## Where things live
- Live tool rendering: `packages/console-ui/src/dense/Transcript.tsx` — `ToolCard`, the `TranscriptFrame` union
  (`tool` / `tool-use` / `tool-result` kinds), `foldToolFrames` (pairs use+result into one `tool` frame),
  `dotTone`.
- The **showcase** (your canvas): `apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx` — it already renders
  real `TranscriptRow` specimens from sample `TranscriptFrame` data under `Family`/`Row` scaffolding. Add the
  three tool-block directions here (each its own `Family`/`Row`), driven by representative sample frames.
- Design references the maintainer named: the **VS Code Claude Code extension** tool steps and **Cursor's** agent
  log. Don't limit yourself to them.

## Sample data to exercise each variant (make them realistic)
`Read` (file_path + range), `Edit` (file_path + a small diff, `+N −M`), `Write` (new file), `Bash` (command +
output tail + exit code), `Grep` (pattern + match count), `Glob` (pattern + results), an **unknown tool**
(fallback), plus a **running** state (tool-use with no result yet) and a **failed** state (`ok:false`).
Note `TodoWrite` already renders as its own `plan` checklist frame — keep that separate; don't fold it into a tool
card.

## Hard constraints (read before touching anything)
- **Dirty working tree.** An **unrelated in-progress "window-controls" workstream** has ~30 dirty files. **Stage
  ONLY files you change, BY NAME. NEVER `git add -A`.** Off-limits (do not touch): `globals.css`,
  `packages/console-ui/src/index.ts`, `apps/desktop/src/renderer/App.tsx`, `package.json`/lockfile,
  `Combobox.tsx`, and the window-controls files (`titlebar*`, `NavPanel`, `AppShell*`, `palette.ts`,
  `semantic.ts`, `zoom*`, `WindowControls*`, `preload/*`, `main/*`). If a change seems to *need* one of these,
  stop and ask.
- **Commits:** subject-only Conventional Commits — **no body, no `Co-Authored-By`/"Generated with" trailer, no
  internal IDs (module/phase numbers)**. Stage by name. Hooks enabled — never `--no-verify`. One logical unit per
  commit.
- **Kit discipline:** token-only styling (no raw hex/px; "blue" = the `info` token), no
  `dangerouslySetInnerHTML`, new kit members get an intent block (mirror `Transcript.intent.ts`). Build from the
  kit; don't reinvent primitives.
- **Invariants:** **SC-1** (the console adds no block), **D85** (`coa raw` mode stays byte-verbatim; every new
  render kind degrades to the raw floor — raw frames must pass through untouched). Diffs render **byte-faithfully**
  (the highlighter colorizes, never mutates bytes).
- **TypeScript strict, no `any`, `exactOptionalPropertyTypes`** on (optional props typed `T | undefined`).

## Commands
- Focused tests: `corepack pnpm vitest run <name>` (the per-package `pnpm -C <pkg> test` script does **not**
  resolve in this repo — use the root vitest).
- Build gate: `corepack pnpm -C apps/desktop build`; typecheck `corepack pnpm -C apps/desktop exec tsc -b`.
- Full suite: `corepack pnpm test` — **NOTE: 2 pre-existing failures are unrelated** (a `Combobox.tsx` portal
  regression from the window-controls WIP, provable by stashing that file). Don't chase them.
- Live review: `corepack pnpm -C apps/desktop dev`, then open the showcase panel. (Electron `dev` may not boot in
  a sandbox — if so, the maintainer runs it; rely on build + unit tests and hand off for the visual pick.)

## Process
1. Start with `superpowers:brainstorming` only if you want to refine the *variants* further — otherwise the
   direction is already decided; go straight to a short `superpowers:writing-plans` plan (registry first, then the
   three specimens), then execute (subagent-driven or inline). Use `frontend-design` for the visual craft.
2. Build the **pure per-tool registry (+ tests)** first; then the **three showcase specimens** on top of it.
3. Keep all three visually distinct and honest — each must degrade to the raw floor and honor SC-1/D128.

## Definition of done for Phase 2
- A tested per-tool registry in `console-ui`.
- Three tool-block directions rendered as real specimens in `ChatMockups.tsx`, each exercising the sample set
  above (known tools + fallback + running + failed).
- `corepack pnpm test` green (modulo the 2 known unrelated Combobox failures), build + `tsc` clean.
- A short summary to the maintainer that **presents the three and asks them to pick one or a hybrid** — with your
  designer recommendation. **Stop there; do not wire the winner into the live transcript** (that's Phase 3).

## After the pick (Phase 3 — not this handoff)
Replace the live `ToolCard` with the chosen direction, wired through `foldToolFrames`/`TranscriptRow`, and
(deferred backend) `getToolDetail` for byte-faithful expand. Separate plan.

---

_Handoff written 2026-07-04. Phase 1 complete at `main`@`e1dff05`._
