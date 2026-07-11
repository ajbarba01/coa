// packages/console-ui/src/dense/ToolDiffView.test.tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { diffLines } from './toolDiff.js';
import { ToolDiffView } from './ToolDiffView.js';

describe('ToolDiffView', () => {
  it('washes added/removed rows with the diff-tint background and renders each line verbatim (payload only)', () => {
    const { lines } = diffLines('a\nb', 'a\nB');
    const { container } = render(<ToolDiffView lines={lines} language="typescript" />);
    const added = container.querySelector('.bg-diff-add\\/12');
    const removed = container.querySelector('.bg-diff-del\\/12');
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
    expect(container.querySelector('.bg-diff-del\\/12')?.lastElementChild?.textContent).toBe('  x');
    expect(container.querySelector('.bg-diff-add\\/12')?.lastElementChild?.textContent).toBe('\tx');
  });

  it('recedes context rows by opacity while keeping the ink hue intact', () => {
    const { lines } = diffLines('a\nctx\nb', 'A\nctx\nB');
    const { container } = render(<ToolDiffView lines={lines} />);
    const ctx = [...container.querySelectorAll('.opacity-60')].find((n) => n.textContent?.includes('ctx'));
    expect(ctx).toBeTruthy();
  });
});
