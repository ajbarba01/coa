// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SyntaxHighlighterModule from 'react-syntax-highlighter';
import { CodeBlock } from './CodeBlock.js';

/** Records the language the highlighter is handed, while still rendering it for real so
 *  every other assertion here keeps exercising true tokenization. */
const handedLanguage = vi.fn<(language: unknown) => void>();
vi.mock('react-syntax-highlighter', async (importOriginal) => {
  const actual = await importOriginal<typeof SyntaxHighlighterModule>();
  const Real = actual.Light;
  const Spy = (props: Record<string, unknown>): React.JSX.Element => {
    handedLanguage(props['language']);
    return <Real {...props} />;
  };
  // syntaxTheme.tsx registers grammars off this static at module load.
  Spy.registerLanguage = Real.registerLanguage.bind(Real);
  return { ...actual, Light: Spy };
});

beforeEach(() => {
  handedLanguage.mockClear();
});

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

  it('resolves the fence tag to a registered grammar before highlighting', () => {
    // A tag the highlighter has no grammar for is not read as "leave it alone" — it is
    // read as "work out which", scoring the code against every grammar. `ts` is the
    // commonest fence there is, so forwarding it as written meant guessing at TypeScript.
    render(<CodeBlock code="const x = 1;" language="ts" />);
    expect(handedLanguage).toHaveBeenCalledWith('typescript');
  });

  it('shows the tag the author wrote, not the grammar id it resolved to', () => {
    render(<CodeBlock code="const x = 1;" language="ts" />);
    expect(screen.getByText('ts')).toBeInTheDocument();
    expect(screen.queryByText('typescript')).toBeNull();
  });

  it('hands the highlighter nothing for a tag no grammar answers to', () => {
    // Still headed with the author's tag — we just decline to claim we can highlight it.
    render(<CodeBlock code="graph TD" language="mermaid" />);
    expect(handedLanguage).toHaveBeenCalledWith(undefined);
    expect(screen.getByText('mermaid')).toBeInTheDocument();
  });
});
