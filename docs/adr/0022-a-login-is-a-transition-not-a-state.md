# 0022 — A login is a transition, not a state

- Status: accepted
- Date: 2026-07-31

Amends [ADR-0017](0017-probe-derived-login-health.md), which established that the probe's landed
email is the truth. It still is — but a probe result only belongs to the attempt that caused it.

## Context and problem

`LoginManager` polled `claude auth status --json` against the managed login dir and finalized the
flow the moment it reported `loggedIn: true`. That is a **state**, and the flow treated it as
evidence of an event.

Two existing behaviors make the state survive across attempts:

- Removing an account forgets the row but deliberately leaves the login where it lives. The
  removal prompt says so in as many words: *"coa forgets this login. The login itself stays
  where it lives — nothing is touched at the provider."*
- The managed dir is derived from the email slug, so re-adding the same address returns to the
  same directory.

So a "new" sign-in for a previously-removed account probes `loggedIn: true` on its first tick and
registers, regardless of what happened in the browser. Found live on 2026-07-31: the maintainer
opened a relogin, saw the browser was on the wrong account, **closed the tab without
authorizing — and coa reported a successful login.** The flow had no way to distinguish "this
handshake succeeded" from "this directory was already signed in."

The mismatch guard did not catch it, because the pre-existing session's email *matched* the
declared one. It was the right identity by the wrong route, and the user never consented to it.

## Decision drivers

- **Honest reporting.** coa must not claim an event that did not occur. This is the same
  standard the deny channel and the cost cap are held to.
- **SC-1 — help, never cage.** The pre-existing session is usable and often what the user wants.
  Surfacing it is right; blocking it is not.
- **Credential-blindness (D84).** coa cannot inspect the credential file to date it. The only
  instrument available is the same probe, run earlier.

## Considered options

1. **Clear the login dir on account removal**, so the state cannot survive. Rejected as the
   primary fix: it changes what removal means, and it does not help the many other ways a dir can
   already be authenticated (a manual `claude auth login`, a dir pointed at by hand). It remains
   available as a separate choice about removal.
2. **Date the credentials** and ignore ones older than the flow. Rejected: reading credential
   files is exactly what D84 forbids, and file mtimes are a proxy that lies.
3. **Establish a baseline and require a transition.** Chosen.

## Decision

- **A completion counts only if the login dir started clean.** `LoginManager` probes the dir once
  when the flow starts, concurrently with the CLI spawn, and records the baseline. The poll
  finalizes only when the baseline is known to be `clean`. Racing the spawn is safe: the only way
  the CLI could beat that probe is by completing a browser handshake in less time than one
  `auth status` call.
- **A dir that was already authenticated ends the flow in a new `preexisting` phase**, naming who
  it holds. Nothing is registered. The CLI is killed — no handshake is left running for a
  decision — and the browser open is suppressed.
- **The user chooses: use this login, or cancel.** "Try again" is deliberately not offered: it
  would land the same credentials again. Signing that dir out is the user's own action, not
  coa's.
- **A baseline that cannot be established is treated as clean**, so a probe failure degrades to
  exactly the previous behavior rather than stranding the flow (SC-1).
- **The verdict is enforced at the completion funnel, not at each caller.** Three paths reach
  registration — the poll, the grace probe scheduled by the CLI's exit, and the user's explicit
  "use it". Guarding only the poll let the exit path register the pre-existing session anyway,
  about two seconds after the decision appeared on screen; killing the CLI is itself what fires
  that exit. The check therefore lives in `#finalize`, which both probe-driven paths pass
  through, while the user's own choice goes straight to `#complete` and is unaffected.

## Consequences (good / bad)

- **Good:** coa no longer reports logins that did not happen. Closing the browser without
  authorizing now produces a decision, not a false success.
- **Good:** the pre-existing session is still one click away, so the common case — re-adding an
  account you meant to keep — costs nothing.
- **Bad / cost:** every flow spends one extra `auth status` spawn at start. Negligible against a
  browser handshake, and it runs concurrently with the spawn.
- **Bad / cost:** a user who genuinely wants to re-authenticate a healthy dir as someone else must
  sign that dir out first. That is the honest sequence, and the phase copy says so.
- **Open:** whether account removal should also offer to clear the managed login dir, the way it
  offers to delete the browser profile. That would make removal mean the same thing at both
  layers, and is a separate decision (option 1 above).
