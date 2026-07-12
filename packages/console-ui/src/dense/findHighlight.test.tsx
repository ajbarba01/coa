// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { collectHighlightRanges } from './findHighlight.js';

function host(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('collectHighlightRanges', () => {
  it('finds every occurrence across nested rendered markup', () => {
    const root = host('<p>Hello <strong>World</strong></p><p>say hello again</p>');
    const { all } = collectHighlightRanges(root, 'hello', null);
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.toString().toLowerCase())).toEqual(['hello', 'hello']);
  });

  it('splits the active row’s occurrences from the rest', () => {
    const root = host(
      '<div data-row-index="0">hello there</div><div data-row-index="1">hello again</div>',
    );
    const activeRow = root.querySelector('[data-row-index="1"]');
    const { all, active } = collectHighlightRanges(root, 'hello', activeRow);
    expect(all).toHaveLength(1);
    expect(active).toHaveLength(1);
    expect(active[0]?.toString()).toBe('hello');
  });

  it('matches occurrences that a single text node contains twice', () => {
    const root = host('<p>hello hello</p>');
    const { all } = collectHighlightRanges(root, 'hello', null);
    expect(all).toHaveLength(2);
  });
});
