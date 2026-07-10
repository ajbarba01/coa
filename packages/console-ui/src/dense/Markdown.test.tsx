// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown.js';

describe('Markdown', () => {
  it('renders inline code and links as kit elements', () => {
    render(<Markdown source={'Use `M1.emit()` per [the docs](https://x.test).'} />);
    expect(screen.getByText('M1.emit()').tagName).toBe('CODE');
    expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute('href', 'https://x.test');
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
  it('styles headings and blockquotes with tokens', () => {
    const { container } = render(<Markdown source={'# Title\n\n> quote'} />);
    expect(container.querySelector('h1')?.className).toMatch(/text-/);
    expect(container.querySelector('blockquote')?.className).toMatch(/border-l/);
  });
  it('applies github-standard block spacing to paragraphs and lists', () => {
    const { container } = render(<Markdown source={'para\n\n- a\n- b'} />);
    expect(container.querySelector('p')?.className).toMatch(/mb-4/);
    expect(container.querySelector('ul')?.className).toMatch(/pl-8/);
  });
  it('strips the top margin from the first block', () => {
    const { container } = render(<Markdown source={'# H\n\ntext'} />);
    // the Markdown container carries the first-child margin reset
    expect(container.firstElementChild?.className).toMatch(/first/);
  });
});

describe('Markdown appearance', () => {
  it('renders in the muted color when muted, and the primary fg otherwise', () => {
    const { container: m } = render(<Markdown source="hi" muted />);
    expect(m.firstElementChild?.className).toMatch(/text-muted/);
    expect(m.firstElementChild?.className).not.toMatch(/text-fg/);
    const { container: d } = render(<Markdown source="hi" />);
    expect(d.firstElementChild?.className).toMatch(/text-fg/);
  });

  // Markdown is now the settled-only renderer (no `streaming` prop) — the live per-word
  // reveal lives entirely in StreamingMarkdown (see Markdown.tsx / StreamingMarkdown.tsx).
  it('renders plain markdown with no reveal spans', () => {
    const { container } = render(<Markdown source="hello world" />);
    expect(container.querySelectorAll('span.cx-tok').length).toBe(0);
    expect(container.textContent).toContain('hello world');
  });
});
