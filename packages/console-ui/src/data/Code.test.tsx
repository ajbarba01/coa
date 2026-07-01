// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Code } from './Code.js';

describe('Code', () => {
  it('renders inline code verbatim', () => {
    render(<Code>M1.emit()</Code>);
    expect(screen.getByText('M1.emit()')).toBeInTheDocument();
  });
  it('preserves whitespace byte-faithfully in block mode', () => {
    const src = '  line1\n    line2';
    const { container } = render(<Code block>{src}</Code>);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(src);
  });
});
