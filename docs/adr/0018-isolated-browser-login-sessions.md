# 0018 — Isolated browser login sessions, keyed by account, at the provider-descriptor layer

- Status: proposed
- Date: 2026-07-30

## Context and problem

coa is credential-blind (D84) and drives Claude's own `claude auth login`, but it does not own
the browser context. The OAuth handshake completes against whatever session the browser already
holds, so a declared `--email` is a prefill hint, not account selection ([ADR-0017](0017-probe-derived-login-health.md)
left email-defined accounts as "declared, mismatch-guarded" rather than enforced). The
maintainer's real workaround is a separate browser per account. Automating that inside coa is
the problem.

## Decision drivers

- **Honesty over evasion.** The maintainer signs into Claude with Google; `accounts.google.com`
  rejects embedded user agents. The fix must satisfy that policy, not spoof around it.
- **Generality (maintainer constraint).** The mechanism must not be Claude-specific — any
  provider with a cookie-session sign-in should reuse it. Claude is the first consumer.
- **Strict-superset (D85) and SC-1.** Off by default and byte-identical to today; every failure
  degrades to the existing path, never blocks.

## Considered options

1. **Embedded `BrowserWindow` + `session.fromPartition`.** Spiked; Claude's own page renders,
   but "Continue with Google" leaves for `accounts.google.com`, which refuses embedded UAs.
   Rejected.
2. **UA spoofing inside the embedded window.** Rejected — Google actively counters it, it breaks
   unpredictably, and it defeats a security control to reach one's own account.
3. **Launched real browser with a dedicated `--user-data-dir` profile, redirected via the
   `BROWSER` env var.** Spiked and verified: profile isolation holds, Google completes, and the
   CLI honors `BROWSER` so there is one window (the profiled one) with no race. Chosen.

## Decision

- coa signs an isolated account in by launching a **real browser with a per-account profile
  dir** (`--user-data-dir=<dir> --no-first-run --no-default-browser-check <authorize-url>`),
  **redirected via `BROWSER`** on the `claude auth login` spawn so the CLI delegates the open to
  coa's launcher instead of the default browser.
- The capability lives at the **auth / provider-descriptor layer**: a provider declares
  `isolatedBrowserSession`, and a neutral `browser-session` module owns detection, profile-dir
  management, and launcher construction. The Claude adapter is a consumer, not the owner.
- Profile dirs are **keyed by account id, not email** (also closing the `emailSlug` collision).
- A single **global setting, OFF by default**; win32 Chrome/Edge detection in v1; missing
  browser / unsupported provider / `BROWSER`-not-honored → the existing copy-link + paste-code
  path (SC-1). The paste-code return removes any need for localhost-callback interception.
- **This amends the premise of ADR-0017:** email-defined accounts become genuinely enforced
  because the profile has no other identity to inherit. The observe-then-name inversion ADR-0017
  left open is therefore off the table; the probe-derived mismatch phase remains as a safety
  net, not the primary guarantee.

## Consequences (good / bad)

- **Good:** email-defined accounts are real, not aspirational; the isolation mechanism is
  reusable by any future provider via one descriptor field; honest with Google's embedded-UA
  policy; off-by-default keeps D85; every failure degrades (SC-1).
- **Good:** paste-code return means no callback interception — the hardest piece of the original
  embedded design is gone.
- **Bad / cost:** per-account Chrome profiles are tens of MB and accumulate (mitigated by
  prompt-to-remove on account removal); win32-only detection in v1 (others fall back); relies on
  the CLI honoring `BROWSER` (spike-confirmed on 2.1.220, but a CLI behavior coa does not own —
  the fallback covers regressions).
- **Follow-up:** confirm in the next attended run that `BROWSER` replaces rather than supplements
  the default open, end to end with a real CLI-generated authorize URL.
