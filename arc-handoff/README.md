# arc-handoff/ — transport folder, NEVER merge this

This folder exists on the `arc/handoff` branch only, to move an in-progress improvement
arc between machines. It is **not part of the product** and must never be merged into
`main` or into any work branch. Delete the branch once the arc is finished.

The arc run was interrupted on 2026-08-07 when the driving account hit its individual
spend limit mid-workflow. Nothing was lost — every commit is on GitHub — but the run
stopped roughly 40% into the architecture workstream, before the docs and closeout
stages.

## Start here, in this order

1. **`MACHINE-SETUP.md`** — Node 22, the node-gyp/Python workaround, the gitignored
   files to restore, the two skills. `pnpm install` fails without this.
2. **`run/state.md`** — where the work is, what every branch holds, what is done, what
   is next. This is the single resume document.
3. **`run/journal.md`** — the append-only narrative of what actually happened, including
   verbatim gate results and the honest record of the spend-ceiling failure.
4. **`run/questions.md`** — seven parked items needing a maintainer decision. Q1–Q3 are
   knife rulings that reality contradicted; Q4–Q7 came out of the interruption.
5. **`coa-arc-plan.md`** — the master plan the whole run executes from.

## What else is in here

| Path | What it is |
|---|---|
| `coa-arc-plan.md` | the master plan: workstreams, charters, sequencing, execution design |
| `feature-plans.md` | per-feature requirements F1–F10 (mostly unstarted) |
| `architecture-audit.md` | 35 verified findings with verbatim fix sketches — the charter source |
| `coa-reset-plan.md` | the de-drift plan the knife executed (rulings R1–R13) |
| `reference-shortlist.md` | approved reference projects + license verdicts + adaptation rules |
| `planning-record.md` | the interview trail — consult when intent is ambiguous |
| `coa-arc-handoff.md` | the original pre-arc handoff document |
| `mockups/arc-ui-contract.html` | the approved UI contract (S1–S7); only its listed functionality is binding |
| `run/ledger.md` | the knife's deletion/archive ledger, ticked with commit shas |
| `run/verification/*.json` | per-ruling verification inventories (file/symbol/caller evidence) |
| `run/harvest/*.md` | Stage 4 source material: distilled live rationale + tiered roadmap candidates + verified SDK behavior |
| `workflow-scripts/*.js` | the multi-agent workflow scripts this run used; `stage4-docs.js` is pre-written and ready to launch |
| `repo-local-files/` | the gitignored per-machine files (see MACHINE-SETUP.md) |

## A note on the `<employer-name>` placeholder

This repo's standing rule is that the maintainer's employer is never named in any
committed artifact. Because this folder IS committed (to move machines), every
occurrence of that name — including inside the "grep the diff for the employer name"
gate instructions and one old cloud-storage path — has been replaced with
`<employer-name>` / `<employer>`. Substitute the real string mentally when running the
pre-commit grep gate; it never needs to be written down here.

## The one thing to be careful about

`arc/wip-adapter-unify` holds ~1,721 lines of a unified OpenAI-compatible adapter that
was **never typechecked, linted, or tested** — the agent writing it was killed before it
could gate or commit. It is isolated on that branch precisely so it cannot be mistaken
for verified work. The two original adapter packages are still live and intact; the tree
is not in the unified state. See Q5.
