// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineMessage } from './InlineMessage.js';

describe('InlineMessage', () => {
  it('renders its message', () => {
    render(<InlineMessage tone="danger">Failed to load</InlineMessage>);
    expect(screen.getByText('Failed to load')).toBeTruthy();
  });

  it('draws a distinct mark per tone, so tone is never carried by colour alone', () => {
    const marks = new Set<string>();
    for (const tone of ['info', 'success', 'warning', 'danger'] as const) {
      const { container, unmount } = render(<InlineMessage tone={tone}>x</InlineMessage>);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      marks.add(svg?.innerHTML ?? '');
      unmount();
    }
    expect(marks.size).toBe(4);
  });

  it('keeps the mark decorative, since the message beside it is the accessible name', () => {
    const { container } = render(<InlineMessage tone="warning">Unsaved changes</InlineMessage>);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('defaults to the info tone', () => {
    const { container } = render(<InlineMessage>x</InlineMessage>);
    expect(container.firstElementChild?.getAttribute('data-tone')).toBe('info');
  });

  it('rides the current scale, never the retired palette', () => {
    const { container } = render(<InlineMessage tone="warning">x</InlineMessage>);
    const cls = String(container.firstElementChild?.className);
    expect(cls).not.toMatch(/text-(fg|muted|faint)\b|bg-(surface|raised|base|subtle)\b/);
    expect(cls).toContain('text-warn');
  });
});
