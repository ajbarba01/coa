// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CostSurface, selectCostVm } from './CostPanel.js';
import { makeState } from './fixtures.js';
import type { ConsoleState } from './state.js';

const stateWith = (cap: ConsoleState['data']['cap']): ConsoleState => makeState({ data: { cap } });

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

describe('CostSurface states-first', () => {
  it('shows skeletons while loading', () => {
    const { container } = render(<CostSurface state={stateWith({ status: 'loading' })} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows an alert on error', () => {
    render(<CostSurface state={stateWith({ status: 'error', message: 'daemon down' })} />);
    expect(screen.getByRole('alert').textContent).toContain('daemon down');
  });

  it('shows the headline on success', () => {
    render(
      <CostSurface
        state={stateWith({ status: 'ok', value: { remaining: 2.5, capHit: false } })}
      />
    );
    expect(screen.getByText('$2.50 left')).toBeTruthy();
    expect(screen.getByText('under cap')).toBeTruthy();
  });
});
