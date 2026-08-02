# inventio

What the text says: its claims, its facts, and what the surface it lives on
must contain. Every entry gives a check, why the failure reads as
machine-written, and a worked pair. Fix this stage before drafting a
sentence — no amount of wording repairs a claim that shouldn't be there.

## Checks

### Say what happens next

**Check:** Any message describing a failure, a delay, or a pending state
names the reader's next action, or names what the system will do and by when.

**The bound:** an action already on screen. Pointing at a control in view is
Overexplanation, in `elocutio.md`, and the message should stop at the state.
This is about a reader who would otherwise have to go and find out.

**Why:** A state on its own answers a question the reader didn't ask. They
opened the screen because they need the file somewhere, and "upload failed"
gives them the negative without the remedy, so they go hunting in a settings
menu that has nothing to do with the problem.

**Before:** The upload failed.
**After:** The upload failed because the file is over 200 MB, the limit for
browser uploads. Split it, or use the desktop app, which takes files up to
2 GB.

---

### Prefer the specific fact over the abstraction

**Check:** Every noun phrase that could name a real thing does — a count, a
format, a date, a dollar figure, a named field. "Existing tools," "the
process," "your data" are the tell.

**Why:** An abstraction is what a writer reaches for when they haven't
checked the fact. "Exports in the format you need" could mean one file type
or five, and nothing in it is checkable. In interface copy the fix usually
costs nothing, since the count or the name is already sitting in whatever
spec produced the feature.

**Before:** The export supports the formats you need.
**After:** Exports as CSV, PDF, or plain text.

---

### No invented actors, scenes, or interior states

**Check:** Every person in the text is one the source named, doing something
the source recorded. No invented timeframe, no imagined afternoon, no report
of what a reader felt, noticed, or got bored of.

**Why:** This is what a demand for specificity produces once the facts run
out. The writer still owes a concrete noun, so they manufacture texture — a
particular Tuesday, somebody impatient, a person getting bored at the fourth
rerun — and none of it can be checked, because none of it happened. It reads
as a machine performing observation, and it is the one fabrication that
survives review, since nobody asks for a citation on a mood.

Where the fact supply runs out, name the property flatly or cut the clause.
"Renewing by post was tedious" claims something a reader can agree or
disagree with. "You'd hunt for a stamp, forget about it, and find the late
notice three weeks later" invents a person to agree on your behalf.

**Before:** Renewing by post was the only option, and you'd hunt for a stamp,
forget about it, and find the late notice three weeks later.
**After:** Renewing by post was the only option, and it was tedious.

---

### Inflated significance

**Check:** Where a sentence claims consequence — "plays a vital role,"
"stands as a testament," "underscores our commitment" — the consequence is
named and observable.

**Why:** Significance is a claim about consequence, and consequence has to be
observed by someone. A writer with no stake in the subject can't report what
mattered, so they reach for the vocabulary of mattering instead, and the
adjective ends up carrying weight the evidence never supplied.

**Before:** Our notification settings play a vital role in ensuring that
every user stays informed.
**After:** You pick which emails we send. Change it any time in Settings.

---

### Promotional framing

**Check:** Cover the clause after the comma. If the fact still stands, the
tail was telling the reader how to feel about it.

**Why:** The tail tells the reader what to conclude before they've been given
enough to conclude it, and a reader who notices they're being steered stops
trusting the fact in front of the comma too. It also reads as written for
nobody: it would survive being pasted onto any other feature.

**Before:** Our robust export engine delivers a seamless experience for teams
of any size.
**After:** Export runs in the background. We email you the file when it's
ready, usually in under a minute.

---

### Vague attribution

**Check:** Every sourced claim names its source. Studies show. Experts agree.
Many users report.

**Why:** The shape of a citation is far easier to produce than the citation,
and these survive editing because nothing in them can be checked — an unnamed
study can't be wrong. In product copy the house variant is "many users," and
it's the least forgivable, because the writer usually has the number and
picked the vaguer form.

**Before:** Studies show that teams using shared workspaces are significantly
more productive.
**After:** We haven't measured whether anyone works faster. What we can count
is opens: a document in a shared workspace usually gets read by someone other
than the person who wrote it, and a document in a private one usually
doesn't.

---

### Authority tropes

**Check:** Delete the frame — "the real question is," "at its core,"
"fundamentally," "what really matters" — and read what's left. If it's the
same claim, the frame was announcing a depth the sentence never had.

**Why:** Getting underneath a subject requires knowing what's under it, and
the phrase makes the claim to depth in advance, separately from any evidence
that depth was reached. Close kin to Vague attribution: both borrow the
authority of a move without making it, one from an unnamed source and one
from an unearned vantage.

**Before:** At its core, what really matters about round-robin scheduling is
fairness.
**After:** Round-robin means every team plays every other team once, so no
team's standing depends on which opponents it happened to draw.

---

### Hedging stacks

**Check:** One qualifier per claim. "May potentially help to somewhat
improve" is four.

**Why:** Hedging is what gets produced when the fact is missing but the
sentence still has to end, and it survives review since nobody objects to a
claim that isn't quite being made. Calibration is a different thing and worth
keeping: "we haven't measured this" is precise and honest, where "may
potentially help" says the same thing while sounding like a promise.

**Before:** Clearing your cache may potentially help to resolve some issues
that could possibly be affecting page loading.
**After:** If a page loads stale, clear your cache. That fixes it maybe half
the time — we still don't know what the other half have in common.

---

### Negative parallelism

**Check:** A denial stays only if a reader would actually have arrived at the
foil. "It's not a to-do list, it's a system for thinking." Variants: "not
just X, but Y"; "less about X than about Y"; and the stacked form, "Not a X.
Not a Y. A Z." — where each extra negation buys less than the one before it,
since none of them was ever on the table.

**Why:** The construction manufactures contrast without supplying evidence.
The foil is almost always a straw man nobody proposed, and denying it costs
nothing, so the sentence sounds like it drew a distinction when all it
asserted is that the subject is good. Where people do turn up expecting a
to-do list, telling them it isn't one is information.

**Before:** This isn't just a calendar. It's a new way to think about your
week.
**After:** It's a calendar. It hides weekends by default and it can show two
months at once.

---

### False ranges

**Check:** "From X to Y" stays only where X and Y sit on a shared scale and
the span between them is real. Small to large is a range. Onboarding to
analytics is two features with a preposition between them.

**Why:** The construction promises everything between two poles, so it means
something only when the poles define a span. Otherwise the sentence claims a
completeness it never defined, and the slot takes any two nouns from the
subject, which is what makes it cheap to fill.

**Before:** Jumbo handles everything from team creation to real-time scoring.
**After:** Create a team, join with a code, and watch scores update as
matches finish.

---

### Spec leakage

**Check:** Ask whether the reader would have wondered. A design decision
restated to the user, or a denial of something nobody assumed, belongs in the
commit message.

**Why:** Notes about a thing and copy for the people using it sit at the same
distance from a generator, so whatever got argued over hardest during the
build surfaces in the interface, where nobody argued over anything. Denials
cost the reader twice: telling someone the rope won't recentre hands them a
possibility they didn't arrive with, then withdraws it.

**Before:** A wrong answer locks your cards for three seconds, and the rope
never drifts back to centre.
**After:** A wrong answer locks your cards for three seconds.

## What not to flag

- **A significant fact called significant.** The check is whether the
  consequence is named, not whether the sentence sounds enthusiastic.
- **Calibration.** "We haven't measured this," "roughly half," "we don't know
  why" are precise. Only stacked qualifiers are the failure.
- **Copy whose job is to persuade.** A landing page may argue for the
  product. Promotional framing is the evaluative tail that adds nothing, not
  advocacy backed by a fact.
- **A denial the reader needed.** Covered in Negative parallelism, and worth
  repeating: the tell is the foil raised only to be knocked down.

## Signs to preserve

- **Sourced detail.** A real number, a real quote, a date that came from
  somewhere. Generated prose rounds specifics off, so a specific that can be
  traced is worth keeping — and one that can't be traced is the failure
  above, not a sign of life.
- **Unresolved tension.** "This mostly works and it still bothers me and I
  can't say why." Clean takes are cheap; mixed ones cost something to admit.

## Profile

Derived from shipped desktop-application interface copy — VS Code (structured
localization file, the spine), Spotify, Notion, Slack, GitHub Desktop, Docker
Desktop — 2026-07-31, 38,671 strings / ~233,000 words after filtering to English
user-facing text.

- (observed) Addresses the reader directly in only ~5% of strings. Copy names the
  object and its state rather than the person acting on it: "Software updates are
  locked by your organization", not "You cannot update". Second person appears
  where the user's own choice or property is the fact — trust, ownership,
  permission — and almost nowhere else.
- (observed) A string carries one fact. Median sentence is 10 words; the p90 is 24
  and almost all of those are a fact plus its bounded qualifier, not two facts.
- (observed) Qualifiers ride in parentheses rather than a second clause — 7.8
  occurrences per 1000 words, the most common punctuation after the period.
- (observed) Settings descriptions state what the setting *controls*, not what the
  user gains: "Controls whether links should be underlined in the workbench."
  The construction is the object's behaviour, never a benefit.
- (observed) **Nothing in the system is the subject of a verb that requires a
  mind.** Not the application, and not its parts — a tool, a command, a file, a
  write, a limit, a queue. 3 strings in 38,671 (0.01%) put a product name before
  a mental or volitional verb, and all three are either a vendor apology after a
  crash or a mechanical "tries to connect". Software does not want, wait, watch,
  notice, hope, feel, **ask, say, refuse, agree, decide, insist, or promise**.
  Name the condition instead, in the passive if that is what it takes:
  - "coa is watching for the login to land" → "Waiting for the sign-in to complete"
  - "commands still ask" → "commands still need approval"
  - "the cost cap says no" → "the cost cap can block"
  - "writes wait for approval" → "writes are held for approval"

  The trap is that these read as harmless idiom, so they survive a copy pass that
  is looking at capitalization. **Apply this rule to every string you touch, not
  only to the ones a scanner flags** — a detector keyed to one subject list and
  one verb list will miss the next inanimate noun that acquires a verb. This
  **strengthens the baseline check on invented actors and interior states**, which
  is written for invented *people* in reported prose and does not reach an
  anthropomorphized tool.
- (observed) **Copy states the current state, never an unshipped future one.**
  "coming soon" appears 0 times in 38,671 strings; "is planned" / "on the
  roadmap" 0 times. The forward-looking phrasing that does occur is not a
  roadmap — 12 strings use "will be available" as a conditional mechanism ("Once
  debugging, the following commands will be available"), and all 3 uses of "in a
  future release" are deprecation contracts. Meanwhile 383 strings (0.99%, ~32×
  more) state a limit outright: "not supported", "cannot be", "is disabled". A
  limitation is a fact about now. Naming the thing that will lift it dates the
  string, leaks a plan the interface has no power to keep, and hands the reader a
  concept that does not exist yet. State the limit and stop. Adjacent to the
  baseline **spec leakage** check, with a failure mode that check does not have:
  the string silently becomes false when the thing ships or is cancelled, and
  nobody goes back to fix it.
  *Before:* Pinned to sand dark until the light scale lands.
  *After:* Pinned to sand dark.
- (observed) First person is 0.32% of strings and confined to privacy and
  telemetry statements, where the company genuinely is the actor ("the data we
  collect"). An interface does not otherwise say "we".
- (observed) Apology is 0.06%, confined to crash recovery and refusals the
  product is not free to explain. Failure states name the blocking condition and
  stop: "The vendor field cannot be empty."
- (inferred) No string claims significance for itself. Nothing in the corpus
  describes a feature as powerful, seamless, or intelligent. Marked inferred
  because it is an absence, and an absence cannot be counted directly.
