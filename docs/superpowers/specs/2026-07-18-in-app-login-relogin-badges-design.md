# In-app Claude login/relogin + attention badges — design

_Design date: 2026-07-18. Status: approved; amended same day after the Gate-1 spike and maintainer review
(email-defined accounts; probe = `claude auth status`)._

Bring the Claude subscription **login and relogin flow inside coa**, so the user no longer has to create a
config dir, run `claude /login` there by hand, and then point coa at it. coa **drives** the flow, **detects
when a login has gone stale** (needs relogin), and **surfaces that with attention badges** on the Auth
sidebar tab, the provider row, and the nav AccountHud. And the account model gets its real identity: **a
Claude account is defined by its email.**

Builds on the committed multi-account auth ([[auth-multiaccount-design]], [[auth-backend-phase1-done]]): coa
stays **credential-blind** — it stores a pointer to a config dir, never a token. This feature does not
change that; coa triggers and watches Claude's own login, which writes the credentials into the dir itself.
Everything coa learns, it learns from the CLI's stdout and exit codes — never from a token file.

---

## 1. Spike results (Gate 1 — DONE, attended, real `claude` 2.1.214)

The load-bearing unknowns are resolved; these facts are verified live:

- **Login command:** `claude auth login --claudeai` (subscription; `--console` is API billing — avoid). No
  `--config-dir` flag, but it **honors `CLAUDE_CONFIG_DIR`** — coa spawns it with that set to a managed dir.
- **`--email <email>`** — *"Pre-populate email address on the login page."* The login page arrives with the
  account's email already filled; relogin always rides the stored email automatically.
- It **auto-opens the browser AND prints the full OAuth URL to stdout** ("If the browser didn't open,
  visit: …") — but **only on a TTY**; with piped stdio it prints nothing. ⇒ The driver spawns it under a
  **pseudo-terminal** (`node-pty`) to capture the URL, and **degrades gracefully** if no URL appears (the
  browser still opened; the copy affordance shows "link unavailable"). PTY trouble can never cage the flow.
- **Probe:** `claude auth status --json` → `{loggedIn, authMethod, apiProvider, email, orgId, orgName,
  subscriptionType}` — purpose-built, non-interactive, honors `CLAUDE_CONFIG_DIR` (empty dir ⇒
  `loggedIn:false`). This **supersedes the original `supportedModels()` probe idea**: faster, and it returns
  the identity coa needs, while coa still only ever consumes CLI output.

⇒ The real flow is a **hybrid**: browser primary (pre-filled with the email) + coa showing the captured URL
in-app with a **one-click copy** (the VSCode pattern — paste it into the browser profile that already knows
the email) + the code-paste field as the deeper fallback.

---

## 2. Email-defined accounts + the login flow

- **The identity model.** The stored account entry gains one field: **`email`** — the declared identity coa
  pre-fills logins with. The probe-derived identity (`email · plan`) stays a separate, live-read fact; they
  usually agree, and when they don't, coa says so (mismatch, below).
- **Row display:** the email is the account's **name**; the identity line underneath carries probe facts
  (plan/org). The label becomes an **optional nickname** (defaults to the email; a renamed account shows the
  nickname with the email on the identity line).
- **Add flow** ("sign in with claude"): the dialog's first step asks for **the email** — that is what adding
  an account *is* now. coa derives the managed dir (`~/.coa/logins/<email-slug>/`), spawns
  `claude auth login --claudeai --email <email>` with `CLAUDE_CONFIG_DIR` set, shows the captured URL with
  copy + the code fallback while **watching for completion**, and registers the account the moment the probe
  reports `loggedIn`. No manual `mkdir`, no manual "add directory."
- **Relogin** = the same mechanism aimed at the *existing* dir with the stored email. Offered from the
  account row **and** from the badge's action.
- **Mismatch:** the probe reports a *different* email than the one requested → the dialog flags it
  ("signed in as B — expected A") with actions **keep as B** (updates the declared email) / **try again**.
  Flagged, never blocked (SC-1).
- **The manual path stays** ("point at an existing config dir") — strict-superset. Its email is unknown at
  add-time; the **first probe backfills it**, so every account converges to email-identity with no
  migration. Existing on-disk accounts gain identity the same way on their next refresh.

---

## 3. Detection (login health)

A **probe**, never a token-file read — the credential-blind-preserving choice:

- `claude auth status --json` per config-dir account. One probe feeds **three things**: health
  (`loggedIn` → `healthy | needs-relogin`), the identity line (`email · subscriptionType`), and the
  declared-email backfill for manual-path accounts.
- **When it runs:** on app open, on viewing the Auth surface, on manual refresh (the existing ⟳), and — the
  strongest signal — **a real auth failure during a live session immediately flips that account to
  needs-relogin.** No aggressive background polling (cost + false alarms).
- This populates the long-reserved `expired` / identity fields on `CredentialView` (see
  `console-viewmodel/reads.ts`).

---

## 4. Attention badges

- **Meaning (v1): needs relogin** (login broken). Built as a **generic attention channel** so future
  reasons (missing key, expired API key, unfinished setup) slot in without rework.
- **Surfaces:** the Auth sidebar tab (dot/count), the provider row in the sidebar, and the **nav
  AccountHud** (the account surface today — the dock account selector named in the original draft no longer
  exists).
- A broken **active** account is **flagged, not auto-switched** — silently rerouting to another login would
  hide the problem. The badge's primary action is **"Re-login"** (one click into the relogin flow); "switch
  account" stays available.

---

## 5. Scope

Driven login flow = **Claude subscription only** in v1. DeepSeek/LongCat are key-paste; their future
"attention" state (missing/invalid key) is a later extension of the same generic badge channel. The badge
mechanism is generic now; only the Claude relogin trigger is wired.

---

## 6. Plumbing

- **Login-driver module** — on the **Claude-adapter seam** (`adapter-claude-sdk`, like `resolveAuthEnv`):
  managed-dir creation, the PTY spawn (`node-pty`), the stdout URL capture with graceful degrade, and
  completion detection via the status poll.
- **Health probe** — a thin `probeHealth(locator)` over `claude auth status --json` →
  `{health, email?, plan?, org?}`.
- **RPC verbs** — `startLogin {email, credentialId?}` / `cancelLogin` / `loginState` (the renderer polls
  ~1s while the dialog is open — no new push machinery) / `probeHealth`; health + identity + badge state
  threaded onto the assembled auth view, so badge derivation is view-assembler logic, tested.
- **Renderer** — the email-first sign-in dialog (copy affordance, code fallback, mismatch state), relogin
  actions on the account row + badge, badges on the three surfaces, email-primary credential rows, and the
  live-failure → needs-relogin transition wired from the session error path.

---

## 7. What is pure vs attended

- **Pure / TDD'd:** managed-dir path logic (email-slug), login-state transitions (idle → launching →
  awaiting → watching → registered / mismatch / failed), health-state transitions, the email backfill,
  badge derivation in the view assembler, RPC verb routing.
- **Attended (thin driver):** the actual PTY spawn + OAuth handshake + completion detection — verified
  live, not in CI (mirrors the multi-account SDK-honors-env spike).

---

## 8. Sequencing

0. ~~High-fidelity in-app mockup pass~~ — **done** (branch `mockups/model-list-and-login`).
1. ~~Login spike~~ — **done** (§1).
2. M0/shared: login-state + health-state schema; `email` on the account entry; badge/attention field on the
   auth view.
3. Login-driver module (managed dir + PTY spawn + watch) — pure parts TDD'd, spawn attended.
4. Health probe + identity/email backfill + the live-failure → needs-relogin transition.
5. RPC verbs + daemon wiring.
6. Renderer: email-first login flow + relogin actions + badges + email-primary rows.
7. ADR: "login health is probe-derived, never token-file-read; a broken active account is flagged, not
   auto-switched; `--email` is a hint, the probe is the truth."

---

_Last reviewed: 2026-07-18._
