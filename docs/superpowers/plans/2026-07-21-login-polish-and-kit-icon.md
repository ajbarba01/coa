# Login-dialog polish + kit Icon — Implementation Plan

Closes deviations **D1, D2, D5, D7** from the 2026-07-21 attended run (recorded in
`2026-07-18-in-app-login-email-accounts.md`). **D3 and D4 are NOT in this batch** — D3 is
spike-gated, D4 is independent.

Designed through the **impeccable** skill (product register) per `docs/UI.md` authoring rules.
Authority order when they disagree: `docs/UI.md` + ADR-0014 win over the skill's general rules.

## Global constraints

- TS strict, no `any`, `exactOptionalPropertyTypes` — rebuild optional fields by omission.
- **No raw values** (UI.md): color/space/radius/duration/z come from tokens. The icon pixel size is
  the one judgment call — see Task 3.
- **Every state ships**: default · hover · focus-visible · active · disabled · loading · empty · error.
- Kit members need a lint-enforced **intent block** (Intent / Use-it-when / Don't-use-it-when /
  Anatomy / Variants & States / Accessibility / Related) and a **showcase entry** — the showcase is
  the living spec.
- Subject-only Conventional Commits, stage by name, TDD for behavior.
- **Rebuild + daemon restart** before any live verification (`dist` is what the daemon loads —
  this cost two false "it's fixed" claims already this session).

---

## Task 1 — D1: the sign-in affordance matches its sibling

**Drift (root cause: one-off implementation, not a missing token).** `AuthPanel.tsx` renders the
same conceptual action — "add a credential to this provider" — with two different weights in the two
branches of ONE ternary: `SignInButton` uses `variant="quiet"` with the copy `sign in with {label}`,
while the sibling uses `variant="text"` with `+ add {noun}`. The shared pattern already existed and
was not used.

**Fix.** `SignInButton` → `variant="text"`, copy `sign in`. The provider name is already the row's
context, so `with {label}` is redundant.

**Open micro-decision (flag, don't guess):** the sibling carries a leading `+`. `+ sign in` preserves
the "this adds something" marker but reads awkwardly; bare `sign in` is what the maintainer asked
for. **Ship bare `sign in`**, and if the asymmetry reads wrong in situ, the cheaper fix is dropping
the sibling's `+` rather than adding one here.

**Verify:** both branches render at the same visual weight; `AuthPanel` tests still green.

---

## Task 2 — D2: dialog copy rewrite

**The defect is voice, not wording.** The dialog re-asserts credential-blindness at four separate
phases (`EmailStep` body, `launching`, `registered`, plus the `awaiting` sub-copy).
Credential-blindness is an architecture property; the user does not need to be told it repeatedly,
and repeating it reads as reassurance-seeking.

**Rules for the pass** (these become the seed of the future coa-app-text skill — maintainer wants
the skill written FROM this result, not before it):

1. **State, don't sell.** Label what is happening. No value propositions.
2. **Say a fact once.** Credential-blindness gets at most ONE mention, at the moment it is
   load-bearing (registration), not at every phase.
3. **No em-dash editorializing.** The current copy uses `—` to append a reassurance to almost every
   sentence. Cut the clause, not just the dash.
4. **Second person for user actions, no anthropomorphized coa.** "coa is watching for the login to
   land" → describe the state, not coa's feelings about it.
5. **Sentence case, terminal punctuation only on full sentences** — matches the existing surface;
   the forthcoming capitalization pass will formalize this and may revise.

**Per-phase target** (bodies only; headings mostly hold):

| phase | current problem | direction |
| --- | --- | --- |
| `EmailStep` | two-sentence pitch incl. the token claim | one line naming what the email is for |
| `launching` | repeats prefill + token claim | one line: the CLI is starting |
| `awaiting` | repeats prefill, "come back", "watching" | what YOU do now, one line |
| `watching` | anthropomorphized, backtick-quotes a command | plain status |
| `mismatch` | good — it states a real fork | keep, tighten |
| `registered` | repeats the pointer/token claim | the one sanctioned credential-blindness mention |
| `failed` | good — states blast radius + recovery | keep |

**Explicitly out of scope:** the `EmailStep` promise-sentence about the browser opening pre-filled.
That sentence's truth value is what **D3's spike decides** — leave it until the spike lands
(maintainer-confirmed). Polish the step's shape and layout, not that claim.

**Verify:** `LoginFlow.test.tsx` assertions that match on copy will need updating — check each is
asserting *behavior* (phase reached) rather than *prose*, and fix any that are prose-coupled, since
prose-coupled tests are why copy passes get skipped.

---

## Task 3 — D7: graduate `Icon` into `console-kit`

**Decision: take `lucide-react` as a dependency.** Reversal of an earlier recommendation to
hand-roll, on two findings:

1. **The existing inline SVGs already ARE lucide geometry** — the `Composer.tsx` attach paperclip
   and mic are lucide/feather paths, hand-copied with no version and no attribution. The choice is
   not "adopt lucide or not"; it is "adopt it honestly or keep copy-pasting its art."
2. **"Keep the kit dependency-free" was never this repo's standard** — `console-kit` already depends
   on `@base-ui/react`, deliberately, per ADR-0014 (mechanics ride Base UI). Icons are the same
   trade, and constitution **P8 (compose, don't reinvent)** points the same way.

Bundle cost is tree-shaken and this is Electron, not a landing page. A wrapper is needed either way
to pin house defaults, so that is not a point against.

**Build.** `packages/console-kit/src/icon/Icon.tsx` wrapping lucide, pinning the house convention
observed in `Composer.tsx`: 14px, `strokeWidth={2}`, round caps/joins, `aria-hidden` unless given an
accessible name, `currentColor` inherited (never a color prop — color comes from the parent's token).

**The raw-px question (flag, decide in review).** UI.md bans raw values. Icon size is currently the
literal `14` in two places. Options: (a) a `--icon-size` token in the scale, (b) size variants keyed
to the type scale, (c) sanctioned literal with a comment, as the title-bar px precedent allows.
**Recommend (b)** — icons sit next to text and should track the type scale, which makes density (a
token axis per UI.md) work correctly for free. Do not ship a bare `14`.

**Seed set:** `copy`, `check` (D5/D7 need these). Do NOT bulk-add glyphs.

**Migration proves the wrapper:** replace the two `Composer.tsx` inlines with `<Icon>`. This DELETES
hand-copied art rather than adding a third copy — if the wrapper cannot express those two, it is
wrong and should be reworked before going further.

**Ships with:** intent block, all states, jsdom tests, showcase entry.

---

## Task 4 — D7 cont. + D5: `CopyLink` and the code field

**D7 applied.** `CopyLink`'s `copy link` / `copied ✓` text Button → `Icon`-bearing affordance.
Keep the copied-state feedback (it is real state feedback, not decoration); the `✓` becomes
`<Icon name="check">`. Preserve the existing 1600ms revert.

**D5 — reveal the code field on the CLI's own signal, not a click.** Today a disclosure button
("prompted for a code instead? enter it →") gates the field. Better than always-showing it: the CLI
prints its own paste prompt and **the driver already reads that stream** — reveal the field when the
CLI actually asks.

- Detect the prompt in the driver's data stream (sibling to `extractOauthUrl`; pure + unit-tested).
- Surface it on `LoginSnapshot` as a flag; the renderer reveals the field when set.
- **Degraded path:** when the prompt cannot be observed, fall back to **always-visible**, never a
  button. A click in front of a field is the thing being removed.

**Sequencing caveat:** this path is entangled with the corrected D6 finding — `write()` into a pipe
likely does NOT drive the CLI's interactive prompt, so the code-paste fallback may never have worked
on the pipe branch. **Verify the fallback works at all** (now that the PTY branch actually runs)
before designing its reveal. If it is broken, that is a functional bug and outranks this cosmetic
one.

---

## Task 5 — docs + close-out

ADR check: none of D1/D2/D5/D7 changes a decision — no new ADR (D3 is the one that will need an
ADR-0017 amendment, and it is not in this batch). Update ROADMAP only if W4's scope shifts.
`pnpm docs:check`, full-repo vitest against the documented 10-failure baseline, repo typecheck,
eslint, dependency-cruiser (5 pre-existing no-circular violations are NOT ours).

---

## Order

**3 → 4 → 1 → 2.** Icon first because Task 4 consumes it; D5's functional question (does code-paste
work at all?) surfaces early enough to re-scope; copy last so prose is written against the final
shape rather than rewritten twice.
