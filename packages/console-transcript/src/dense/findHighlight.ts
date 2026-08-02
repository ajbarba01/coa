/** Term-level find highlighting via the CSS Custom Highlight API (Chromium-
 *  native, so always present in the Electron console; absent in jsdom, where
 *  painting is skipped). Highlights touch NO DOM — React's rendered markdown
 *  stays untouched — the ranges paint through `::highlight(coa-find)` /
 *  `::highlight(coa-find-active)` rules in the app's stylesheet. */

const ALL = 'coa-find';
const ACTIVE = 'coa-find-active';

/** Every Range under `root` whose text matches `query` (case-insensitive),
 *  split into the active row's occurrences vs the rest. Pure DOM walk —
 *  exported for tests (Range works in jsdom; only the painting doesn't). */
export function collectHighlightRanges(
  root: Node,
  query: string,
  activeRow: Element | null,
): { all: Range[]; active: Range[] } {
  const all: Range[] = [];
  const active: Range[] = [];
  const q = query.toLowerCase();
  if (q === '') return { all, active };
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.toLowerCase() ?? '';
    for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + q.length)) {
      const range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + q.length);
      if (activeRow !== null && activeRow.contains(node)) active.push(range);
      else all.push(range);
    }
  }
  return { all, active };
}

/** Registers the current query's ranges with the highlight registry. */
export function paintFindHighlights(root: Node, query: string, activeRow: Element | null): void {
  if (typeof CSS === 'undefined' || CSS.highlights === undefined) return;
  const { all, active } = collectHighlightRanges(root, query, activeRow);
  CSS.highlights.set(ALL, new Highlight(...all));
  CSS.highlights.set(ACTIVE, new Highlight(...active));
}

export function clearFindHighlights(): void {
  if (typeof CSS === 'undefined' || CSS.highlights === undefined) return;
  CSS.highlights.delete(ALL);
  CSS.highlights.delete(ACTIVE);
}
