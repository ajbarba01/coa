# In-app Claude login/relogin + attention badges — design

_Design date: 2026-07-18. Status: approved, pre-implementation (spike- and mockup-gated)._

Bring the Claude subscription **login and relogin flow inside coa**, so the user no longer has to create a
config dir, run `claude /login` there by hand, and then point coa at it. coa should **drive** the flow,
**detect when a login has gone stale** (needs relogin), and **surface that with attention badges** on the
Auth sidebar tab and the provider row / account selector.

Builds on the committed multi-account auth ([[auth-multiaccount-design]], [[auth-backend-phase1-done]]): coa
stays **credential-blind** — it stores a pointer to a config dir, never a token. This feature does not
change that; coa triggers and watches Claude's own login, which writes the credentials into the dir itself.

---

## 1. The load-bearing unknown → a bounded spike (step 1)

How much of `claude`'s login coa can drive is the risk, exactly as the `config-dir` spike gated the
multi-account work. The spike must answer:

1. Can `claude`'s login run **non-interactively** against a target `CLAUDE_CONFIG_DIR` spawned by coa, or
   is it only the interactive TUI `/login`?
2. Does it **print the OAuth URL / code to stdout** (which is what lets coa show it *in its own window* —
   near-embedded), or does it just open a browser silently?
3. Does the finished login land the credentials **in the config-dir file** (confirming coa can watch that
   file and stay credential-blind)?
4. Same path for **relogin** into an already-used dir?

**Outcome sets the ceiling:** #2 present ⇒ near-embedded (coa shows URL/code); absent ⇒ solid **Guided**
(coa launches Claude's own login + auto-detects completion). Either is a large upgrade over today. The
maintainer's target is "guided at minimum, as close to fully embedded as the spike allows."

---

## 2. The login flow (Claude)

- **Add Claude login** (Auth surface): coa creates the config dir in a managed spot
  (`~/.coa/logins/<label>/`), drives `claude`'s login against it, **watches that dir for the credentials
  file, and auto-registers the account the moment it lands.** No manual `mkdir`, no manual "add directory."
  If the spike yields the URL/code on stdout, coa renders it in-app; otherwise the browser opens to Claude's
  own screen.
- **Relogin** = the same mechanism aimed at the *existing* dir. Offered from the account row **and** from
  the badge's action.
- coa **never reads the token** — it only watches for the file. Credential-blindness holds (D84 untouched).
- **Keep the manual path** ("point at an existing config dir") as an advanced option — strict-superset,
  nothing removed; a power user who already has a logged-in dir is not forced through the driven flow.

---

## 3. Detection (login health)

A **probe**, not reading the token file — the credential-blind-preserving choice:

- coa reuses the idle `supportedModels()` query per account; a logged-out/expired dir already returns
  *"Not logged in"* (proven in the multi-account spike). Behaviourally honest (it checks auth actually
  works) and never opens the credentials file. Reading the token's `expiresAt` off disk is rejected: it
  brushes the invariant and lies when OAuth silently auto-refreshes.
- **When it runs:** on app open, on viewing the Auth surface, on manual refresh (the existing ⟳), and — the
  strongest signal — **a real auth failure during a live session immediately flips that account to
  needs-relogin.** No aggressive background polling (cost + false alarms).
- This finally **populates the long-reserved `expired` / identity fields** on `CredentialView` (Phase-2
  fields today, unset — see `console-viewmodel/reads.ts`).

---

## 4. Attention badges

- **Meaning (v1): needs relogin** (login broken). Built as a **generic attention channel** so future
  reasons (missing key, expired API key, unfinished setup) slot in without rework.
- **Surfaces:** the Auth sidebar tab (dot/count), the provider row in the sidebar/selector, and the account
  selector in the dock.
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

- **Login-driver module** — spawn + watch, on the **Claude-adapter seam** (backend-specific, like
  `resolveAuthEnv`). Managed-dir creation, the spawn, and the file-watch completion detection.
- **Health probe** — reuses `fetchClaudeModels`' idle-query machinery; a thin `probeHealth(locator)` →
  `healthy | needs-relogin`.
- **RPC verbs** — `startLogin` / `relogin` / `probeHealth`, plus health fields threaded onto the assembled
  `CredentialView` and badge state onto the auth view.
- **Renderer** — login/relogin actions in the Auth surface + account row; badge rendering on the three
  surfaces; the live-failure → needs-relogin transition wired from the session error path.

---

## 7. What is pure vs attended

- **Pure / TDD'd:** managed-dir path logic, login-state transitions (idle → logging-in → registered /
  failed), health-state transitions, badge derivation in the view assembler, RPC verb routing.
- **Attended (the spike + a thin driver):** the actual spawn + OAuth handshake + file-watch — verified
  live, not in CI (mirrors how the multi-account SDK-honors-env piece was an attended spike).

---

## 8. Sequencing

0. **High-fidelity in-app mockup pass** (shared gate with the model-list plan) — covers the login/relogin
   flow and the badge surfaces, to confirm no surface is missed **before** implementation.
1. **Login spike** (§1) — sets guided vs near-embedded.
2. M0/shared: login-state + health-state schema; badge/attention field on the auth view.
3. Login-driver module (managed dir + spawn + watch) — pure parts TDD'd, spawn attended.
4. Health probe + the live-failure → needs-relogin transition.
5. RPC verbs + daemon wiring.
6. Renderer: login/relogin actions + badges on the three surfaces.
7. ADR: "login health is probe-derived, never token-file-read; broken active account is flagged, not
   auto-switched."

---

_Last reviewed: 2026-07-18._
