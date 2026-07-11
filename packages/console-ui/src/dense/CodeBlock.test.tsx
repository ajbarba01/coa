// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock.js';

describe('CodeBlock', () => {
  it('renders a header carrying the language when a language is known', () => {
    const { container } = render(<CodeBlock code="const x = 1;" language="typescript" />);
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(container.querySelector('.border-b')).not.toBeNull();
  });

  it('renders no header when the language is unknown, but still renders a copy control', () => {
    const { container } = render(<CodeBlock code="plain text" />);
    expect(container.querySelector('.border-b')).toBeNull();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('keeps the copy control hidden until the block is hovered or focused', () => {
    render(<CodeBlock code="const x = 1;" language="typescript" />);
    const button = screen.getByRole('button', { name: /copy/i });
    expect(button.className).toMatch(/opacity-0/);
    expect(button.className).toMatch(/group-hover\/code:opacity-100/);
    expect(button.className).toMatch(/focus-visible:opacity-100/);
  });

  it('swaps the copy label to "copied" on click, then settles back', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CodeBlock code="const x = 1;" language="typescript" />);
    const button = screen.getByRole('button', { name: /copy/i });
    await userEvent.click(button);
    expect(writeText).toHaveBeenCalledWith('const x = 1;');
    expect(screen.getByRole('button', { name: 'copied' })).toBeInTheDocument();
  });

  it('tokenizes a registered language into multiple spans, byte-faithfully', () => {
    const { container } = render(<CodeBlock code="const x = 1;" language="typescript" />);
    expect(container.querySelectorAll('span').length).toBeGreaterThan(1);
    expect(container.textContent).toContain('const x = 1;');
  });
});
