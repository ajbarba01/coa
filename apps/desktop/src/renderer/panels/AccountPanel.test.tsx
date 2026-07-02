// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { accountPanel, providersOf, selectAccountVm } from './AccountPanel.js';
import { makeState } from './fixtures.js';
import type { ConsoleState } from './state.js';

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
): ConsoleState => makeState({ data: { accounts }, actions: { switchAccount } });

describe('AccountView', () => {
  it('skeletons while loading', () => {
    const { container } = render(
      <AccountView vm={selectAccountVm(stateWith({ status: 'loading' }))} host={host} />,
    );
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows a per-provider selector reflecting the active account', () => {
    const vm = selectAccountVm(
      stateWith({
        status: 'ok',
        value: {
          accounts: [
            { label: 'personal', provider: 'claude' },
            { label: 'ds', provider: 'deepseek' },
          ],
          active: { claude: 'personal', deepseek: 'ds' },
        },
      }),
    );
    render(<AccountView vm={vm} host={host} />);
    // One labelled selector per provider, each showing its active account.
    expect(screen.getByText('Claude account')).toBeTruthy();
    expect(screen.getByText('DeepSeek account')).toBeTruthy();
    expect(screen.getByText('personal')).toBeTruthy();
    expect(screen.getByText('ds')).toBeTruthy();
  });

  it('lists each distinct provider once, in first-seen order', () => {
    expect(
      providersOf([
        { label: 'personal', provider: 'claude' },
        { label: 'work', provider: 'claude' },
        { label: 'ds', provider: 'deepseek' },
      ]),
    ).toEqual(['claude', 'deepseek']);
  });
});
