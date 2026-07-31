# 0017 — Login health is probe-derived; a broken active account is flagged, never auto-switched

Status: accepted · Date: 2026-07-19

## Context

coa is credential-blind (D84): it stores pointers to Claude config dirs, never
tokens. Detecting a stale login by reading the token file's expiry would brush
that invariant and lie whenever OAuth silently refreshes. Meanwhile the CLI
ships a purpose-built probe: `claude auth status --json` (non-interactive,
honors CLAUDE_CONFIG_DIR, reports loggedIn + email + subscription).

## Decision

- Login health comes ONLY from the status probe (and, strongest, a real auth
  failure in a live session). Never from token files.
- A Claude account is defined by its email: the declared email pre-fills the
  driven login (`--email`); the probe's email is the truth — a mismatch is
  flagged with keep/retry, and identity lines render probe facts.
- A broken ACTIVE account is flagged (attention badge, re-login action), never
  auto-switched — silent rerouting would hide the problem (SC-1).
- The OAuth URL capture needs a TTY, so the driver prefers node-pty and
  degrades to browser-only + probe-poll when unavailable — capture is an
  affordance, never a dependency.

## Consequences

- The reserved identity fields on the auth view are populated by probe, so
  manually-added accounts converge to email-identity with no migration.
- Health is daemon-cached per run, refreshed on surface view / ⟳ / live
  failure — no background polling.
