// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FeedView } from '@coa/console-viewmodel';
import { makeState } from '../panels/fixtures.js';
import { useMockAuth } from '../panels/mockAuth.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { Nav, critCount } from './Nav.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
});

const flag = (severity: 'crit' | 'high', fingerprint: string): FeedView['expanded'][number] => ({
  ruleId: 'ssot',
  location: 'pay.ts:10',
  severity,
  message: 'generated stale',
  fingerprint,
  type: 1,
  confidence: 'high',
  concernKey: fingerprint,
});

describe('critCount', () => {
  it('counts only critical flags and treats unresolved reads as zero', () => {
    expect(critCount(undefined)).toBe(0);
    expect(critCount({ status: 'loading' })).toBe(0);
    expect(critCount({ status: 'error', message: 'x' })).toBe(0);
    expect(
      critCount({
        status: 'ok',
        value: { expanded: [flag('crit', 'a'), flag('high', 'b')], collapsed: [] },
      }),
    ).toBe(1);
  });
});

describe('Nav', () => {
  it('routes a surface row click through the shell store', () => {
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: /timeline/ }));
    expect(useShell.getState().surface).toBe('timeline');
  });

  it('wears the red count on flags only when criticals exist', () => {
    const { rerender } = render(<Nav />);
    // No published state yet — no count anywhere.
    expect(screen.queryByText('2')).toBeNull();
    publishConsoleState(
      makeState({
        data: {
          flags: {
            status: 'ok',
            value: { expanded: [flag('crit', 'a'), flag('crit', 'b')], collapsed: [] },
          },
        },
      }),
    );
    rerender(<Nav />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('opens settings from the foot, which no longer carries an account button', () => {
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    expect(useShell.getState().settingsOpen).toBe(true);
    // Credentials live on the `auth` surface now — the foot keeps only what is app-level.
    expect(screen.queryByRole('button', { name: 'account' })).toBeNull();
  });

  it('routes the auth and usage surfaces from the nav', () => {
    render(<Nav />);
    // Scoped to the nav: "usage" also names the rail HUD's own title button below it.
    const nav = screen.getByRole('navigation');
    fireEvent.click(within(nav).getByRole('button', { name: /auth/ }));
    expect(useShell.getState().surface).toBe('auth');
    fireEvent.click(within(nav).getByRole('button', { name: /usage/ }));
    expect(useShell.getState().surface).toBe('usage');
  });

  it('names the project from the workspace main reports', () => {
    useShell.getState().setWorkspace({ name: 'coa', root: 'C:/dev/coa' });
    render(<Nav />);
    expect(screen.getByText('coa')).toBeTruthy();
  });

  it('separates the selected surface tint from the hover tint (selection law)', () => {
    render(<Nav />);
    // 'chat' is the default surface — the selected row wears the s4 selection
    // tint; unselected rows hover on s3, one step below.
    const selected = screen.getByRole('button', { name: /chat/ });
    const unselected = screen.getByRole('button', { name: /timeline/ });
    expect(selected.className).toContain('bg-s4');
    expect(unselected.className).toContain('hover:bg-s3');
    expect(unselected.className).not.toContain('bg-s4');
  });

  it('grows a keybind tooltip on the settings foot button when focused', async () => {
    const user = userEvent.setup();
    render(<Nav />);
    const btn = screen.getByRole('button', { name: 'settings' });
    for (let i = 0; i < 25 && document.activeElement !== btn; i++) await user.tab();
    expect(document.activeElement).toBe(btn);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/settings/);
  });

  it('keeps the project hitbox to its content width, not the whole sidebar', () => {
    useShell.getState().setWorkspace({ name: 'coa', root: 'C:/dev/coa' });
    render(<Nav />);
    const btn = screen.getByRole('button', { name: /coa/ });
    expect(btn.className).not.toContain('w-full');
  });

  it('wears the amber attention count on auth when a login needs re-login — zero renders nothing', () => {
    const { rerender } = render(<Nav />);
    const nav = screen.getByRole('navigation');
    // No flagged logins — no badge on the auth row.
    expect(within(nav).getByRole('button', { name: /auth/ }).textContent).toBe('⬡auth');
    useMockAuth.setState({
      credentials: [
        {
          id: 'claude:a',
          providerId: 'claude',
          label: 'a',
          masked: '~/.coa/logins/a',
          disabled: false,
          health: 'needs-relogin',
        },
        {
          id: 'claude:b',
          providerId: 'claude',
          label: 'b',
          masked: '~/.coa/logins/b',
          disabled: false,
          health: 'healthy',
        },
      ],
    });
    rerender(<Nav />);
    expect(within(nav).getByRole('button', { name: /auth/ }).textContent).toContain('1');
  });
});
