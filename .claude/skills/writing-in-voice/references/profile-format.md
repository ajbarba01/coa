# Profile format

A profile describes how a body of writing behaves, so a later draft can match
it without re-reading the corpus. It lives in the `## Profile` section of each
stage file: traits under the stage they govern, plus verbatim exemplars in
`elocutio.md`. Traits alone flatten into a checklist; exemplars alone give
nothing to check for. Neither substitutes for the other.

## Shape

```markdown
## Profile

Derived from <references> — <date>, <word count>.

- (observed) <trait this stage governs>
- (inferred) <trait concluded, not counted>
```

In `elocutio.md` the section also carries exemplars:

```markdown
### Exemplars

> <verbatim passage>

> <verbatim passage>
```

## Rules

**Every trait carries `(observed)` or `(inferred)`.** Observed means the
evidence is nameable on request — a count, a ratio, specific passages.
Inferred means someone concluded it and could be wrong.

**Traits are falsifiable.** State a trait so a piece of writing could
contradict it. "Sentences mostly 8–18 words" can lose to a real paragraph;
"warm but professional" cannot lose to anything. If the honest version is a
vibe, keep it short and mark it inferred rather than dressing it in a number
that backs nothing.

**Countable traits carry a target and bounds.** `8–18 words; floor 5, ceiling
30` gives a draft something that doesn't negotiate. A trait with no number
behind it takes no bounds.

**A trait that contradicts a baseline check says so, and wins.** Write it as
`(observed) uses em dashes ~3 per page — overrides the baseline check`. The
conflict is settled here, once, rather than at every draft.

**Exemplars are verbatim.** Copy character-for-character. Don't fix a typo,
merge two passages, or smooth an awkward sentence. An ellipsis is fine for a
cut mid-passage; whatever isn't cut stays exact. A paraphrase teaches
nothing, and the reason exemplars exist is that some rhythms resist being
described.

**Exemplars are chosen for range.** A long passage and a short one, a warm
one and a plain one. A set that sounds alike teaches one register and hides
the rest.

## Derive

1. Read every reference start to finish. A pattern in the part you skipped
   never gets caught.
2. Count what can be counted: total words, shortest and longest sentence, how
   many openings share a construction, any punctuation the corpus never uses.
   Keep the raw numbers — steps 3 and 6 need them.
3. Turn counts into traits, tagging each as you write it. A trait earns
   `(observed)` only if you can point at the evidence on request; a pattern
   seen twice in a short corpus is an anecdote, so mark it `(inferred)` and
   say why it's thin. Before a trait goes in, try to write a sentence that
   would break it — if nothing comes to mind, narrow it or cut it.
4. File each trait under the stage it governs, and read that stage's
   `## Checks` as you go. Where a trait contradicts a check, keep the trait
   and mark the override.
5. Select exemplars for range, then verify each against the source
   character-for-character. Where references disagree, name the split and
   keep exemplars from both rather than blending them into a middle trait
   neither one supports.
6. Report: total word count, how many traits are observed versus inferred,
   every baseline check now overridden, and anything the corpus was too small
   to support.

## Update

1. Read the existing `## Profile` sections and every new reference in full.
2. Regenerate the traits and exemplars from the union of old and new
   references, applying derive's steps 2 through 5 as if starting over. Don't
   patch bullets in place — a trait that held at the old corpus size can flip
   once new references sit behind it, and patching hides that it flipped.
   Thin new material can still pull a trait from `(observed)` to
   `(inferred)`; let it, and say so in the report.
3. Report: which traits are new, which dropped and why, which exemplars
   changed, which baseline checks changed override status, and where the new
   corpus made an existing trait less certain.
