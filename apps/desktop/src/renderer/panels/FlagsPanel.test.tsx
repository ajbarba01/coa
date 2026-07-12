// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FlagsSurface, selectFlagsVm } from './FlagsPanel.js';
import { makeState } from './fixtures.js';
import type { ConsoleState } from './state.js';

const stateWith = (flags: ConsoleState['data']['flags']): ConsoleState =>
  makeState({ data: { flags } });

describe('selectFlagsVm', () => {
  it('passes loading/error through', () => {
    expect(selectFlagsVm(stateWith({ status: 'loading' }))).toEqual({ status: 'loading' });
  });
});

describe('FlagsSurface states-first', () => {
  it('skeletons while loading', () => {
    const { container } = render(<FlagsSurface state={stateWith({ status: 'loading' })} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('empty state when there are no flags', () => {
    render(
      <FlagsSurface state={stateWith({ status: 'ok', value: { expanded: [], collapsed: [] } })} />,
    );
    expect(screen.getByText(/no flags/i)).toBeTruthy();
  });

  it('renders an expanded flag with its severity and message, plus a collapsed count', () => {
    const value = {
      expanded: [
        {
          ruleId: 'ssot',
          location: 'pay.ts:10',
          severity: 'crit' as const,
          message: 'generated stale',
          fingerprint: 'f1',
          type: 1 as const,
          confidence: 'high' as const,
          concernKey: 'k1',
        },
      ],
      collapsed: [{ concernKey: 'k2', count: 4, severity: 'low' }],
    };
    render(<FlagsSurface state={stateWith({ status: 'ok', value })} />);
    expect(screen.getByText('generated stale')).toBeTruthy();
    expect(screen.getByText('pay.ts:10')).toBeTruthy();
    expect(screen.getByText(/4 more/i)).toBeTruthy();
  });

  it('announces an error via role=alert', () => {
    render(<FlagsSurface state={stateWith({ status: 'error', message: 'daemon down' })} />);
    expect(screen.getByRole('alert').textContent).toContain('daemon down');
  });
});
