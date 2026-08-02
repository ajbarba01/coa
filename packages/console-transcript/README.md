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

Everything here renders on the kit's sand scale. There is no second palette — the retired
`@coa/console-ui` and its runtime-injected forge tokens are gone; see
[`docs/adr/0025`](../../docs/adr/0025-retire-the-legacy-console-kit.md).

Its own rules are unchanged by the move: the transcript is **re-skinned, never rebuilt**
([`docs/adr/0014`](../../docs/adr/0014-workbench-design-system.md)).

---

_Last reviewed: 2026-08-02_
