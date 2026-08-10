// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown.js';

describe('Markdown', () => {
  it('renders inline code and links as kit elements', () => {
    render(<Markdown source={'Use `spine.emit()` per [the docs](https://x.test).'} />);
    const code = screen.getByText('spine.emit()');
    expect(code.tagName).toBe('CODE');
    expect(code.className).toMatch(/bg-s3/);
    expect(code.className).toMatch(/text-code/);
    expect(code.className).toMatch(/text-s11/);
    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link).toHaveAttribute('href', 'https://x.test');
    expect(link.className).toMatch(/underline/);
    expect(link.className).toMatch(/decoration-s6/);
  });
  it('renders a fenced code block byte-faithfully with a copy button', () => {
    const src = '```ts\nconst a = 1;\n```';
    // The highlighter tokenizes code into sibling <span>s, so getByText (which
    // only matches a single node's direct text) can't see the reassembled line.
    // textContent concatenates all descendant text, verifying the bytes render
    // intact and unmutated.
    const { container } = render(<Markdown source={src} />);
    expect(container.textContent).toContain('const a = 1;');
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });
  it('renders GFM task lists', () => {
    render(<Markdown source={'- [x] done\n- [ ] todo'} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[0]).toBeChecked();
    expect((boxes[0] as HTMLElement).className).toMatch(/border-s8/);
    expect((boxes[0] as HTMLElement).className).toMatch(/bg-s8/);
    expect((boxes[1] as HTMLElement).className).toMatch(/border-s5/);
  });
  it('wraps fenced code in a horizontally scrollable block', () => {
    render(<Markdown source={'```ts\nconst x = 1;\n```'} />);
    const pre = document.querySelector('pre');
    expect(pre?.parentElement?.className).toContain('overflow-x-auto');
  });
  it('renders a GFM table with bordered header and cells', () => {
    const src = '| A | B |\n| - | - |\n| 1 | 2 |';
    const { container } = render(<Markdown source={src} />);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelector('th')?.className).toMatch(/border/);
  });
  it('styles headings and blockquotes with sand tokens', () => {
    const { container } = render(<Markdown source={'# Title\n\n> quote'} />);
    const h1 = container.querySelector('h1');
    expect(h1?.className).toMatch(/font-semibold/);
    expect(h1?.className).toMatch(/text-s12/);
    const quote = container.querySelector('blockquote');
    expect(quote?.className).toMatch(/border-l-2/);
    expect(quote?.className).toMatch(/border-s5/);
    expect(quote?.className).toMatch(/text-s10/);
  });
  it("carries heading emphasis as padding-top (not margin-top), matching the proto — padding survives the streaming path's per-block gap container", () => {
    const { container: c1 } = render(<Markdown source={'# H1'} />);
    expect(c1.querySelector('h1')?.className).toMatch(/pt-2\.5/);
    expect(c1.querySelector('h1')?.className).not.toMatch(/mt-4/);
    const { container: c2 } = render(<Markdown source={'## H2'} />);
    expect(c2.querySelector('h2')?.className).toMatch(/\bpt-2\b/);
    expect(c2.querySelector('h2')?.className).not.toMatch(/mt-3/);
    const { container: c3 } = render(<Markdown source={'### H3'} />);
    expect(c3.querySelector('h3')?.className).toMatch(/pt-1\.5/);
    expect(c3.querySelector('h3')?.className).not.toMatch(/mt-2\.5/);
  });
  it("uses ONE spacing mechanism — the root flex gap — so a heading's padding-top is strictly additive on top of what every other block gets, not competing with per-block margins (round-2 fix: round-1 inverted this in the settled single-instance path, where headings carried only padding while paragraphs still carried mt-2.5)", () => {
    const { container } = render(
      <Markdown
        source={'intro paragraph\n\n## Section\n\nbody paragraph\n\n- a\n- b\n\n> quoted'}
      />,
    );
    // the root container is the ONLY source of inter-block rhythm
    const root = container.firstElementChild;
    expect(root?.className).toMatch(/\bflex\b/);
    expect(root?.className).toMatch(/flex-col/);
    expect(root?.className).toMatch(/gap-2\.5/);

    const h2 = container.querySelector('h2');
    expect(h2?.className).toMatch(/\bpt-2\b/);

    // no top-level block competes with the gap by carrying its own vertical margin —
    // matched as a whole class token so a descendant-selector utility like
    // `[&_ul]:mt-1` (nested-list-only, unrelated to this block's own top-level spacing)
    // doesn't false-positive.
    for (const el of container.querySelectorAll('p, h1, h2, h3, ul, ol, blockquote')) {
      const tokens = (el.className || '').split(/\s+/);
      expect(tokens.some((t) => /^m[tby]-\d/.test(t))).toBe(false);
    }
  });
  it('applies the nested-list treatment to a 2-level nested list', () => {
    const { container } = render(<Markdown source={'- a\n  - b\n- c'} />);
    const outer = container.querySelector('ul');
    expect(outer).not.toBeNull();
    // the nested list is a descendant of the outer list's own <li>, not a sibling
    const nested = outer?.querySelector(':scope > li > ul');
    expect(nested).not.toBeNull();
    expect(nested?.querySelector('li')?.textContent).toBe('b');
    // the descendant-selector utilities that carry the nested treatment (stepped-down
    // marker weight + circle marker on nested <li>s) live on every <ul>'s own class
    // list — verify they're present so the nested-only cascade has something to key off.
    expect(outer?.className).toMatch(/\[&_ul\]:mt-1/);
    expect(outer?.className).toMatch(/\[&_ul\]:marker:text-s6/);
    expect(outer?.className).toMatch(/\[&_ul_li\]:list-\[circle\]/);
  });
  it('applies the sand paragraph and list treatment', () => {
    const { container } = render(<Markdown source={'para\n\n- a\n- b'} />);
    expect(container.querySelector('p')?.className).toMatch(/text-s11/);
    expect(container.querySelector('ul')?.className).toMatch(/pl-5/);
  });
  it('carries no first-child/last-child margin reset — blocks have no margin of their own to reset, spacing is entirely the root flex gap', () => {
    const { container } = render(<Markdown source={'# H\n\ntext'} />);
    expect(container.firstElementChild?.className).not.toMatch(/first-child/);
    expect(container.firstElementChild?.className).not.toMatch(/last-child/);
    expect(container.firstElementChild?.className).toMatch(/gap-2\.5/);
  });
});

describe('Markdown appearance', () => {
  it('renders in the s10 ink when muted, and s11 otherwise', () => {
    const { container: m } = render(<Markdown source="hi" muted />);
    expect(m.firstElementChild?.className).toMatch(/text-s10/);
    expect(m.firstElementChild?.className).not.toMatch(/text-s11/);
    const { container: d } = render(<Markdown source="hi" />);
    expect(d.firstElementChild?.className).toMatch(/text-s11/);
  });

  // Markdown is now the settled-only renderer (no `streaming` prop) — the live per-word
  // reveal lives entirely in StreamingMarkdown (see Markdown.tsx / StreamingMarkdown.tsx).
  it('renders plain markdown with no reveal spans', () => {
    const { container } = render(<Markdown source="hello world" />);
    expect(container.querySelectorAll('span.cx-tok').length).toBe(0);
    expect(container.textContent).toContain('hello world');
  });
});
