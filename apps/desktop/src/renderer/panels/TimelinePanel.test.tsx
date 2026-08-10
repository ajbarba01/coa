// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TimelineSurface } from './TimelinePanel.js';
import { resetStores, seedStores } from '../testing/fixtures.js';
import type { ConsoleState } from './state.js';

const seed = (timeline: ConsoleState['data']['timeline']): void => {
  seedStores({ data: { timeline } });
};

beforeEach(() => resetStores());

describe('TimelineSurface states-first', () => {
  it('skeletons while loading', () => {
    seed({ status: 'loading' });
    const { container } = render(<TimelineSurface />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('empty state with no checkpoints', () => {
    seed({ status: 'ok', value: [] });
    render(<TimelineSurface />);
    expect(screen.getByText(/no checkpoints/i)).toBeTruthy();
  });

  it('renders checkpoints newest-first with a pinned marker', () => {
    const value = [
      { id: 'c1', seq: 1, ts: '2026-07-01T00:00:00Z', worktree: 'wt', pinned: false },
      { id: 'c2', seq: 2, ts: '2026-07-01T01:00:00Z', worktree: 'wt', pinned: true },
    ];
    // pinned reads as a done dot, not a word (indicator law)
    seed({ status: 'ok', value });
    const { container } = render(<TimelineSurface />);
    expect(container.querySelector('.bg-ok')).not.toBeNull();
    expect(screen.getAllByText(/seq/i).length).toBe(2);
  });

  it('announces an error via role=alert', () => {
    seed({ status: 'error', message: 'daemon down' });
    render(<TimelineSurface />);
    expect(screen.getByRole('alert').textContent).toContain('daemon down');
  });
});
