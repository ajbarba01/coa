// packages/console-ui/src/dense/ToolDiffView.test.tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { diffLines } from './toolDiff.js';
import { ToolDiffView } from './ToolDiffView.js';

describe('ToolDiffView', () => {
  it('tints added/removed rows and renders each line verbatim (payload only)', () => {
    const { lines } = diffLines('a\nb', 'a\nB');
    const { container } = render(<ToolDiffView lines={lines} language="typescript" />);
    const added = container.querySelector('.bg-success-tint');
    const removed = container.querySelector('.bg-danger-tint');
    // The payload span is the row's last child (after the gutter-marker span).
    expect(added?.lastElementChild?.textContent).toBe('B');
    expect(removed?.lastElementChild?.textContent).toBe('b');
  });

  it('keeps the gutter marker as a separate aria-hidden span (D128: not fused into text)', () => {
    const { lines } = diffLines('x', 'y');
    const { container } = render(<ToolDiffView lines={lines} />);
    const marker = container.querySelector('[aria-hidden="true"]');
    expect(marker?.textContent).toMatch(/^[+\-\s]\s$/);
  });

  it('preserves leading whitespace in diff lines verbatim', () => {
    const { lines } = diffLines('  x', '\tx');
    const { container } = render(<ToolDiffView lines={lines} language="typescript" />);
    expect(container.querySelector('.bg-danger-tint')?.lastElementChild?.textContent).toBe('  x');
    expect(container.querySelector('.bg-success-tint')?.lastElementChild?.textContent).toBe('\tx');
  });
});
