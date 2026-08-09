# Architecture Decision Records

Decision history, not a rulebook. Each ADR captures one architecturally-significant decision and the reasoning behind it, in [MADR](https://adr.github.io/madr/)-lite form — a shared reference for the current best understanding of *why*, kept alongside (not instead of) the plan that produced it.

## Rules
- **Accepted stands until superseded.** Only typo/link fixes after `accepted`. When understanding changes, that's a *new* ADR that supersedes the old one (set the old one's status to `superseded by NNNN`) — we record the update, not rewrite the past.
- **Filename:** `NNNN-kebab-title.md`, zero-padded sequential.
- **Status lifecycle:** `proposed → accepted → (deprecated | superseded by NNNN)`.
- **Link from code** at the seam a decision governs: `// see docs/adr/NNNN`.
- **Small decisions** may use a one-line Y-statement: "In the context of X, facing Y, we decided Z, to achieve W, accepting V." Reserve the full template for larger decisions.

## Template
````
```
# NNNN. <title>

- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD

## Context and problem
## Decision drivers
## Considered options
## Decision
## Consequences (good / bad)
```
````

## Index
- [0001](0001-consolidate-docs-into-router-adr-roadmap.md) — Consolidate project truth into router + ADRs + ROADMAP
- [0002](0002-multi-backend-architecture.md) — Multi-backend architecture: one backend-blind core, one M9 seam
- [0003](0003-core-context-and-role-composition.md) — Core-context and role composition (DC model)
- [0004](0004-layer-on-native-never-branch-on-backend.md) — Layer on native; composition never branches on backend
- [0005](0005-owned-base-and-web-tools.md) — Owned base + web tools & local key store (pure-API path)
- [0006](0006-multi-account-auth.md) — Credential-blind multi-account (subscription) auth
- [0007](0007-console-design-system.md) — Console design system + reversals
- [0008](0008-strict-superset.md) — Strict-superset: feature-off ≤ the raw loop
- [0009](0009-single-deny-channel.md) — Exactly two blocks through one deny channel (SC-1) (narrowed by 0035)
- [0010](0010-append-only-conversation-log.md) — Converge conversation persistence onto a single append-only log (deferred)
- [0011](0011-daemon-authoritative-live-session.md) — The daemon is the authoritative owner of a live session across turns
- [0012](0012-sdk-streaming-input-steering.md) — Hold the Claude SDK query open for streaming-input steering
- [0013](0013-streaming-complete-and-delta-frames.md) — Streaming complete() contract and delivery-only delta frames
- [0014](0014-workbench-design-system.md) — Workbench design system: conversation-first, sand-dark, quiet
- [0015](0015-brand-marks-and-series-palette.md) — Third-party brand marks, and a series palette for charts
- [0016](0016-coa-owned-model-catalog.md) — coa-owned model catalog, enriched (never defined) by the backend
- [0017](0017-probe-derived-login-health.md) — Login health is probe-derived; a broken active account is flagged, never auto-switched
- [0018](0018-isolated-browser-login-sessions.md) — Isolated browser login sessions, keyed by account, at the provider-descriptor layer (superseded by 0019)
- [0019](0019-coa-opens-the-profiled-browser.md) — coa opens the profiled browser itself; `BROWSER` only suppresses the CLI's open (superseded by 0020)
- [0020](0020-courier-shim-relays-the-self-completing-url.md) — The `BROWSER` shim is a courier: it relays the self-completing authorize url
- [0021](0021-browser-profiles-keyed-by-identity.md) — Browser profiles are keyed by identity, not by account row
- [0022](0022-a-login-is-a-transition-not-a-state.md) — A login is a transition, not a state
- [0023](0023-removal-deletes-the-login-coa-created.md) — Removing an account deletes the login coa created for it
- [0024](0024-browser-profiles-share-one-user-data-dir.md) — Browser profiles share one user-data-dir, with on-request reclaim (supersedes 0021's layout)
- [0025](0025-retire-the-legacy-console-kit.md) — The legacy console kit is retired, and the forge palette goes with it
- [0026](0026-coa-borrows-the-harness-it-does-not-fork-it.md) — coa borrows the harness; it does not fork it
- [0027](0027-one-tool-surface-alias-or-own.md) — A tool is aliased or owned, never both
- [0028](0028-per-tool-governance-rides-two-seams.md) — Per-tool governance rides two seams (superseded by 0029)
- [0029](0029-one-bounded-tool-surface-governed-at-one-seam.md) — One bounded tool surface, governed at one seam
- [0030](0030-delivery-one-intent-realized-per-backend.md) — Delivery is one intent, realized per backend
- [0031](0031-a-steer-is-recorded-when-the-model-receives-it.md) — A steer is recorded when the model receives it
- [0032](0032-the-cost-cap-bounds-fan-out.md) — The cost cap bounds fan-out, not a depth counter (superseded by 0035)
- [0033](0033-a-notice-is-not-a-message.md) — A notice is not a message (superseded in part by 0038)
- [0034](0034-a-subagent-is-a-session-with-a-parent-link.md) — A subagent is a session with a parent link
- [0035](0035-the-close-gate-is-the-only-block.md) — The close gate is the only block; the cost ceiling is archived
- [0036](0036-model-metadata-catalog-and-attachment-wire-shape.md) — A merged model-metadata catalog, and attachments ride the existing message shape
- [0037](0037-worktree-isolation-is-opt-in-bound-once-reaped-explicitly.md) — Worktree isolation is opt-in, bound once, and reaped explicitly
- [0038](0038-a-completion-notice-may-quote-the-childs-own-result.md) — A completion notice may quote the child's own result (supersedes 0033's "never the child's output" clause)

---

_Last reviewed: 2026-08-09_
