# Architecture Decision Records

Durable **why**. Each ADR captures one architecturally-significant decision and the reasoning behind it, in [MADR](https://adr.github.io/madr/)-lite form. ADRs are the permanent home for decisions that outlive the plan that produced them.

## Rules
- **Immutable once `accepted`.** Only typo/link fixes thereafter. A changed decision is a *new* ADR that supersedes the old one (set the old one's status to `superseded by NNNN`).
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

---

_Last reviewed: 2026-07-05_
