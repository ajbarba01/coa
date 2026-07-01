// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { accountPanel, selectAccountVm } from './AccountPanel.js';
import type { ConsoleState } from './state.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';

const AccountView = accountPanel.render;
const host = {
  title: 'Account',
  setTitle: () => {},
  onVisibilityChange: () => () => {},
  requestFocus: () => {},
};

const stateWith = (
  accounts: ConsoleState['data']['accounts'],
  switchAccount = vi.fn(),
): ConsoleState => ({
  data: {
    cap: { status: 'loading' },
    flags: { status: 'loading' },
    timeline: { status: 'loading' },
    accounts,
    turns: { status: 'loading' },
  },
  ui: { activeMainPanelId: 'cost', settings: DEFAULT_SETTINGS },
  actions: { setRoute: () => {}, refresh: () => {}, switchAccount, setSettings: () => {} },
});

describe('AccountView', () => {
  it('skeletons while loading', () => {
    const { container } = render(
      <AccountView vm={selectAccountVm(stateWith({ status: 'loading' }))} host={host} />,
    );
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows the active account and the choices', () => {
    const vm = selectAccountVm(
      stateWith({
        status: 'ok',
        value: { accounts: [{ label: 'acct-1' }, { label: 'acct-2' }], active: 'acct-1' },
      }),
    );
    render(<AccountView vm={vm} host={host} />);
    expect(screen.getByText('acct-1')).toBeTruthy();
  });
});
