# dispositio

What shape the text takes: surface, genre, order, form, length. Every entry
gives a check, why the failure reads as machine-written, and a worked pair.
Settle this before wording anything — a paragraph in the wrong container
can't be fixed a sentence at a time.

## Checks

### Front-load the useful part

**Check:** In interface copy, the first clause of a sentence carries the
information. Apology, hedge, and scene-setting come after, if at all.

**The scope:** copy on a screen — messages, labels, empty states. This rule
does not govern argumentative prose, where a sentence may set a condition
before delivering its claim, and forcing every paragraph into
conclusion-first order flattens the reasoning that made it worth reading.

**Why:** Readers of interface copy are scanning, so whatever sits in the
first few words is what they get if they stop there, and they usually stop
there. "Unfortunately, we were unable to reserve the time you selected"
spends nine words before the reader learns what happened.

**Before:** Unfortunately, we were unable to reserve the time you selected.
Please choose another available time and try again.
**After:** That time's taken. Pick another.

---

### Empty openers

**Check:** Delete the first sentence and read what's left. If nothing was
lost, the second sentence was the opening. In today's fast-paced world. When
it comes to X. It's no secret that.

**Why:** The topic is known before the first sentence is, so what gets
emitted is the most common opening move available, which is a generality
about the world. The habit is invisible from the inside because the sentence
is true.

**Before:** In today's fast-paced digital landscape, finding the right
information quickly is more important than ever. That's why we built search.
**After:** Search covers every document you have access to, including the
ones someone shared with you five minutes ago.

---

### Signposting

**Check:** No sentence announces the next move instead of making it. Let's
dive in. Here's what you need to know. In this section we'll cover.

**Why:** A sentence about the document is not a sentence in it. Signposts get
generated because stating an intention is always available and always safe,
whereas the content has to be true. Headings already do this job, and do it
where someone skimming can see it.

**Before:** Let's break down how scoring works. Here's what you need to know.
**After:** Scores are normalized per player, so a team of three and a team of
six are compared on the same scale.

---

### Fragmented headers

**Check:** Delete the line under the heading. If the section still starts in
the right place, it was throat-clearing.

**Why:** Writing a heading and writing a topic sentence for that heading are
the same act performed twice, and doing both tells the reader the subject
before telling them anything about it.

**Before:**

> ## Scoring
>
> Scoring matters.
>
> Every match awards points to each player, then divides by roster size.

**After:**

> ## Scoring
>
> Every match awards points to each player, then divides by roster size.

---

### Bulleted-list reflex

**Check:** A list stays where its items are genuinely parallel and
independent. Where they're steps in an argument, the bullets delete the
reasoning that connected them.

**Why:** Chat interfaces reward scannable output, and the habit follows the
writer into documents where it doesn't belong. A bulleted list also makes a
claim about its contents — that the items are parallel — and nothing in a
list explains why the second item follows the first.

**Before:**
Why we changed the default sort:

- **Reading behavior:** Attention concentrates at the top of the list.
- **Signal quality:** Creation date is a weak predictor of what you want.
- **Outcome:** The list now sorts by last opened.

**After:** The list now sorts by last opened. Sorting by creation date only
helps on the day you make something, and after that the file you want is
nearly always one you were just inside, so the old default spent every week
pushing the row you were reaching for further down a page you only ever read
the top of. Newest-first is still there in the menu.

---

### Symmetrical closers

**Check:** Compare the last paragraph to the first. If it's the first with
synonyms, delete it.

**Why:** A reader reaches the last paragraph expecting something new, and a
restatement only repeats what they already knew. If the ending can be
assembled from the opening, the middle looks like it added nothing worth
keeping.

**Before:** _Opening:_ "Version history shows you who changed what, and
when." _Closing:_ "Ultimately, version history remains an essential part of
collaborating with confidence."
**After:** _Closing:_ "Versions older than thirty days are deleted. Export
anything you need to keep."

---

### Diff-anchored writing

**Check:** The text reads correctly to someone who never saw the old version.
"This replaces the previous approach." "We've moved away from X."

**The exception:** version-scoped documents want exactly this — changelogs,
release notes, migration guides.

**Why:** It's written from inside the edit, when the change is the most vivid
fact available and the finished state is not. Everyone who reads it
afterwards arrives without that context, and the previous state has a home
already in the commit message.

**Before:** This function was added to replace the previous approach of
scanning every membership row, which was O(n²).
**After:** Membership lookups go through a map keyed by user id, so checking
a roster is O(1).

---

### Decorative formatting

**Check:** Every formatting mark is doing structural work. Emoji in headings,
bold on phrases that aren't terms of art, a header over every two sentences.

**Why:** Format that follows the content tells a skimmer where they are;
format applied for texture tells them nothing and costs them the signal.
Bold used three times in a paragraph marks nothing, because emphasis is
relative and everything emphasized is the same as nothing emphasized.

**Before:** ## 🚀 Getting started — Setup is **fast** and **simple**. Just
add your **API key** and you're **ready to go**.
**After:** ## Getting started — Add your API key. That's the whole setup.

## What not to flag

- **A list of genuinely enumerable things.** Steps, options, keyboard
  shortcuts, supported formats. Reach for a list once the reasoning is
  settled.
- **An orienting line under a heading that adds information.** The failure is
  restatement, not the position.
- **A short opener that is the claim.** Empty openers is about generalities
  standing in for the topic, not about brevity.
- **Version-scoped documents narrating change.** That is their job.

## Signs to preserve

- **Self-interruption.** Genuine asides, parentheticals, corrections made in
  view of the reader.
- **A paragraph that develops rather than lists.** Prose carrying an argument
  is doing something bullets cannot, and converting it to a list is the same
  loss in reverse.

## Profile

Derived from shipped desktop-application interface copy — VS Code (structured
localization file, the spine), Spotify, Notion, Slack, GitHub Desktop, Docker
Desktop — 2026-07-31, 38,671 strings / ~233,000 words after filtering to English
user-facing text.

**The governing distinction is element kind.** Every trait below is conditioned on
whether a string is a *label* (names a control or a state) or *prose* (a sentence
explaining one). The corpus treats these as two different forms, and mixing their
conventions is the single most visible tell.

- (observed) Labels run 1–5 words; median 2, p10 1, p90 5. Ceiling 8. A label
  longer than that is prose wearing a label's position.
- (observed) Prose runs 5–24 words; median 10, p10 5, p90 24. Floor 4, ceiling 30.
- (observed) Labels take no terminal punctuation. Prose takes a period — 96% of
  sentence-form strings end in one, and the residue is questions.
- (observed) A question mark appears only in strings that ask the user to decide.
  Exclamation marks are effectively absent: 0.17 per 1000 words in the spine.
- (observed) Prose is one sentence, or two where the second states the consequence
  of the first: "Never plays the sound." / "Set to `-1` to disable." Three
  sentences in one string is rare enough to treat as a defect.
- (inferred) The pairing is fixed: a label names the thing, and any explanation
  lives in a separate adjacent string rather than being appended to the label.
  Inferred because the corpus is a flat string list and the adjacency is
  reconstructed from key names, not observed in a rendered surface.
