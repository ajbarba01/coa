# 0021 — Browser profiles are keyed by identity, not by account row

- Status: superseded (layout only) by [0024](0024-browser-profiles-share-one-user-data-dir.md)
- Date: 2026-07-31

Amends [0018](0018-isolated-browser-login-sessions.md)'s "profile dirs are keyed by account
id, not email." The launch mechanism ([0020](0020-courier-shim-relays-the-self-completing-url.md))
is unchanged; this is only about what names the directory.

## Context and problem

0018 keyed each browser profile by a minted account id, to close a real defect: `emailSlug`
collapses every non-alphanumeric run to `-`, so `a.b@c.com`, `a-b@c.com`, and `a+b@c.com` all
slug to `a-b-c-com` and would have shared one cookie jar.

Keying by the account row bought that at a price the maintainer hit within a day of shipping:

- **A removed account strands its jar.** The id dies with the row, so nothing can name the
  directory again. The removal prompt's "also delete the browser profile" defaults to *off* —
  it explicitly offers to keep the profile — and under id keying, keeping it produces an
  unreachable directory. **The prompt offered a choice that could not work.**
- **A mismatch-retry mints a fresh id on purpose**, abandoning the previous jar rather than
  clearing it. Every retry leaks a populated directory.
- **The cache never gets reused.** The value of a per-identity jar is that the second sign-in
  skips the identity provider entirely; id keying threw that away whenever a row changed.

Measured on the maintainer's machine during the 2026-07-31 attended run: **eight directories,
885 MB, six of them unreachable** — and a *single* sign-in produced three of them, because two
attempts were abandoned and re-minted. Each abandoned jar also meant signing into Google again.

The generalization is that the thing being isolated is **an identity**, not an account row.
Account rows are per provider; the browser session is not. Two rows signed in as the same
person — a Claude login and a future Codex login — want the *same* jar, and id keying makes
that structurally impossible.

## Decision drivers

- **The jar is a cache of a signed-in identity.** Its worth is in being found again.
- **Collisions still must not happen.** Whatever replaces the id has to be at least as safe as
  it was.
- **The profile root should stay inspectable.** Opaque ids are half of why the orphans were so
  hard to reason about; a bare hash would repeat that mistake.

## Considered options

1. **Keep account-id keying, add a sweeper** for unreferenced directories. Rejected: it treats
   the symptom, keeps the cache useless across row changes, and still cannot share a jar
   between providers. It also means coa deleting directories on its own initiative, which 0018
   deliberately refused.
2. **Key by a bare hash of the email.** Fixes collisions and reuse, but makes the profile root
   unreadable — you cannot tell whose jar a directory is without reversing a hash.
3. **Key by readable slug + short digest of the normalized email.** Chosen.

## Decision

- The profile key is `profileKey(email)` = normalized-email slug (lowercased, trimmed, capped)
  + `-` + the first 6 hex of a SHA-256 of the full normalized address, e.g.
  `wormsegment1000-gmail-com-4f9a2c`. The digest is what makes it collision-free; the slug is
  what keeps the directory identifiable by a human.
- **The profile dir, the courier shim, and the relayed-url file are all keyed by it.** Account
  ids remain, but only as registry identity — they no longer name anything on disk.
- **An account with no declared email gets no isolation**, and no profile. It could not have
  one before either: a profile only ever appears through a driven login, which always declares
  an email.
- **A mismatch-retry clears the jar instead of abandoning it.** Under identity keying the retry
  gets the same directory back, so it must be emptied or it lands the same wrong account again.
  This is the one place coa deletes a profile on its own — scoped to a retry the user just
  asked for, never a background sweep.
- **A shared jar is not one row's to delete.** Removal only deletes the profile when no
  surviving account resolves to the same key; the view flags `profileShared` so the prompt says
  so rather than offering an option that would sign another login out. Removing a whole
  provider applies the same guard, because the sharer may be under a different provider.
- **Pre-identity jars are adopted, not stranded.** When a login finds no directory for its key
  but the account's old id-keyed directory exists, it is renamed into place. Best-effort: a
  failed rename means a fresh jar, never a failed login.

## Consequences (good / bad)

- **Good:** a relogin reuses the session it already established — the point of the cache.
- **Good:** Claude and any future provider signed in as the same person share one jar, so the
  second sign-in is free. This is the correct axis of isolation: between identities, not
  between account rows.
- **Good:** the orphan class largely dissolves. One directory per identity, ever, and removal
  can actually reach it. The prompt's "keep the profile" option now means something.
- **Bad / cost:** deleting an account and re-adding it silently inherits the old cookies. That
  is the intended behavior — the removal prompt asks — but it is a real change from "removal is
  a clean slate."
- **Bad / cost:** renaming an account's *email* moves it to a different jar and leaves the old
  one behind. Bounded by the number of distinct addresses ever used, and readable enough to
  identify by hand.
- **Bad / cost:** the six directories already orphaned by id keying are not reachable by the
  migration, which can only adopt jars whose account row still exists. Cleaning those up
  remains a deliberate maintainer action, as 0018 decided.
