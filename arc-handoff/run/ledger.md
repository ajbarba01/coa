## Deletion/archive ledger

Tick each row as executed; correct any row that reality contradicts.

| # | Item | Fate | Revival path | Status |
|---|------|------|--------------|--------|
| R1 | Hard cost-cap + ceiling plumbing | archive/ | Later: budget guard if metered spend returns | **PARKED (Q1)** — contradicted by ADR 0032 (cost cap = sole fan-out bound for live spawn_agent); nothing removed |
| R2 | Ledger reads + redaction utilities | archive/ | with governance era | **STRUCK (Q2, maintainer 2026-08-07)** — ruling withdrawn, nothing removed, nothing to revisit. 3 of 4 symbols are live safety code (redaction = ledger write-path allow-list; SECRETS_GLOB/DENY_READ_GLOBS feed the SDK deny list); the 4th, ledgerEntries, is the roadmap's named read seam for tree-spend UI |
| R3 | Decision log, why/vouch provenance, its CLI/RPC/tools | archive/ | none planned (deliberate) | **DONE** 01a939b — archive/decision-log/, all read verbs/tools unwired, −566 lines |
| R4 | AutoPatcher + ReminderPolicy | archive/ | someday: flag auto-fix / reminders | **DONE** a4cdd90 — archive/flag-extensions/, barrel unwired |
| R5 | Bundle importer + version gate | archive/ | Next: skills/MCP/plugin arc | **DONE** c7f6f7f — archive/bundle-importer/; NOTE shared/src/bundle.ts now orphaned (Stage 2 leftover) |
| R6 | Signal bus (write-only diagnostics ring) | archive/ | none planned | **DONE** f7fff92 — archive/signal-bus/, kernel write + read view unwired |
| R7 | Checkpoint pin/rewind (undo plumbing) | archive/ | someday: turn-level undo | **DONE** b070b38 — archive/undo-plumbing/; checkpoint/listTimeline kept live |
| R8 | Grounding producer | archive/ | Next: tool repair + grounding arc | **DONE** 7f76e61 — archive/grounding-producer/; NOTE kernel fuzzyMatch now caller-less (Stage 2 leftover) |
| R9 | Projection persistence/versioning scaffolding | delete | rebuild if the log outgrows memory | **DONE** 60ac5c9 — persistence/versioning scaffolding deleted, mirror honest in-memory; NOTE a LOCKED spec bullet updated to match (flag for maintainer) |
| R10 | Registration of empty symbol tools | unwire only | when the symbol layer is fed | **DONE** 4b2ef45 — three symbol tools unregistered; implementations dormant |
| R11 | Unused @parcel/watcher dependency | delete | re-add when the watcher wire lands | **DONE** 6018074 — dep + allowBuilds line + lockfile entries removed |
| R12a | Graph nav row + palette entry | delete | someday: graph views | **DONE** 19fc3dc — graph nav row + palette entry removed |
| R12b | Fake attach plumbing | delete | Later: real attachments | **DONE** 734627e — fake attach plumbing deleted; attach a disabled affordance |
| R12c | Permission-mode chip | delete | Next: permission-mode arc | **DONE** 0002ca5 — permission-mode chip removed |
| R12d | Rename-session plumbing | delete | Later: conversation naming + rename UI | **DONE** 734627e — rename-session chain deleted end-to-end |
| R12e | Light/system theme branches | delete | Later: light theme | **DONE** 8b13286 — light/system theme branches dropped |
| R12f | Work dock Record + Cost floors | delete | with their features | **Record floor DONE** 014fcce; **Cost floor PARKED (Q3)** — live tree-spend reader post-plan; also d67d8bf showcase dev-gate + 0408ac8 usage mock-by-design comment |
| R13 | Exploratory SDK probes | archive/ | none needed; findings distilled in docs | **DONE** e6042d1 — pruned to load-bearing; exploratory probes → archive/sdk-probes/ |
| P2 | Dead exports, stale names/comments/CSS, fixtures in prod folders | delete | n/a (slop) |
| P3 | docs/adr, docs/superpowers, docs/design/research, docs/design/handoff, DEV-NOTES, DESIGN.md | delete | git history |

## Appendix — the OneDrive machine (optional)

This plan was authored on a machine where the repo lives inside OneDrive: pnpm's symlinks
do not survive there (native builds fail), and no git push credentials exist. If that copy
ever needs to run anything: move the repo to a plain local path first, then
`gh auth login` (browser flow, HTTPS credential helper) — no SSH key required.
