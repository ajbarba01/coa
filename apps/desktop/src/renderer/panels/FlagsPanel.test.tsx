// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FlagsSurface, selectFlagsVm } from './FlagsPanel.js';
import { resetStores, seedStores } from '../testing/fixtures.js';
import type { ConsoleState } from './state.js';

const seed = (flags: ConsoleState['data']['flags']): void => {
  seedStores({ data: { flags } });
};

beforeEach(() => resetStores());

describe('selectFlagsVm', () => {
  it('passes loading/error through', () => {
    expect(selectFlagsVm({ data: { flags: { status: 'loading' } } })).toEqual({
      status: 'loading',
    });
  });
});

describe('FlagsSurface states-first', () => {
  it('skeletons while loading', () => {
    seed({ status: 'loading' });
    const { container } = render(<FlagsSurface />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('empty state when there are no flags', () => {
    seed({ status: 'ok', value: { expanded: [], collapsed: [] } });
    render(<FlagsSurface />);
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
    seed({ status: 'ok', value });
    render(<FlagsSurface />);
    expect(screen.getByText('generated stale')).toBeTruthy();
    expect(screen.getByText('pay.ts:10')).toBeTruthy();
    expect(screen.getByText(/4 more/i)).toBeTruthy();
  });

  it('announces an error via role=alert', () => {
    seed({ status: 'error', message: 'daemon down' });
    render(<FlagsSurface />);
    expect(screen.getByRole('alert').textContent).toContain('daemon down');
  });
});
