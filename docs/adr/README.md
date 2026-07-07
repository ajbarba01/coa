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
- [0009](0009-single-deny-channel.md) — Exactly two blocks through one deny channel (SC-1)
- [0010](0010-append-only-conversation-log.md) — Converge conversation persistence onto a single append-only log (deferred)

---

_Last reviewed: 2026-07-06_
