# OPEN.md — deferred scope, tuning knobs, and open risks

**Date:** 2026-06-24 · **Status:** one of the three self-contained handoff docs (`SPEC.md` · `IMPL-SPEC-BRIEF.md` ·
`OPEN.md`). It records what is **NOT in v1** (and why / what would promote it), the **tuning knobs** the v0 spike
calibrates, the **open risks**, and the one thing that is **rejected outright**. Nothing here is a v1 build target.

---

## 1. Deferred to v2/v3 (cut from v1 with eyes open)

Each was deferred because its cost is not yet justified for an attended, single-user, local, Claude-locked v1. The
"what would promote it" is the concrete force that re-opens it.

| Deferred                                                                                                                                                                                                                                                                 | Why deferred                                                                                                                                                                                                          | What promotes it                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public, semver'd SPI + conformance kit** (D110)                                                                                                                                                                                                                        | no second backend consumer exists; the vendor ships the hosted-governed-agent shape. The _internal_ D109 capability port is KEPT (so you can swap backends yourself).                                                 | a real second backend consumer arrives                                                                                                                |
| **CQRS + upcaster + in-memory hot-graph** atop the WAL                                                                                                                                                                                                                   | no consumer needs more than the WAL + `git diff`. (The WAL itself is KEPT — it's the memory/time-travel substrate.)                                                                                                   | a multi-writer / autonomous / durability-gap-git-can't-cover force                                                                                    |
| **Hand-curated semantic watches/covers graph + propagation engine**                                                                                                                                                                                                      | AGAINST-MODEL + hand-maintenance tax; the cheap structural index + on-demand confirm gets most of the value at ~0 cost.                                                                                               | the cheap signal demonstrably under-warns AND a richer graph clears a measured A/B                                                                    |
| **Salience-prediction engine** (learned Tier-B classifier)                                                                                                                                                                                                               | the model is already good at attention; a predictor races a native channel. The deterministic Tier-0 reminder is KEPT.                                                                                                | the D143 A/B (already built, off) shows Tier-B nets positive on tokens-per-resolved-flag                                                              |
| **OTel-shaped signal-bus + automated control loops**                                                                                                                                                                                                                     | orphaned machinery; the precision dashboards ride the kept minimal ledger, not a bus.                                                                                                                                 | a real second consumer of the event stream appears                                                                                                    |
| **Always-on Electron push-dashboard**                                                                                                                                                                                                                                    | net-negative as alert-noise. The pull/inspector GUI + `coa raw` are KEPT; push-alerting is opt-in/silent (cap-hit + high-severity only).                                                                              | a measured need for ambient awareness the silent channel can't serve                                                                                  |
| **Heavy two-key TCB ceremony**                                                                                                                                                                                                                                           | over-built for attended v1; downgraded to a **visibility floor** (subtractive governance changes are surfaced/reviewed) + **sandboxing**.                                                                             | coa goes **unattended/autonomous** — then the blocking gate re-arms (its only value over surfaced-to-an-attending-human is the no-human-present case) |
| **Smart/auto constraint-mining (D63 meta-review producer)** — a producer that mines the signal bus, per-rule flag precision, friction artifacts, and eval deltas to **propose** new constraints / rubric Behaviours / edge-prunes (agents propose, a human always gates) | v1 authoring is the preconfigured authoring-agent + validation pipeline; mining is a later convenience.                                                                                                               | usage data shows mining would beat hand/agent authoring on a measured basis                                                                           |
| **GraphRAG-style retrieval** (LLM-built entity graph + community summaries)                                                                                                                                                                                              | non-deterministic (breaks the byte-stable/diffable claim), summary-injection-heavy, heavyweight; coa already has a _true_ code graph for free.                                                                        | a need for whole-repo **global sensemaking** ("themes across the codebase") — and even then, built over coa's _sound_ graph, not an LLM-inferred one  |
| **Prepended prose dossier / generated-doc dump as standing context**                                                                                                                                                                                                     | the evidence shows extra weakly-relevant text _lowers_ agent success.                                                                                                                                                 | never as a prepend; only ever as an on-demand retrieval index                                                                                         |
| **D74 rigor-preset dial** — named presets (prototype / tool / product) that expand into overridable governance axes (active constraint-sets, verification strictness, autonomy leash, approval-gate size)                                                                | a good idea, not integral, cheaply added later. The dial's **floor** — a literal raw pass-through — ships in v1 as `coa raw` (M10); only the preset tiers above the floor are deferred.                               | demand for one-switch rigor profiles once v1's individual dials are in use                                                                            |
| **CL-7 shared contradiction engine** — ONE "contradiction-against-project-truth" engine (semantic half of rationale-grounding G-7 + premise/spec-gaming checks), so those checks share one engine, not three features                                                    | judgment-layer semantic contradiction-detection is heavyweight and AGAINST-MODEL; v1 ships only the **deterministic structural-deletion floor** (ground on deletion of a decision-bound symbol) where capture exists. | rationale capture ships AND a deterministic symbol→decision binding exists to anchor the semantic layer                                               |

**The v2/v3 bets (HARD-FIT, explicitly deferred — build the dormant local write-path in v1 where noted):**
rationale-grounding's _semantic_ half (the contradiction engine; the structural-deletion floor is near-v1);
**cross-repo brain** (the platform-proof moat — one developer, many repos, one private index); the **standing
adversarial / red-team verifier** (the only thing that buys down the GAP-A residual; gates v2 autonomy); **behavior-
baseline anomaly detection** (log now, detect with autonomy); **self-tuning context profiles** (after the ledger
accrues signal); **stub-grounding external symbols** + **headless LSP for user projects** + **per-language doc
generators** (bounded high-fidelity, on demand); **offline/air-gapped mode** (a HIGH-value recommend-now the moment a
non-Claude backend ships behind the M9 port). The **autonomy stack** (D91 escape-gate policy + D92 relaxation + D93
two-tier cap + per-session process isolation) is the v2 prerequisite set; all are tripwire-armed and un-tripped by
v1's attended/single-user/local construction.

---

## 2. Tuning knobs (Tier-2 — the numbers the v0 spike calibrates)

The _mechanisms_ are fixed and sound; these _starting values_ are empirical and self-tune from the minimal ledger.
None gates soundness; all are set conservatively and moved on measured evidence.

- **Confidence-tier cut-points** (the severity × confidence projection): where crit/high/med/low and high/low-confidence
  fall. Default conservative (a flag must clear a high bar to reach crit/high; err toward collapsing to med/low for
  the user and withholding from the agent's budget). Self-tunes on measured per-tier precision.
- **The context-package token cap** (the assembler's hard ceiling): repo- and model-dependent; default leans **low**
  (the evidence says cutting context while improving success is achievable). Binary-searched to budget, net of the
  always-loaded kernel.
- **The F4 staleness confidence threshold** (when a guess is confident enough to surface): conservative default;
  self-tunes on measured staleness precision.
- **The Tier-B A/B promotion threshold** (D143): the net-positive bar (Tier-A+B must beat Tier-A on
  tokens-per-resolved-flag _after_ the classifier's own token cost) — and promotion is double-gated on the A/B **plus**
  a human-approved proposal, never in-session.
- **The constraint promotion/demotion threshold** (D139): the false-positive rate (net of wrong-scope dismissals) above
  which a noisy deterministic constraint is proposed for promotion to a judgment Behaviour / auto-demoted.
- **The flag-validator grouping aggressiveness** (CF-5): group-by-shared-context vs. group-harder; the cost/correctness
  trade the user confirms per run.

---

## 3. Open risks (named honestly)

1. **The [LOOP] value of the context engine is asserted, not loop-measured.** The selection/grounding evidence is
   mostly single-shot; whether a pre-built package + in-flight grounding saves a capable tool-using agent enough
   turns/tokens to matter is the central bet → the v0 spike. _If marginal:_ keep M4 thin; justify on
   soundness/inspectability/discipline (which the spike does not threaten).
2. **The position effect for a tool-using agent is unmeasured.** Edges-first ordering rests on a general-LLM result,
   not a code-agent measurement. Cheap and plausibly right; calibrate in the spike.
3. **Capture-quality is unproven.** Whether agent-harvested rationale and prose-distilled intent are good enough to be
   durable memory is asserted; the spike measures whether captured intent + pre-flight context changes turns-to-done.
4. **The prose-bearing memory secret surface (binding).** Rationale, decision-log
   entries, flag messages, and `/vouch` notes are free text that can carry secrets. They must stay **WAL-local /
   local-only**, **never** enter the sync-eligible ledger (which is allow-listed to numeric counts + anonymized IDs),
   and **never** sync until keychain/encryption clears the secrets tripwire. Bind this before shipping any
   ledger-sync or `~/.coa` sync feature (both are tripwire-armed).
5. **SDK hook per-event parity.** The loop-location map relies on Claude Code hook semantics that were verified on the
   CLI hooks page; the per-event behavior at the SDK layer was asserted via the shared event type, not re-quoted per
   event. **Re-confirm against the live Agent SDK docs at build time** before relying on a specific hook's
   block/inject behavior.
6. **Confidence-tier calibration** (see §2) and **auto-patch friction** (does the agent re-edit against un-patched
   content; how often does a background patch hit the working set) are unmeasured — calibrate in the spike.

---

## 4. Rejected outright (not merely deferred)

- **Unattended self-authoring of constraints from dismissal stats** — re-arms the GAP-A line (an agent writing the
  rules that govern it) and breaks the governance floor even after the visibility-floor downgrade (which was valid
  _because_ v1 is attended). Only a future "propose-a-batch, human-ratifies" form is admissible, and only with
  autonomy + the red-team verifier in place. Fully-unattended self-authoring stays rejected.

---

_These three docs (`SPEC.md` · `IMPL-SPEC-BRIEF.md` · `OPEN.md`) are the complete, self-contained handoff. A
downstream agent should be able to build v1 coa, in the build order above, gated by the v0 spike, from these alone._
