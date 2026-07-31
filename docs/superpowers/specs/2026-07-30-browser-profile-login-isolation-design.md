# Browser-profile login isolation — design

**Status:** implemented (2026-07-30 design; shipped on `main`). The attended `BROWSER`
replace-vs-supplement confirmation is the one open item — see ADR-0018's follow-up.

**Goal.** Let coa sign each account in through a **real browser launched with a dedicated
profile directory**, so each account has its own cookie jar and a sign-in — including
"Continue with Google" — lands on the account you intend. This makes email-defined accounts
genuinely enforced instead of aspirational, and it does so as a **general** capability any
provider needing a session-scoped sign-in can use, with Claude as its first consumer.

**Origin.** D3 of the 2026-07-21 attended run
(`docs/superpowers/plans/2026-07-18-in-app-login-email-accounts.md`, "Attended run —
deviations"). Decided and spiked there; the launch-model unknown is resolved by the spike
recorded below. This design amends the premise of
[ADR-0017](../../adr/0017-probe-derived-login-health.md); see the companion ADR-0018.

---

## The problem

coa is credential-blind (D84): it drives Claude's own `claude auth login` against a managed
config dir and never touches tokens. But it does not own the browser context. The OAuth
handshake completes against whatever claude.ai session the browser already holds, so the
declared `--email` is a *prefill hint*, not account selection — the landed identity is whoever
was signed in. The maintainer's real-world workaround is a different browser per account, i.e.
hand-rolled session isolation. This design automates that.

The obvious in-app fix — an embedded Electron `BrowserWindow` on a per-account
`session.fromPartition(...)` — was spiked and **rejected**: the maintainer signs into Claude
with Google, and `accounts.google.com` refuses embedded user agents (`disallowed_useragent`).
UA spoofing was considered and rejected (Google counters it; it defeats a security control to
reach one's own account). A **launched real browser with `--user-data-dir`** satisfies the
policy honestly and still isolates per account.

---

## Spike results (do not re-derive)

Verified live on the maintainer's machine (win32, `claude` 2.1.220):

1. **Profile isolation holds and unblocks Google.** `chrome --user-data-dir=<dir>
   --no-first-run --no-default-browser-check <url>` created a standalone profile tree with its
   own `Default/Network/Cookies`; the launched window was signed out of Google, and "Continue
   with Google" completed there. Chrome at the standard win32 path; Edge present, same flag.
2. **No suppress flag exists** on `claude auth login` (only `--claudeai`, `--console`,
   `--email`, `--sso`). The Claude Code docs' `--no-browser` refers to the first-run/remote
   login flow, not this subcommand.
3. **The CLI respects `BROWSER`.** Spawning `claude auth login` with `BROWSER` set to a shim
   caused the CLI to invoke `<BROWSER> <authorize-url>` **instead of** opening the default
   browser (shim returned success; no default browser appeared). This is the mechanism this
   design uses. Tested against a throwaway `CLAUDE_CONFIG_DIR`; the login was never completed,
   so no credentials were written.

**One trivial attended-run confirmation remains:** that `BROWSER` *replaces* rather than
*supplements* the default open (near-certain — standard `$BROWSER` semantics, the shim
returned exit 0, no default window observed). Not a blocker; the fallback below covers the
"supplements" case anyway.

---

## Design

### Seam — a general capability, not a Claude feature

- **Provider descriptor gains `isolatedBrowserSession: boolean`.** A provider declares that its
  sign-in is a cookie-session flow that benefits from isolation. Claude sets it; a future
  provider needing the same is a descriptor field and no new machinery. (Maintainer constraint:
  "Claude is its first consumer, not its owner.")
- **A neutral `browser-session` module** owns the mechanism, at the auth layer (where a
  provider already declares its locator kind), **not** in the Claude adapter. Responsibilities:
  browser-binary detection, profile-directory management, and building the launch command.
- **The Claude adapter consumes it**: when isolation is on and the provider declares the
  capability, the login spawn sets `BROWSER` to the launcher the module produces.

### Launch model — `BROWSER` redirection

When isolation is ON for a driven login:

1. coa resolves the account's profile dir (`~/.coa/browser-profiles/<account-id>/`) and the
   detected browser binary.
2. coa spawns `claude auth login --claudeai --email <email>` with `CLAUDE_CONFIG_DIR=<managed
   dir>` **and** `BROWSER=<launcher>`, where the launcher opens
   `<browser> --user-data-dir=<profile> --no-first-run --no-default-browser-check <url>`.
3. The CLI hands the authorize URL to the launcher; the **profiled** browser opens; the user
   completes there. The code returns via the existing paste-code path (proven end-to-end), so
   no localhost-callback interception is needed.

The launcher is a coa-generated command the OS can run as `<launcher> <url>` (e.g. a
per-login shim that encodes browser + profile dir and forwards argv). Exact shim shape and the
URL-quoting details (the authorize URL contains `&`) are implementation concerns for the plan;
the spike confirmed the URL arrives intact.

### Profile lifecycle

- Dirs under `~/.coa/browser-profiles/<account-id>/`, **keyed by account id, not email** —
  which also closes the ledgered `emailSlug` collision Minor.
- Removing an account **prompts** to delete its profile (tens of MB; they accumulate). Prompt,
  not silent — it is a destructive filesystem op the user should see.

### Setting

- One **global** toggle, "use a dedicated browser profile for logins", **OFF by default**.
  With it off, behavior is byte-identical to today (D85 strict-superset).

### Platforms

- v1 detects Chrome/Edge on **win32** (verified). Any Chromium shares the flags.
- Binary is auto-detected with an optional override pre-filled from detection — never a
  required configuration step.
- macOS/Linux: no detection in v1; "no browser found" degrades to the fallback below. Added
  when someone runs coa there.

### Fallback (SC-1)

Setting off, no browser detected, provider without the capability, or `BROWSER` not honored →
today's copy-link + paste-code path, always available. Isolation is an affordance, never a
dependency; a broken path degrades, never blocks.

---

## What this changes about the email pre-step

The declared email genuinely selects the session (the profile has no other identity to inherit),
so "email-defined accounts" stops being aspirational. The observe-then-name inversion that
ADR-0017 left open is therefore **off the table**. The mismatch phase remains as a safety net,
not the primary guarantee.

---

## Testing

Pure and TDD'd: binary detection, profile-dir keying, launcher command-building, and the
descriptor-capability plumbing. The actual browser spawn + OAuth handshake is **attended** —
verified in a live run like today's PTY login, never in CI.

Attended-run checklist item: confirm `BROWSER` replaces (not supplements) the default open, and
that a real CLI-generated authorize URL loads in the profiled window (the spike loaded
`claude.ai/login` and a captured URL separately; confirm the end-to-end path once).

---

## Out of scope

- macOS/Linux binary detection (fallback covers them).
- Any change to the credential-blind invariant, the probe, or the deny channel.
- Localhost-callback interception (paste-code return makes it unnecessary).

_Last reviewed: 2026-07-30_
