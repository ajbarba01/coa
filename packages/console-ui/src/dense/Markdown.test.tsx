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
});
