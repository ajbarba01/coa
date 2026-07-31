# Browser-profile disk: shared root + orphan reclaim

Design for one arc with one ADR. Supersedes nothing in the login arc, which is complete and
live-verified; this changes only where profiles sit on disk and adds a door for dead ones.

## The problem, measured

Ten directories under `~/.coa/browser-profiles/`, **1.2 GB**. Nine are legacy hex-named
(id-keyed, pre-ADR-0021) and dead; one is identity-keyed and live.

The surprise is that **~90% of a profile is not the login**. In the live 135 MB jar:

| item | size | where |
| --- | --- | --- |
| `optimization_guide_model_store` | 49 MB | user-data-dir root |
| `Safe Browsing` | 21 MB | user-data-dir root |
| `Default/` | 40 MB | the profile — and mostly page cache |
| `Default/Network/Cookies` | **44 KB** | the actual sign-in |

44 KB of irreplaceable state inside a 135 MB directory, and everything large sits at the
user-data-dir root rather than in the profile. That asymmetry is the whole basis for the
restructure.

## Verification (2026-07-31, measured before this design was written)

Lever 1 — a shared `--user-data-dir` with per-identity `--profile-directory` — was unverified.
It is now. Two headless Chrome launches against one temporary root, then the live jar:

- **Jar isolation holds.** `<root>/ProfA/Network/Cookies` and `<root>/ProfB/Network/Cookies`
  are separate SQLite DBs, as are `Login Data` and `Preferences`. Zero root-level `Cookies`.
  Chrome's `Local State` registers both under `profile.info_cache`.
- **The heavy dirs are paid once.** `component_crx_cache`, `Safe Browsing`, `WasmTtsEngine`,
  `OnDeviceHeadSuggestModel`, `ShaderCache` and `OptimizationHints` all landed at `<root>/`,
  siblings of ProfA and ProfB rather than inside either.
- **Real sign-in state is profile-level.** The live jar's only `Cookies` DB is
  `Default/Network/Cookies`.
- **A second launch while the first window is open works**, but hands off to the running
  browser process — one browser process, renderer count 9 → 14 as ProfB's window opened. The
  detached spawn exits immediately, which is harmless.
- **`rmSync` on a live jar fails partially.** Deleting a profile directory whose window was
  open was refused mid-walk (`journal.baj … used by another process`) leaving **349 files** and
  a directory that still looks like a jar. This changed the deletion design.

A profile directory is discriminated from Chrome's own root-level directories by the presence
of a `Preferences` file — verified present in ProfA/ProfB, absent from the component dirs.

## Decisions taken

- **Clean break, not migration.** The one live jar is not carried over. Migrating would mean a
  copy step plus a permanent dual-layout lookup, for a single directory whose irreplaceable
  content is 44 KB. Cost: one re-login.
- **Reclaim covers the new root only.** The clean break makes `~/.coa/browser-profiles/`
  uniformly dead — there is no per-item decision to make there, so there is no list to render.
  It is one directory, removed by hand.
- **No sizes anywhere in the surface.** A plain list of names.
- **The new root is a sibling directory**, so the old root is legacy by construction and the
  two layouts can never be confused.

## Layout

```
~/.coa/browser-session/           coa-owned
  profiles/                       the Chrome --user-data-dir (shared components, paid ONCE)
    <key>/                        one identity's jar (--profile-directory=<key>)
    Safe Browsing/ component_crx_cache/ ...   Chrome's ~30 root dirs, contained in here
  <key>.cmd | .sh                 the courier shim
  <key>.url                       the relayed url

~/.coa/browser-profiles/          LEGACY. Nothing lands here again. Removed by hand.
```

Nesting `profiles/` rather than making `browser-session/` the user-data-dir directly is what
keeps the root inspectable — coa's own shims plus one directory, instead of coa's shims lost
among Chrome's thirty. ADR-0021 valued an inspectable profile root; this preserves it.

## Code

### `packages/core/src/auth/browser-session.ts`

Five pure builders carry the restructure:

- `browserSessionRoot(home)` — new; `<home>/.coa/browser-session`.
- `browserProfileDir(home, key)` — now `<root>/profiles/<key>`.
- `launcherPath(home, key, platform)` / `courierPath(home, key)` — now under `<root>/`,
  outside the user-data-dir.
- `browserArgs(root, key, url)` — takes the root and the key separately, emitting
  `--user-data-dir=<root>/profiles --profile-directory=<key>` plus the disk flags below.

`profileKey` is **unchanged**. Identity keying survives exactly; the key now names a
profile-directory instead of a user-data-dir.

Two removals: `#adoptLegacyProfile` is deleted (adopting a legacy jar would import the old
layout into the new one, which the clean break rejects), and `legacyAccountId` drops off
`launcherFor`'s signature.

`BrowserSessionView` gains `listReclaimable(knownEmails)` and `reclaimProfile(name)`. Both are
launcher-free, so the seam's guarantee — a read surface can never start a browser — holds.

### Disk flags

```
--disable-component-update                   component_crx_cache, WasmTtsEngine, OnDeviceHeadSuggestModel
--disable-features=OptimizationHints,OptimizationGuideModelDownloading    optimization_guide_model_store
--disable-gpu-shader-disk-cache              ShaderCache
```

**Safe Browsing stays on.** It is the second-largest item and also the phishing database
guarding a window where a password is typed; disabling it to save disk is the wrong trade, and
Lever 1 makes it cheap by paying for it once across all identities.

`--disable-component-update` is a known Chromium switch. The `--disable-features` names are a
hypothesis, not a measurement: an unrecognized feature name fails **silently**. The plan must
observe which root directories appear with and against the flag rather than assert the name.

### `packages/core/src/auth/browser-reclaim.ts` (new)

A sibling module, not more weight on `browser-session.ts` (437 lines, whose purpose is
launching a login — enumerating dead jars is a different job). It imports the pure path
builders and `profileKey`, and takes the same injectable fs deps, so it needs no real
filesystem in tests.

Enumeration, one rule: a child of `profiles/` is a jar iff it contains a `Preferences` file,
and it is reclaimable iff its name is not `profileKey(email)` for any account carrying an
email. Dotted entries are skipped.

Every reclaimable name is by construction a `profileKey` output — `slug-digest` — so it is
already readable. There is no label, kind, or grouping: the shape is `string[]`.

Deletion, in order:

1. Rename `<dir>` → `<root>/profiles/.reclaim-<name>-<ts>`. Atomic: whole or nothing, never
   the partial state `rmSync` produced in the spike.
2. Recursive-delete the renamed directory, best effort.
3. Delete `<name>.cmd|.sh` and `<name>.url` — reclaim removes the **triple**, as
   `removeProfile` does.
4. Stale `.reclaim-*` from an earlier failure is swept at the top of every enumeration.

The `.` prefix fails `isSafeProfileKey`, so a trash name can never collide with a real key.

Failure needs no error channel: the verb returns the fresh list and an entry that could not be
moved is **still in it**. The user sees it did not go, closes the browser, and clicks again.

### RPC and view

No new read verb. `AuthView.browserSession` gains `reclaimable: string[]`, arriving on the
`authView` hydrate the settings dialog already performs. Dropping sizes is what makes this
affordable — two `readdir`s and one `existsSync` per child, cheap enough to ride every hydrate.

One write verb, `reclaimBrowserProfiles({ names })`, returning the fresh `AuthView` — the
pattern every other auth write verb follows. It loops `reclaimProfile(name)` over the list, so
one name failing does not abandon the rest.

`removeProfile(email)`, the per-account path behind the removal prompt, is unchanged and keeps
its ADR-0021 shared-jar guard. Reclaim is a second, account-less door to the same directories
and applies that guard by construction: a jar any live account resolves to never enters the
list, so it cannot be offered.

### Surface

A third row in Settings → logins, beside the two browser controls already there
(`IsolatedBrowserRow`, `BrowserPathRow`). Placement follows from AUTH-1: the Auth panel is
organized by account row, and an orphan has no account row to hang off.

- Empty → the row renders `none`, staying visible so the concept is discoverable.
- Populated → `review N` expands an inline list: one name per line, `✕` per line, `remove all N`
  at the bottom. No sizes, dates, or columns.

Under identity keying the only way to mint an orphan is renaming an account's email, so this
list is normally empty — and a non-empty one is genuine information rather than accumulated
debris. Under the old layout, every mismatch-retry leaked a jar.

## ADR-0024

**"Browser profiles share one user-data-dir."** ADR-0021's status flips to
`superseded by 0024`. Nothing is amended in place.

What 0024 supersedes is narrow and says so: **0021's layout only**. Identity keying survives
untouched, as do retry-clears-the-jar and "a shared jar is not one row's to delete."

What it retires: pre-identity jar adoption. 0021's "the six already-orphaned directories are
not reachable by the migration" resolves to "the old root is dead in one piece."

Consequences the record must carry:

- **Cost: one re-login**, and the 1.2 GB leaves by hand, not by code.
- **Cost: one shared browser process.** Each window is still its own jar, but a crash takes all
  open profiled windows with it; under the old layout each jar had its own process.
- **Cost: Safe Browsing deliberately left on**, and why.
- The measured breakdown — 44 KB of sign-in inside 135 MB — is the argument, and belongs in the
  record.

## Testing

Pure and injected-fs, matching how `browser-session.ts` is already tested.

- Path builders: the five new/changed shapes, including shims sitting beside `profiles/`.
- `browserArgs`: root + profile-directory split, each disk flag present.
- Enumeration: `Preferences` discriminates a jar from `component_crx_cache`; a key matching a
  live account is never listed; a jar shared by two accounts is never listed; dotted entries
  skipped.
- Deletion: rename-then-delete order; the whole triple goes; a rename that throws leaves the
  entry still listed; stale `.reclaim-*` swept.
- Desktop: the third Settings row, empty and populated.
- The flag measurement is a **plan step, not a test** — launch with and without, diff which
  root directories appear.

Baseline to hold, none of which this arc should move: 1646 passing; 10 pre-existing
adapter-deepseek/adapter-longcat streaming-body-mock failures; eslint 8 errors + 2 warnings;
depcruise 7 `no-circular`.

## Out of scope

Sizes in the surface. A legacy-directory listing. Non-win32 browser detection. Anything in
`OPEN.md`.

---

_Last reviewed: 2026-07-31_
