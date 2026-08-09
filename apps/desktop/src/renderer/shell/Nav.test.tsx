// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FeedView } from '@coa/console-viewmodel';
import { resetStores, seedStores } from '../testing/fixtures.js';
import { useAuthStore } from '../panels/authStore.js';
import { Nav, critCount } from './Nav.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

beforeEach(() => {
  useShell.setState(initialShell, true);
  resetStores();
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
  /** Label-adjacency law (UI.md): the foot's settings control is icon-ONLY, so its mark is
   *  drawn. The surface rows above it keep their typed glyphs — those sit beside a label. */
  it('draws the settings mark rather than typing one', () => {
    render(<Nav />);
    const settings = screen.getByRole('button', { name: /^settings$/i });
    expect(settings.querySelector('svg')).not.toBeNull();
    expect(settings.textContent).toBe('');
  });

  it('routes a surface row click through the shell store', () => {
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: /timeline/i }));
    expect(useShell.getState().surface).toBe('timeline');
  });

  it('wears the red count on flags only when criticals exist', () => {
    const { rerender } = render(<Nav />);
    // Nothing seeded yet — flags are still loading, so no count anywhere.
    expect(screen.queryByText('2')).toBeNull();
    seedStores({
      data: {
        flags: {
          status: 'ok',
          value: { expanded: [flag('crit', 'a'), flag('crit', 'b')], collapsed: [] },
        },
      },
    });
    rerender(<Nav />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('opens settings from the foot, which no longer carries an account button', () => {
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    expect(useShell.getState().settingsOpen).toBe(true);
    // Credentials live on the `auth` surface now — the foot keeps only what is app-level.
    expect(screen.queryByRole('button', { name: 'account' })).toBeNull();
  });

  it('routes the auth and usage surfaces from the nav', () => {
    render(<Nav />);
    // Scoped to the nav: "usage" also names the rail HUD's own title button below it.
    const nav = screen.getByRole('navigation');
    fireEvent.click(within(nav).getByRole('button', { name: /auth/i }));
    expect(useShell.getState().surface).toBe('auth');
    fireEvent.click(within(nav).getByRole('button', { name: /usage/i }));
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
    const selected = screen.getByRole('button', { name: /chat/i });
    const unselected = screen.getByRole('button', { name: /timeline/i });
    expect(selected.className).toContain('bg-s4');
    expect(unselected.className).toContain('hover:bg-s3');
    expect(unselected.className).not.toContain('bg-s4');
  });

  it('grows a keybind tooltip on the settings foot button when focused', async () => {
    const user = userEvent.setup();
    render(<Nav />);
    const btn = screen.getByRole('button', { name: /^settings$/i });
    for (let i = 0; i < 25 && document.activeElement !== btn; i++) await user.tab();
    expect(document.activeElement).toBe(btn);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/settings/i);
  });

  it('keeps the project hitbox to its content width, not the whole sidebar', () => {
    useShell.getState().setWorkspace({ name: 'coa', root: 'C:/dev/coa' });
    render(<Nav />);
    const btn = screen.getByRole('button', { name: /coa/i });
    expect(btn.className).not.toContain('w-full');
  });

  it('states that switching is not available rather than offering a dead control', async () => {
    const user = userEvent.setup();
    useShell.setState({ projectOpen: false, workspace: { name: 'coa', root: 'C:/repo/coa' } });
    render(<Nav />);
    await user.click(screen.getByRole('button', { name: /coa/ }));
    expect(screen.getByText('Opening another project is not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Project…' })).not.toBeInTheDocument();
  });

  it('wears the amber attention count on auth when a login needs re-login — zero renders nothing', () => {
    const { rerender } = render(<Nav />);
    const nav = screen.getByRole('navigation');
    // No flagged logins — no badge on the auth row. The contract is that zero renders
    // NOTHING (indicator law), so assert the absence of a count rather than the row's
    // exact text, which is copy and free to change.
    expect(within(nav).getByRole('button', { name: /auth/i }).textContent).not.toMatch(/\d/);
    useAuthStore.setState({
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
    expect(within(nav).getByRole('button', { name: /auth/i }).textContent).toContain('1');
  });
});
