// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { flagsPanel, selectFlagsVm } from './FlagsPanel.js';
import type { ConsoleState } from './state.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';

const FlagsView = flagsPanel.render;
const host = {
  title: 'Flags',
  setTitle: () => {},
  onVisibilityChange: () => () => {},
  requestFocus: () => {},
};

const stateWith = (flags: ConsoleState['data']['flags']): ConsoleState => ({
  data: {
    cap: { status: 'loading' },
    flags,
    timeline: { status: 'loading' },
    accounts: { status: 'loading' },
    turns: { status: 'loading' },
  },
  ui: { activeMainPanelId: 'flags', settings: DEFAULT_SETTINGS },
  actions: {
    setRoute: () => {},
    refresh: () => {},
    switchAccount: () => {},
    setSettings: () => {},
  },
});

describe('selectFlagsVm', () => {
  it('passes loading/error through', () => {
    expect(selectFlagsVm(stateWith({ status: 'loading' }))).toEqual({ status: 'loading' });
  });
});

describe('FlagsView states-first', () => {
  it('skeletons while loading', () => {
    const { container } = render(<FlagsView vm={{ status: 'loading' }} host={host} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('empty state when there are no flags', () => {
    render(<FlagsView vm={{ status: 'ok', value: { expanded: [], collapsed: [] } }} host={host} />);
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
    render(<FlagsView vm={{ status: 'ok', value }} host={host} />);
    expect(screen.getByText('generated stale')).toBeTruthy();
    expect(screen.getByText('pay.ts:10')).toBeTruthy();
    expect(screen.getByText(/4 more/i)).toBeTruthy();
  });
});
