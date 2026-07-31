# 0023 — Removing an account deletes the login coa created for it

- Status: accepted
- Date: 2026-07-31

Completes [ADR-0022](0022-a-login-is-a-transition-not-a-state.md), which fixed the reporting of
pre-existing sessions but left the state that produced them in place. Follows the same reasoning
as [ADR-0021](0021-browser-profiles-keyed-by-identity.md), one layer down.

## Context and problem

Removing an account forgot the row and deliberately left the login where it lived. For an account
coa signed in itself, that login is a directory coa created under `~/.coa/logins/<slug>`, holding
live credentials.

Because the managed dir is derived from the email, re-adding the same address returns to the same
credentials. The maintainer hit the consequence twice in one session: remove an account, sign in
again, and the old session is simply there — first as a false "registered" (fixed in 0022), then,
once that was fixed, as a decision prompt for a session they had explicitly removed and did not
want.

0022 made that honest. It did not make it *right*: the user removed the account, and the thing
that makes the account exist stayed on disk.

This is the same defect as the orphaned browser profiles, in a more serious place. A profile is a
convenience cache; a login directory is the credential itself.

## Decision drivers

- **Removal should mean removal.** For state coa created, "forget the row but keep the secret" is
  a surprise, not a courtesy.
- **coa must not delete what it does not own.** Accounts added by pointing at an existing config
  dir (`~/.claude-school`, `~/.claude-personal`) are the user's own data, and predate coa.
- **The failure mode must be "kept".** Any ambiguity about ownership resolves to leaving the
  directory alone.

## Considered options

1. **Offer it as a toggle**, like "also delete the browser profile." Rejected by the maintainer:
   the two are not alike. The browser profile is a cache worth keeping deliberately; the login is
   the credential, and keeping it is what caused the surprise.
2. **Delete every config dir an account points at.** Rejected outright — it would destroy user
   data coa never created.
3. **Delete only what coa created, always; never anything else.** Chosen.

## Decision

- On account removal — single credential or whole provider — coa deletes the login directory
  **iff it created it**: `locator.type === 'config-dir'` and the directory lies inside
  `~/.coa/logins`. That test is `isManagedLoginDir`, which resolves the relative path and
  refuses anything that escapes the root or is the root itself.
- **A config dir the user pointed at is never touched**, at either verb. coa forgets the row and
  leaves the directory exactly where it found it.
- Deletion is unconditional for managed logins — no toggle. The browser profile keeps its opt-in
  toggle, because a cookie jar is a cache and a credential is not.
- The removal prompt says both halves plainly, since the behavior now differs by how the account
  was added.
- **`preexisting` (0022) stays.** It is no longer reachable by remove-then-re-add, but a
  pointed-at dir can still be already authenticated, and a user can always run
  `claude auth login` against one by hand. Removing the common cause does not remove the case.

## Consequences (good / bad)

- **Good:** removing an account genuinely removes it. The class of "phantom re-login" surprises
  is gone at the source rather than surfaced after the fact.
- **Good:** no orphaned credential directories accumulate — the login-dir analogue of the profile
  orphans, closed by construction rather than by a sweeper.
- **Bad / cost:** removing an account is now destructive to its coa-created sign-in, and there is
  no undo. Re-adding means a real handshake. That is the intended meaning of the word, and the
  prompt says so before it happens.
- **Bad / cost:** the ownership test is a path-containment check. It is case-sensitive, so a
  hand-edited `accounts.yaml` with different casing would fail to match and the directory would
  be kept. Failing toward "kept" is the correct direction for this check.
