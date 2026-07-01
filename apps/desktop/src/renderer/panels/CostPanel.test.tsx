// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { costPanel, selectCostVm, type CostVm } from './CostPanel.js';
import type { ConsoleState } from './state.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';

const CostView = costPanel.render;

const stateWith = (cap: ConsoleState['data']['cap']): ConsoleState => ({
  data: {
    cap,
    flags: { status: 'loading' },
    timeline: { status: 'loading' },
    accounts: { status: 'loading' },
    turns: { status: 'loading' },
  },
  ui: { activeMainPanelId: 'cost', settings: DEFAULT_SETTINGS },
  actions: {
    setRoute: () => {},
    refresh: () => {},
    switchAccount: () => {},
    setSettings: () => {},
  },
});

describe('selectCostVm', () => {
  it('passes loading and error through unchanged', () => {
    expect(selectCostVm(stateWith({ status: 'loading' }))).toEqual({ status: 'loading' });
    expect(selectCostVm(stateWith({ status: 'error', message: 'boom' }))).toEqual({
      status: 'error',
      message: 'boom',
    });
  });

  it('maps an ok cap read to a cost view-model', () => {
    const vm = selectCostVm(stateWith({ status: 'ok', value: { remaining: 2.5, capHit: false } }));
    expect(vm.status).toBe('ok');
    if (vm.status === 'ok') expect(vm.vm.headline).toBe('$2.50 left');
  });
});

const host = {
  title: 'Cost',
  setTitle: () => {},
  onVisibilityChange: () => () => {},
  requestFocus: () => {},
};

describe('CostView states-first', () => {
  it('shows skeletons while loading', () => {
    const { container } = render(<CostView vm={{ status: 'loading' }} host={host} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows an alert on error', () => {
    render(<CostView vm={{ status: 'error', message: 'daemon down' }} host={host} />);
    expect(screen.getByRole('alert').textContent).toContain('daemon down');
  });

  it('shows the headline on success', () => {
    const vm: CostVm = {
      status: 'ok',
      vm: { headline: '$2.50 left', sub: 'under cap', tone: 'neutral' },
    };
    render(<CostView vm={vm} host={host} />);
    expect(screen.getByText('$2.50 left')).toBeTruthy();
    expect(screen.getByText('under cap')).toBeTruthy();
  });
});
