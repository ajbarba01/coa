## Deletion/archive ledger

Tick each row as executed; correct any row that reality contradicts.

| # | Item | Fate | Revival path | Status |
|---|------|------|--------------|--------|
| R1 | Hard cost-cap + ceiling plumbing | archive/ | Later: budget guard if metered spend returns | **DONE** 4848ff4..0be23fb — Q1 ruled "archive anyway" 2026-08-07; executed as originally written (deny path + ceilingUsd archived, spend counter kept), ADR 0035 supersedes ADR 0032's fan-out-bound claim, both verifiers addressed |
| R2 | Ledger reads + redaction utilities | archive/ | with governance era | **STRUCK (Q2, maintainer 2026-08-07)** — ruling withdrawn, nothing removed, nothing to revisit. 3 of 4 symbols are live safety code (redaction = ledger write-path allow-list; SECRETS_GLOB/DENY_READ_GLOBS feed the SDK deny list); the 4th, ledgerEntries, is the roadmap's named read seam for tree-spend UI |
| R3 | Decision log, why/vouch provenance, its CLI/RPC/tools | archive/ | none planned (deliberate) | **DONE** 01a939b — archive/decision-log/, all read verbs/tools unwired, −566 lines |
| R4 | AutoPatcher + ReminderPolicy | archive/ | someday: flag auto-fix / reminders | **DONE** a4cdd90 — archive/flag-extensions/, barrel unwired |
| R5 | Bundle importer + version gate | archive/ | Next: skills/MCP/plugin arc | **DONE** c7f6f7f — archive/bundle-importer/; the shared/src/bundle.ts leftover this flagged is gone from the tree — RESOLVED, no longer worth tracking separately |
| R6 | Signal bus (write-only diagnostics ring) | archive/ | none planned | **DONE** f7fff92 — archive/signal-bus/, kernel write + read view unwired |
| R7 | Checkpoint pin/rewind (undo plumbing) | archive/ | someday: turn-level undo | **DONE** b070b38 — archive/undo-plumbing/; checkpoint/listTimeline kept live |
| R8 | Grounding producer | archive/ | Next: tool repair + grounding arc | **DONE** 7f76e61 — archive/grounding-producer/; the caller-less kernel fuzzyMatch this flagged was deleted in 2afa808 (Q7's orphan sweep) — RESOLVED |
| R9 | Projection persistence/versioning scaffolding | delete | rebuild if the log outgrows memory | **DONE** 60ac5c9 — persistence/versioning scaffolding deleted, mirror honest in-memory. The LOCKED spec bullet this note flagged for the maintainer lived in docs/design/handoff/SPEC.md, which Stage 4 retired entirely (9fb09db) — moot, nothing left to reconcile |
| R10 | Registration of empty symbol tools | unwire only | when the symbol layer is fed | **DONE** 4b2ef45 — three symbol tools unregistered; implementations dormant |
| R11 | Unused @parcel/watcher dependency | delete | re-add when the watcher wire lands | **DONE** 6018074 — dep + allowBuilds line + lockfile entries removed |
| R12a | Graph nav row + palette entry | delete | someday: graph views | **DONE** 19fc3dc — graph nav row + palette entry removed |
| R12b | Fake attach plumbing | delete | Later: real attachments | **DONE** 734627e — fake attach plumbing deleted; attach a disabled affordance |
| R12c | Permission-mode chip | delete | Next: permission-mode arc | **DONE** 0002ca5 — permission-mode chip removed |
| R12d | Rename-session plumbing | delete | Later: conversation naming + rename UI | **DONE** 734627e — rename-session chain deleted end-to-end |
| R12e | Light/system theme branches | delete | Later: light theme | **DONE** 8b13286 — light/system theme branches dropped |
| R12f | Work dock Record + Cost floors | delete | with their features | **Record floor DONE** 014fcce; **Cost floor RULED KEPT (Q3, maintainer 2026-08-07)** — it renders live session-tree spend with pinning tests, not the dead floor the ruling targeted; also d67d8bf showcase dev-gate + 0408ac8 usage mock-by-design comment, later upgraded to a user-visible label (7852763) |
| R13 | Exploratory SDK probes | archive/ | none needed; findings distilled in docs | **DONE** e6042d1 — pruned to load-bearing; exploratory probes → archive/sdk-probes/ |
| P2 | Dead exports, stale names/comments/CSS, fixtures in prod folders | delete | n/a (slop) | **DONE** — the de-slop charter (Stage 2, 4 commits): codename sweep across 312 files, core barrel narrowed 272→48 exports, mockAuth→authStore and the mock/live boundary untangled |
| P3 | docs/adr, docs/superpowers, docs/design/research, docs/design/handoff, DEV-NOTES, DESIGN.md | delete | git history | **DONE** 9fb09db (Stage 4) — 88 files, −30,736 lines; rationale worth keeping was graduated into docs/ARCHITECTURE.md and docs/UI.md before deletion (one gap found and fixed post-verification: ADR 0015's color exceptions, 14b55ac) |

## Appendix — the OneDrive machine (optional)

This plan was authored on a machine where the repo lives inside OneDrive: pnpm's symlinks
do not survive there (native builds fail), and no git push credentials exist. If that copy
ever needs to run anything: move the repo to a plain local path first, then
`gh auth login` (browser flow, HTTPS credential helper) — no SSH key required.
