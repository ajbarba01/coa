// packages/console-ui/src/dense/syntaxTheme.test.tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodeBlock } from './CodeBlock.js';
import { SyntaxText } from './syntaxTheme.js';

describe('SyntaxText', () => {
  it('tokenizes a registered language into multiple spans, byte-faithfully', () => {
    const { container } = render(<SyntaxText code="const x = 1;" language="typescript" />);
    expect(container.textContent).toBe('const x = 1;'); // D128: verbatim
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
