# 0024 — Browser profiles share one user-data-dir, and dead jars are reclaimed on request

- Status: accepted
- Date: 2026-07-31

Supersedes [0021](0021-browser-profiles-keyed-by-identity.md)'s **layout only**. Identity
keying itself survives untouched: `profileKey(email)` is unchanged, and the key now names a
Chrome `--profile-directory` instead of a whole `--user-data-dir`. The launch mechanism
([0019](0019-coa-opens-the-profiled-browser.md),
[0020](0020-courier-shim-relays-the-self-completing-url.md)) is unchanged.

## Context and problem

0021 fixed *which* directory a login reuses. It did not touch how much that directory costs.

Measured on the maintainer's machine, 2026-07-31: ten directories under
`~/.coa/browser-profiles/`, **1.2 GB**. The surprise was where the bytes were. In the live
135 MB jar:

| item | size | where |
| --- | --- | --- |
| `optimization_guide_model_store` | 49 MB | user-data-dir root |
| `Safe Browsing` | 21 MB | user-data-dir root |
| `Default/` | 40 MB | the profile — and mostly page cache |
| `Default/Network/Cookies` | **44 KB** | the actual sign-in |

**~90% of a profile is not the login**, and everything large sits at the user-data-dir root
rather than inside the profile. Giving each identity its own user-data-dir therefore bought
isolation the expensive way: it paid for a copy of the model store, the Safe Browsing
database and the component cache per identity, to isolate 44 KB of cookies.

## Decision drivers

- **Isolation must not weaken.** Whatever replaces the layout has to give each identity its
  own cookie jar, exactly as 0018 requires.
- **Compose, don't reinvent (P8).** Chrome already ships multi-profile; coa should use it
  rather than build around it.
- **0018 still binds: never delete silently.** Any reclaim is a surfaced list the user acts
  on, never a sweeper.

## Considered options

1. **Keep one user-data-dir per identity, prune aggressively with flags.** Flags alone
   recover ~120 MB of the ~200 MB, but the remainder is still paid per identity, and the
   Safe Browsing database — the one component that should not be disabled — is among the
   largest. Insufficient alone.
2. **Share the user-data-dir, isolate with `--profile-directory`.** Chosen.
3. **Share the user-data-dir and keep the old directory names as profile-directories in
   place.** Rejected: the pre-existing per-identity directories and the new profile
   directories would become indistinguishable siblings, and the nine legacy hex-named
   directories cannot be identified from their contents — verified, their `Preferences`
   carries `account_info: None` and `profile.name: "Your Chrome"`, because these profiles
   sign into claude.com and never into Chrome itself.

## Decision

- **One `--user-data-dir` for every identity, at `~/.coa/browser-session/profiles`, with one
  `--profile-directory=<profileKey(email)>` per identity.** The shims and relayed-url files
  stay at `~/.coa/browser-session/`, outside the user-data-dir, so coa's own files never mix
  with Chrome's ~30 root directories.
- **Disk flags on every launch** — `--disable-component-update`,
  `--disable-features=OptimizationHints,OptimizationGuideModelDownloading`,
  `--disable-gpu-shader-disk-cache`. None of what they suppress serves a window whose only
  job is one sign-in.
- **Safe Browsing is deliberately left ON.** It is the second-largest item on disk and also
  the phishing database guarding a window where a password is typed. The shared root is what
  makes keeping it affordable — it is now paid once for all identities instead of per
  identity.
- **Clean break, not migration.** Jars in the old layout are not carried over. Migrating one
  directory would mean a copy step plus a permanent dual-layout lookup, for content whose
  irreplaceable part is 44 KB. `#adoptLegacyProfile` is therefore **removed**: adopting a
  legacy jar would import the old layout into the new one.
- **`~/.coa/browser-profiles/` is dead in one piece** and is removed by hand. It is not
  enumerated by any surface: with every directory in it unconditionally dead, there is no
  per-item decision for a list to offer.
- **Reclaim covers the new root only.** `AuthView.browserSession.reclaimable` lists profile
  directories no account resolves to; `reclaimBrowserProfiles` deletes the ones named. Names
  only — no sizes, so the read costs two `readdir`s and can ride every view read. A jar any
  live account resolves to never enters the list, which restates 0021's shared-jar guard at
  this second, account-less door.
- **Deletion renames before it deletes.** Measured: a recursive delete of a jar whose window
  is open fails *partway*, leaving 349 files and a directory that still looks like a profile.
  The jar is moved to a dotted `.reclaim-<key>-<ts>` name first — atomic, whole or nothing —
  then deleted best-effort, with surviving trash swept on the next enumeration. A jar that
  could not be moved simply appears in the list again, which is the whole error report the
  surface needs (SC-1: no error channel).

Verified before adoption, not assumed: two `--profile-directory` values under one root
produce separate `Network/Cookies`, `Login Data` and `Preferences`, with zero root-level
cookie store, and the heavy component directories land at the root as siblings of both.

## Consequences (good / bad)

- **Good:** ten identities cost roughly 45 MB shared plus ~30 MB each, instead of ~200 MB
  each. Each new login costs ~30 MB rather than ~200 MB.
- **Good:** the expensive components are downloaded once, so the second identity's sign-in
  is faster as well as smaller.
- **Good:** a profile directory is discriminated from Chrome's own root directories by the
  presence of a `Preferences` file, so orphan detection needs no registry of coa's own.
- **Bad / cost:** one re-login. The single live jar is not migrated, and the existing 1.2 GB
  leaves by hand rather than through code.
- **Bad / cost:** one shared browser process. Verified — a second `--profile-directory`
  launch hands off to the running instance rather than starting its own. Each window is
  still its own jar, but a crash takes every open profiled window with it, where the old
  layout gave each jar its own process.
- **Bad / cost:** a jar whose window is open cannot be reclaimed until it is closed. The
  rename makes that a clean no-op rather than a half-deleted directory, but it is still a
  case the user has to resolve themselves.
