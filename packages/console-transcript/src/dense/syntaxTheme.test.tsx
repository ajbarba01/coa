// packages/console-ui/src/dense/syntaxTheme.test.tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodeBlock } from './CodeBlock.js';
import { HLJS_TOKEN_STYLE, SyntaxText } from './syntaxTheme.js';

describe('SyntaxText', () => {
  it('tokenizes a registered language into multiple spans, byte-faithfully', () => {
    const { container } = render(<SyntaxText code="const x = 1;" language="typescript" />);
    expect(container.textContent).toBe('const x = 1;'); // byte-faithful: verbatim
    expect(container.querySelectorAll('span').length).toBeGreaterThan(1); // real highlighting
  });

  it('renders plain (no tokenization) without a language, still byte-faithful', () => {
    const { container } = render(<SyntaxText code="const x = 1;" />);
    expect(container.textContent).toBe('const x = 1;');
  });

  it('preserves leading whitespace verbatim', () => {
    const { container } = render(<SyntaxText code={'    indented();'} language="typescript" />);
    expect(container.textContent).toBe('    indented();');
  });
});

describe('CodeBlock (registration guard)', () => {
  it('now tokenizes a registered language into multiple spans', () => {
    const { container } = render(<CodeBlock code="const x = 1;" language="typescript" />);
    expect(container.querySelectorAll('span').length).toBeGreaterThan(1);
    expect(container.textContent).toContain('const x = 1;');
  });
});

describe('HLJS_TOKEN_STYLE', () => {
  it('maps token colors to sand syntax palette', () => {
    expect(HLJS_TOKEN_STYLE['hljs-keyword']?.color).toBe('var(--color-syn-key)');
    expect(HLJS_TOKEN_STYLE['hljs-string']?.color).toBe('var(--color-syn-str)');
    expect(HLJS_TOKEN_STYLE['hljs-number']?.color).toBe('var(--color-syn-num)');
    expect(HLJS_TOKEN_STYLE['hljs-literal']?.color).toBe('var(--color-syn-num)');
    expect(HLJS_TOKEN_STYLE['hljs-built_in']?.color).toBe('var(--color-syn-type)');
    expect(HLJS_TOKEN_STYLE['hljs-type']?.color).toBe('var(--color-syn-type)');
    expect(HLJS_TOKEN_STYLE['hljs-title']?.color).toBe('var(--color-syn-fn)');
    expect(HLJS_TOKEN_STYLE['hljs-function']?.color).toBe('var(--color-syn-fn)');
    expect(HLJS_TOKEN_STYLE['hljs-comment']?.color).toBe('var(--color-syn-comment)');
    expect(HLJS_TOKEN_STYLE['hljs-comment']?.fontStyle).toBe('italic');
    expect(HLJS_TOKEN_STYLE['hljs-punctuation']?.color).toBe('var(--color-syn-punct)');
    expect(HLJS_TOKEN_STYLE['hljs-operator']?.color).toBe('var(--color-syn-punct)');
    expect(HLJS_TOKEN_STYLE['hljs']?.color).toBe('var(--color-s11)');
  });
});
