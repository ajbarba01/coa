# @coa/console-transcript

The console's streaming conversation renderer: the transcript and everything a turn draws
inside it — markdown and its streaming variant, tool cards, diffs, run-check summaries,
syntax highlighting, find-in-transcript, and the deny notice.

It is a **composite**, not a primitive set, which is why it is not part of
[`@coa/console-kit`](../console-kit). Every kit member carries an intent block, a registry
entry and a showcase specimen; a renderer of this size with a single consumer cannot
satisfy that, and forcing it in would carve a permanent exception into the kit's own rule.
The split says plainly what each package is: the kit is the vocabulary, this is the one
surface built from it.

It depends on the kit (tokens, `cx`, `Icon`, `PaneOverlay`) and never the other way round.

Everything here renders on the kit's sand scale. There is no second palette: the earlier console kit
injected its own tokens at runtime, so two themes could disagree about the same surface and a
component's appearance depended on which shell had mounted it. One scale, resolved at build time,
removes that whole class of drift — and the retired kit is gone.

Its own rule is unchanged by the move: the transcript is **re-skinned, never rebuilt**. It is the
surface a user reads for hours, so its layout and interaction model are treated as settled; a visual
refresh changes tokens, never structure.

---

_Last reviewed: 2026-08-08_
