// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { timelinePanel } from './TimelinePanel.js';

const TimelineView = timelinePanel.render;
const host = {
  title: 'Timeline',
  setTitle: () => {},
  onVisibilityChange: () => () => {},
  requestFocus: () => {},
};

describe('TimelineView states-first', () => {
  it('skeletons while loading', () => {
    const { container } = render(<TimelineView vm={{ status: 'loading' }} host={host} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('empty state with no checkpoints', () => {
    render(<TimelineView vm={{ status: 'ok', value: [] }} host={host} />);
    expect(screen.getByText(/no checkpoints/i)).toBeTruthy();
  });

  it('renders checkpoints newest-first with a pinned marker', () => {
    const value = [
      { id: 'c1', seq: 1, ts: '2026-07-01T00:00:00Z', worktree: 'wt', pinned: false },
      { id: 'c2', seq: 2, ts: '2026-07-01T01:00:00Z', worktree: 'wt', pinned: true },
    ];
    render(<TimelineView vm={{ status: 'ok', value }} host={host} />);
    expect(screen.getByText(/pinned/i)).toBeTruthy();
    expect(screen.getAllByText(/seq/i).length).toBe(2);
  });
});
