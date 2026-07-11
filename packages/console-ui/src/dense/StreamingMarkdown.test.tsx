// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StreamingMarkdown } from './StreamingMarkdown.js';

describe('StreamingMarkdown — output (whole blocks only)', () => {
  it('holds an in-progress paragraph until it completes (no per-word)', () => {
    const { container } = render(<StreamingMarkdown source="hello world" />);
    expect(container.querySelectorAll('span.cx-word').length).toBe(0);
    // nothing is shown until the block completes
    expect(container.querySelector('p')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('reveals a completed paragraph whole with the entrance, holding the next one', () => {
    const { container } = render(<StreamingMarkdown source={'para one\n\npara two'} />);
    // the completed block is parsed to a real <p> inside the entrance wrapper
    expect(container.querySelector('.cx-block-enter p')?.textContent).toBe('para one');
    // the still-forming trailing paragraph is held (not shown) and nothing streams per-word
    expect(container.textContent).toBe('para one');
    expect(container.querySelectorAll('span.cx-word').length).toBe(0);
  });

  it('reveals a completed list block whole (structured markdown arrives as a block)', () => {
    const { container } = render(<StreamingMarkdown source={'- a\n- b\n\nnext'} />);
    expect(container.querySelector('.cx-block-enter li')).not.toBeNull();
    expect(container.textContent).not.toContain('next'); // trailing "next" held
  });

  it('holds an open code fence until it closes (nothing shown while it forms)', () => {
    const { container } = render(<StreamingMarkdown source={'```js\nconst x = 1'} />);
    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelectorAll('span.cx-word').length).toBe(0);
    expect(container.textContent).not.toContain('const x = 1');
  });

  it('reveals a closed fence whole as a formatted code block', () => {
    const { container } = render(<StreamingMarkdown source={'```js\nconst x = 1\n```'} />);
    expect(container.querySelector('.cx-block-enter code')?.textContent).toContain('const x = 1');
  });

  it('keeps the heading padding-top treatment when a heading is its own gapped block (each completed block is rendered as its own Markdown instance, so a heading is always the first-child of that instance)', () => {
    const { container } = render(<StreamingMarkdown source={'# Title\n\npara'} />);
    const h1 = container.querySelector('.cx-block-enter h1');
    expect(h1?.className).toMatch(/pt-2\.5/);
    expect(h1?.className).not.toMatch(/mt-4/);
  });

  it('wraps completed blocks in the same flex-gap column the settled single-instance path uses (the ONE spacing mechanism, shared across both render paths)', () => {
    const { container } = render(<StreamingMarkdown source={'para one\n\npara two'} />);
    const col = container.querySelector(':scope > div');
    expect(col?.className).toMatch(/\bflex\b/);
    expect(col?.className).toMatch(/flex-col/);
    expect(col?.className).toMatch(/gap-2\.5/);
  });
});

describe('StreamingMarkdown — reasoning (perWord)', () => {
  it('types the whole trace out per word', () => {
    const { container } = render(<StreamingMarkdown source="hello world" perWord />);
    expect(container.querySelectorAll('span.cx-word').length).toBe(2);
  });

  it('reuses already-revealed word nodes across frames (stable keys)', () => {
    const { container, rerender } = render(<StreamingMarkdown source="alpha beta" perWord />);
    const first = container.querySelectorAll('span.cx-word')[0];
    rerender(<StreamingMarkdown source="alpha beta gamma" perWord />);
    const after = container.querySelectorAll('span.cx-word');
    expect(after.length).toBe(3);
    // the first word is the SAME DOM node — React reused it, so its one-shot blur is not restarted
    expect(after[0]).toBe(first);
  });

  it('reuses the growing last word node as it gains characters (dominant streaming path)', () => {
    const { container, rerender } = render(<StreamingMarkdown source="hello wor" perWord />);
    const before = container.querySelectorAll('span.cx-word');
    expect(before.length).toBe(2);
    const helloNode = before[0];
    const growingNode = before[1];
    expect(growingNode?.textContent).toBe('wor');
    rerender(<StreamingMarkdown source="hello world" perWord />);
    const after = container.querySelectorAll('span.cx-word');
    expect(after.length).toBe(2);
    // both the settled word AND the growing last word keep their DOM node — the growing word
    // only updates its text content, so its one-shot CSS blur is not restarted mid-word.
    expect(after[0]).toBe(helloNode);
    expect(after[1]).toBe(growingNode);
    expect(after[1]?.textContent).toBe('world');
  });
});
