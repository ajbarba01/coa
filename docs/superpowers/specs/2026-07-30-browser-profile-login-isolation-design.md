# Browser-profile login isolation — design

**Status:** implemented (2026-07-30 design; shipped on `main`). The launch model below was
revised after the design shipped: a live sign-in proved shim-forwarding of the authorize url
cannot work on win32 (see "Spike results" and "Launch model"). The attended confirmation that
coa's own launch lands the right identity end to end is the one open item — see ADR-0018's
follow-up.

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
3. **The CLI respects `BROWSER`, replacing rather than supplementing the default open.**
   Spawning `claude auth login` with `BROWSER` set to a shim caused the CLI to invoke
   `<BROWSER> <authorize-url>` **instead of** opening the default browser (shim returned
   success; no default browser appeared) — a later live sign-in with a recorder shim
   confirmed exactly one invocation, settling this for good. Tested against a throwaway
   `CLAUDE_CONFIG_DIR`; the login was never completed, so no credentials were written.
4. **The url does NOT arrive intact through a shim relay on win32.** A later live sign-in,
   pointing `BROWSER` at a recorder shim and running a real `claude auth login`, captured:
   ```
   FIRST_ARG_IS "\"https://claude.com/cai/oauth/authorize?code
   ```
   The CLI escapes the authorize url POSIX-style (`\"…\"`) before handing it to the shim, and
   Windows' `cmd` does not honor that quoting — the url's `&` becomes a command separator, and
   everything after the first `&` is eaten by `cmd` as separate commands *before the batch file
   runs*. No shim-side fix exists. The same run showed the CLI prints the full authorize url
   even through a plain pipe (not only a PTY), so capturing it independently — and launching
   the browser directly from that captured url, with no shell in the path — is reliable. This
   superseded the plan below of relaying the url through the shim; see "Launch model".

---

## Design

### Seam — a general capability, not a Claude feature

- **Provider descriptor gains `isolatedBrowserSession: boolean`.** A provider declares that its
  sign-in is a cookie-session flow that benefits from isolation. Claude sets it; a future
  provider needing the same is a descriptor field and no new machinery. (Maintainer constraint:
  "Claude is its first consumer, not its owner.")
- **A neutral `browser-session` module** owns the mechanism, at the auth layer (where a
  provider already declares its locator kind), **not** in the Claude adapter. Responsibilities:
  browser-binary detection, profile-directory management, the suppressor shim, and building the
  direct-launch argv.
- **The Claude adapter consumes it**: when isolation is on and the provider declares the
  capability, the login spawn sets `BROWSER` to the suppressor shim, and core hands the module
  the authorize url it captures off the CLI's own output so it can open the profiled browser
  directly.

### Launch model — suppressor shim + coa's own argv launch

`BROWSER` redirection alone does not work: see spike result 4 above. The open is two pieces:

1. `BROWSER` still points the `claude auth login` spawn at a coa-generated shim
   (`~/.coa/browser-profiles/<account-id>.cmd`/`.sh`), but the shim is now a **no-op
   suppressor** — it exits clean without touching its argument. Its only job is to swallow the
   CLI's default-browser fallback, so a second, wrong window never opens.
2. coa captures the authorize url directly off the CLI's own stdout (the CLI prints it even
   through a plain pipe — spike result 4) and **launches the profiled browser itself**:
   `<browser> --user-data-dir=<profile> --no-first-run --no-default-browser-check <url>`,
   spawned as an argv array with no shell in the path, so there is no quoting step for the
   url's `&` to be lost in.
3. The user completes the sign-in in that window. The code also returns via the existing
   paste-code path (proven end-to-end), so no localhost-callback interception is needed either
   way.

Both pieces are owned by the neutral `browser-session` module: the suppressor shim's contents
and the direct-launch argv are both pure functions, and the direct launch is fire-and-forget —
the login flow never waits on the browser window.

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

Setting off, no browser detected, provider without the capability, or a failed open →
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

Pure and TDD'd: binary detection, profile-dir keying, the suppressor shim's contents, the
direct-launch argv, and the descriptor-capability plumbing. The actual browser spawn + OAuth
handshake is **attended** — verified in a live run like today's PTY login, never in CI. A
`COA_LIVE`-gated round-trip test proves a direct argv spawn delivers an `&`-carrying url intact.

Attended-run checklist item: confirm exactly one profiled window opens on the full authorize
url, no default-browser window appears alongside it, and the sign-in completes as the declared
email — the end-to-end confirmation ADR-0018's follow-up is still waiting on.

---

## Out of scope

- macOS/Linux binary detection (fallback covers them).
- Any change to the credential-blind invariant, the probe, or the deny channel.
- Localhost-callback interception (paste-code return makes it unnecessary).

_Last reviewed: 2026-07-31_
