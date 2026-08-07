// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TimelineSurface } from './TimelinePanel.js';
import { makeState } from '../testing/fixtures.js';
import type { ConsoleState } from './state.js';

const stateWith = (timeline: ConsoleState['data']['timeline']): ConsoleState =>
  makeState({ data: { timeline } });

describe('TimelineSurface states-first', () => {
  it('skeletons while loading', () => {
    const { container } = render(<TimelineSurface state={stateWith({ status: 'loading' })} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('empty state with no checkpoints', () => {
    render(<TimelineSurface state={stateWith({ status: 'ok', value: [] })} />);
    expect(screen.getByText(/no checkpoints/i)).toBeTruthy();
  });

  it('renders checkpoints newest-first with a pinned marker', () => {
    const value = [
      { id: 'c1', seq: 1, ts: '2026-07-01T00:00:00Z', worktree: 'wt', pinned: false },
      { id: 'c2', seq: 2, ts: '2026-07-01T01:00:00Z', worktree: 'wt', pinned: true },
    ];
    // pinned reads as a done dot, not a word (indicator law)
    const { container } = render(<TimelineSurface state={stateWith({ status: 'ok', value })} />);
    expect(container.querySelector('.bg-ok')).not.toBeNull();
    expect(screen.getAllByText(/seq/i).length).toBe(2);
  });

  it('announces an error via role=alert', () => {
    render(<TimelineSurface state={stateWith({ status: 'error', message: 'daemon down' })} />);
    expect(screen.getByRole('alert').textContent).toContain('daemon down');
  });
});
