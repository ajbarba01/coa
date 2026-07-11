# @coa/workbench-proto

The console's **design lab**: motion-true, mock-data, no daemon. The reference implementation of
the workbench design system (ADR-0014) until each surface graduates into the real console — see
`docs/UI.md` for the laws and `ROADMAP.md` for what has already shipped.

```sh
pnpm --filter @coa/workbench-proto dev   # → http://localhost:5199
```

## What lives here

- **The shell** (nav · tabs · browser · palette · settings) — shipped to `apps/desktop`; kept as
  reference.
- **The conversation vocabulary** (`src/chat/`) — every transcript frame kind (prose blocks, code
  + syntax palette, tool cards, plan, reasoning, subagents, approval, deny, error/note, raw) and
  every composer state, designed against the real `TranscriptFrame` contract
  (`packages/console-ui/src/dense/Transcript.tsx`).
- **The showcase** (nav → showcase) — the living spec, two pages: `conversation` (the frame
  vocabulary, every state, with rulings in the section notes) and `kit` (the primitives).

## Review seams (URL params)

- `?surface=showcase` — open the spec pages directly.
- `?session=<id>` — open a seeded session (`docs-sweep` = pending approval, `refactor-m4` =
  deny/error/note history, `fix-pipe-test` = empty state).
- `?demo=1` — fire the scripted turn hands-free: streaming reasoning → tools → the plan updating
  in place → block-streamed prose → a nested subagent + roll-up → an approval gate. Approve it to
  watch the run-checks close the story. While it runs: Esc stops, typing exposes Queue/Barge-in.

---

_Last reviewed: 2026-07-11_
