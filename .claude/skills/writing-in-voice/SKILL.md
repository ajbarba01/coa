---
name: writing-in-voice
description: Use when writing or rewriting any prose a person will read — interface copy, error messages, emails, marketing text, docs — or when deriving a reusable profile from reference writing. Drafts in three ordered stages against a profile, stripping AI tells instead of defaulting to generic assistant prose.
---

# Writing in voice

Writes and edits prose in three ordered stages, against the baseline this
skill ships with and a profile derived from a body of reference writing.

## Profiles

Each stage file carries a `## Profile` section describing how the target
writing behaves. It ships empty, and `derive` fills it from a corpus.
`references/profile-format.md` defines how a trait is written and holds the
protocols for `derive` and `update`.

Clear the three `## Profile` sections to return the skill to bare baseline.
Copy the skill folder to carry a profile into another project.

A profile trait wins over a baseline check it contradicts. `derive` and
`update` settle that conflict in the file, so a draft never arbitrates.

When the sections are empty, say so and work from the baseline alone. Never
invent a profile to fill the gap.

## The three stages

Dependency order. A stage may read what an earlier stage settled; it may not
revise it.

1. **inventio** — what the text says. Its claims, its facts, and what the
   surface it lives on must contain.
2. **dispositio** — what shape it takes. Surface, genre, order, form, length.
3. **elocutio** — how it is worded.

`references/inventio.md`, `references/dispositio.md` and
`references/elocutio.md` hold each stage's checks, failure modes and profile.
Load the one the current stage needs.

**When elocutio cannot word something without changing what it claims, stop.**
Return the original and flag it. The better sentence being genuinely better is
not a reason.

## Operations

### derive

Build the `## Profile` sections from a body of reference writing, following
the derive protocol in `references/profile-format.md`.

### update

Fold new references into the existing profile, following the update protocol
in `references/profile-format.md`. This rewrites the `## Profile` sections
wholesale — say so before running it, since nothing protects a hand edit.

### draft

Produce text, or rewrite text that already exists, by running the three
stages in order. A rewrite is a draft whose inventio the source settled: hold
what it claims fixed, and start at dispositio.

**Minimum intervention.** Edit the sentences that are defective and leave the
rest. A paragraph with two bad lines gets two edits, not a redraft. Rewriting
*around* a defect damages the lines that were working, and the first
casualties are what each stage file lists under `## Signs to preserve`.

**Delete rather than paraphrase.** When a sentence is doing nothing, cut it.
Replacing it with a flatter sentence that makes the same empty move keeps the
defect and spends more words on it.

Return the draft, plus a one-line note for each change that isn't purely
mechanical — a change of tense or emphasis, not a deleted "just."

### audit

Report what's wrong without touching anything. Name the rule, quote the
span, say why it reads as machine-written.

Load all three stage files: the failure modes cluster across stages, and
reading one stage at a time makes the cluster invisible. Weigh clusters over
isolated hits, and check every finding against that stage's `## What not to
flag` — an audit gets acted on, so a false positive costs a human sentence.

## Never rewrite exhibited text

A watched phrase inside a quotation, a title, a proper name, or an example
where the phrase is the subject rather than the prose stays exactly as it is.
This holds at every stage and in every operation.

## Project rules

Point of view for a given surface, and what a domain will or won't claim
about itself, belong to the calling project's docs. Read them when a task
supplies them, and restate them nowhere.

---

_Last reviewed: 2026-07-30_
