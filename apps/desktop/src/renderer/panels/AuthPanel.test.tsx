// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useShell } from '../shell/store.js';
import { AuthStrip, AuthSurface, statusText } from './AuthPanel.js';
import { credentialStatus, mask, poolHealth, useMockAuth, type Credential } from './mockAuth.js';
import { useAuthUi } from './surfaceUi.js';

// The mock store is module-level (it feeds the surface AND the rail HUD), so each test
// starts from the same seed rather than from its predecessor's leftovers. The shell store
// joins the reset because the add-provider dialog lives in its single-dialog slot.
const SEED = useMockAuth.getState();
const UI_SEED = useAuthUi.getState();
const SHELL_SEED = useShell.getState();
beforeEach(() => {
  useMockAuth.setState(SEED, true);
  useAuthUi.setState(UI_SEED, true);
  useShell.setState(SHELL_SEED, true);
});

/** The surface AND its title-bar strip: the strip is part of the surface (it carries the
 *  add-provider control), so a test that renders only the body is testing half a screen. */
function renderAuth(): void {
  render(
    <>
      <AuthStrip />
      <AuthSurface />
    </>,
  );
}

const credential = (over: Partial<Credential> = {}): Credential => ({
  id: 'x',
  providerId: 'tavily',
  label: 'k',
  masked: 'tvly…8f2',
  disabled: false,
  ...over,
});

describe('the secret contract', () => {
  it('masks a pasted secret to a prefix and a tail — never the secret', () => {
    expect(mask('tvly-dev-9a83kfj2meow8f2')).toBe('tvly…8f2');
    expect(mask('short')).toBe('••••');
  });

  it('a replaced key keeps its label and loses its cooldown — replace is an add that supersedes', () => {
    const key = useMockAuth.getState().credentials.find((c) => c.coolingSec !== undefined);
    expect(key).toBeDefined();
    useMockAuth.getState().replaceSecret(key!.id, 'tvly-brand-new-key-000zzz');
    const after = useMockAuth.getState().credentials.find((c) => c.id === key!.id);
    expect(after?.label).toBe(key!.label);
    expect(after?.coolingSec).toBeUndefined();
    expect(after?.masked).not.toContain('brand');
  });

  it('stores a pointer verbatim — a path is not a secret, and masking one hides a readable fact', () => {
    useMockAuth.getState().addCredential('claude', 'work', '~/.claude-work');
    const added = useMockAuth.getState().credentials.find((c) => c.label === 'work');
    expect(added?.masked).toBe('~/.claude-work');
  });

  it('renames a credential without touching anything it earned', () => {
    const key = useMockAuth.getState().credentials.find((c) => c.coolingSec !== undefined);
    useMockAuth.getState().renameCredential(key!.id, 'tavily-hot');
    const after = useMockAuth.getState().credentials.find((c) => c.id === key!.id);
    expect(after?.label).toBe('tavily-hot');
    expect(after?.masked).toBe(key!.masked);
    expect(after?.coolingSec).toBe(key!.coolingSec);
  });
});

describe('credential status', () => {
  it('reads the operator’s bench above the breaker’s cooldown', () => {
    const benchedAndCooling = credential({ disabled: true, coolingSec: 90 });
    expect(credentialStatus(benchedAndCooling, {})).toBe('disabled');
  });

  it('cooling carries its own countdown', () => {
    const c = credential({ coolingSec: 252 });
    expect(statusText(c, 'cooling')).toBe('cooling down · 4m 12s');
  });

  it('counts a pool by health, and a zero count says nothing', () => {
    expect(
      poolHealth([credential(), credential({ coolingSec: 10 }), credential({ disabled: true })]),
    ).toEqual({ healthy: 1, cooling: 1, disabled: 1 });
  });
});

describe('benching', () => {
  it('unseats the active login — "disabled but active" would be a lie', () => {
    const active = useMockAuth.getState().activeByProvider['claude'];
    expect(active).toBeDefined();
    useMockAuth.getState().setCredentialDisabled(active!, true);
    expect(useMockAuth.getState().activeByProvider['claude']).not.toBe(active);
  });

  it('promotes a usable sibling when the active login is removed, never a ghost', () => {
    const active = useMockAuth.getState().activeByProvider['claude'];
    useMockAuth.getState().removeCredential(active!);
    const heir = useMockAuth.getState().activeByProvider['claude'];
    const heirCred = useMockAuth.getState().credentials.find((c) => c.id === heir);
    expect(heirCred?.expired).not.toBe(true);
    expect(heirCred?.disabled).toBe(false);
  });

  it('refuses to activate an expired login', () => {
    const expired = useMockAuth.getState().credentials.find((c) => c.expired === true);
    useMockAuth.getState().makeActive(expired!.id);
    expect(useMockAuth.getState().activeByProvider['claude']).not.toBe(expired!.id);
  });
});

describe('AuthSurface', () => {
  it('groups backends and services, and names each provider by its mark', () => {
    renderAuth();
    expect(screen.getByText('agent backends')).toBeTruthy();
    expect(screen.getByText('tool services')).toBeTruthy();
    // The mark is the identity: it must survive with images or color off.
    expect(screen.getAllByRole('img', { name: 'Claude' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Tavily' }).length).toBeGreaterThan(0);
  });

  it('shows the selected provider’s credentials in the detail pane, not inline in the list', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByRole('button', { name: /tavily/i }));
    // The detail pane cross-fades in (AnimatePresence mode="wait"), so it is awaited.
    // All seven keys live in that table — the list row only ever carried a count.
    expect(await screen.findByText('keys')).toBeTruthy();
    expect(screen.getAllByText(/tavily-\d/).length).toBe(7);
    expect(screen.getByText(/cooling down/)).toBeTruthy();
    expect(screen.getAllByText('benched').length).toBeGreaterThan(0);
  });

  it('edits labels and pointers — never secrets: a keyed row’s edit form has no secret field', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByRole('button', { name: /deepseek/i }));
    await screen.findByText('keys');
    await user.click(screen.getByRole('button', { name: 'ds actions' }));
    await user.click(await screen.findByText('edit…'));
    // Label only — the key itself is remove-and-re-add, so the form cannot even ask.
    expect(screen.getByLabelText('label')).toBeTruthy();
    expect(screen.queryByLabelText(/paste/i)).toBeNull();
    await user.clear(screen.getByLabelText('label'));
    await user.type(screen.getByLabelText('label'), 'ds-main');
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(useMockAuth.getState().credentials.some((c) => c.label === 'ds-main')).toBe(true);
  });

  it('replace stays for real secrets, and a healthy pointer row offers no replace at all', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByRole('button', { name: 'worm actions' }));
    await screen.findByText('edit…');
    // worm is a healthy config-dir login: re-pointing is edit's job; re-login is expiry's.
    expect(screen.queryByText('re-login…')).toBeNull();
    expect(screen.queryByText(/^replace/)).toBeNull();
  });

  it('offers re-login on an expired login — the pointer’s one recovery act', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByRole('button', { name: 'personal actions' }));
    expect(await screen.findByText('re-login…')).toBeTruthy();
  });

  it('opens the same ⋯ menu on right-click — a second door, not a second menu', async () => {
    const user = userEvent.setup();
    renderAuth();
    const row = screen.getByText('school').closest('div[class*="group"]');
    expect(row).toBeTruthy();
    await user.pointer({ keys: '[MouseRight]', target: row! });
    expect(await screen.findByText('edit…')).toBeTruthy();
  });

  it('right-clicking the open menu does not reposition it — menus don’t get menus', async () => {
    const user = userEvent.setup();
    renderAuth();
    const row = screen.getByText('school').closest('div[class*="group"]');
    await user.pointer({ keys: '[MouseRight]', target: row! });
    const item = await screen.findByText('edit…');
    // The portaled popup bubbles through the React tree into the row's handler; the
    // guard must swallow it (menu stays open, exactly one instance).
    fireEvent.contextMenu(item, { clientX: 500, clientY: 500 });
    expect(screen.getAllByText('edit…').length).toBe(1);
  });

  it('is its own empty state when nothing is configured', () => {
    useMockAuth.setState({ added: [], credentials: [] });
    renderAuth();
    expect(screen.getByText(/no providers yet/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /add provider/i }).length).toBeGreaterThan(0);
  });

  it('adds a provider through the catalogue and lands on it', async () => {
    const user = userEvent.setup();
    useMockAuth.setState({ added: [], credentials: [] });
    renderAuth();

    await user.click(screen.getAllByRole('button', { name: /add provider/i })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /exa/i }));

    // Step 2 is chosen by the LOCATOR KIND (exa is key-file), never by the provider.
    await user.type(await screen.findByLabelText(/paste the key/i), 'exa-key-abc123456');
    await user.click(screen.getByRole('button', { name: 'add key' }));

    expect(useMockAuth.getState().added).toContain('exa');
    expect(useMockAuth.getState().credentials.some((c) => c.providerId === 'exa')).toBe(true);
  });

  it('adds a key inline, without a modal covering the table it is adding to', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await user.click(await screen.findByRole('button', { name: '+ add key' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await user.type(await screen.findByLabelText(/paste the key/i), 'tvly-eighth-key-99001');
    await user.click(screen.getByRole('button', { name: 'add' }));

    expect(useMockAuth.getState().credentials.filter((c) => c.providerId === 'tavily').length).toBe(
      8,
    );
  });

  it('switches the active login with one click on the row — not from inside a menu', async () => {
    const user = userEvent.setup();
    renderAuth();
    const before = useMockAuth.getState().activeByProvider['claude'];
    await user.click(screen.getByRole('button', { name: 'use school' }));
    const after = useMockAuth.getState().activeByProvider['claude'];
    expect(after).not.toBe(before);
    expect(useMockAuth.getState().credentials.find((c) => c.id === after)?.label).toBe('school');
  });

  it('offers no one-click activation for a pool — a service has no "active" key', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await screen.findByText('keys');
    expect(screen.queryByRole('button', { name: /^use tavily-/ })).toBeNull();
  });

  it('removing a provider asks first — and cancel keeps everything', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await screen.findByText('keys');
    await user.click(screen.getByRole('button', { name: 'tavily actions' }));
    await user.click(await screen.findByText('remove provider…'));

    // Nothing removed yet — the dialog is the gate.
    expect(useMockAuth.getState().added).toContain('tavily');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'cancel' }));
    expect(useMockAuth.getState().added).toContain('tavily');

    await user.click(screen.getByRole('button', { name: 'tavily actions' }));
    await user.click(await screen.findByText('remove provider…'));
    const again = await screen.findByRole('dialog');
    await user.click(within(again).getByRole('button', { name: 'remove provider' }));
    expect(useMockAuth.getState().added).not.toContain('tavily');
    expect(useMockAuth.getState().credentials.some((c) => c.providerId === 'tavily')).toBe(false);
  });

  it('joins the single-dialog rule — opening another shell dialog closes it, and vice versa', () => {
    useShell.getState().setAddProviderOpen(true);
    useShell.getState().setSettingsOpen(true);
    expect(useShell.getState().addProviderOpen).toBe(false);
    useShell.getState().setAddProviderOpen(true);
    expect(useShell.getState().settingsOpen).toBe(false);
  });

  it('Escape walks the add-provider dialog back a step before closing it', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getAllByRole('button', { name: /add provider/i })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /exa/i }));
    await screen.findByLabelText(/paste the key/i);

    // First Escape: back to the catalogue (the field must not swallow the key).
    await user.keyboard('{Escape}');
    expect(await within(dialog).findByText('agent backends')).toBeTruthy();
    // Second Escape: the dialog itself.
    await user.keyboard('{Escape}');
    expect(useShell.getState().addProviderOpen).toBe(false);
  });

  it('shows a backend’s models with the long tail behind "all N models…"', async () => {
    const user = userEvent.setup();
    renderAuth();
    // claude seeds 9 models; 6 show inline, the rest live in the dialog.
    expect(await screen.findByText('models')).toBeTruthy();
    expect(screen.getByText('fable 5')).toBeTruthy();
    expect(screen.queryByText('sonnet 4')).toBeNull();
    await user.click(screen.getByRole('button', { name: /all 9 models/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('sonnet 4')).toBeTruthy();
    // The filter narrows by label OR id.
    await user.type(within(dialog).getByLabelText('filter models…'), 'haiku');
    expect(within(dialog).queryByText('fable 5')).toBeNull();
    expect(within(dialog).getByText('haiku 4.5')).toBeTruthy();
  });

  it('hiding a model is a view preference — a store fact the toggle flips both ways', () => {
    // Seeded: haiku 3.5 starts hidden.
    expect(useMockAuth.getState().hiddenModels).toContain('claude-haiku-3-5');
    useMockAuth.getState().setModelHidden('claude-haiku-3-5', false);
    expect(useMockAuth.getState().hiddenModels).not.toContain('claude-haiku-3-5');
    useMockAuth.getState().setModelHidden('claude-opus-4-8', true);
    useMockAuth.getState().setModelHidden('claude-opus-4-8', true);
    expect(
      useMockAuth.getState().hiddenModels.filter((id) => id === 'claude-opus-4-8').length,
    ).toBe(1);
  });

  it('a tool service page shows no models section — a pool has no models', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await screen.findByText('keys');
    // The outgoing backend detail lingers through its exit cross-fade — wait it out.
    await waitFor(() => expect(screen.queryByText('models')).toBeNull());
  });

  it('wears the provider version in the subtitle where one applies', () => {
    renderAuth();
    expect(screen.getByText(/agent sdk 0\.72/)).toBeTruthy();
  });

  it('benches a provider without touching its credentials', async () => {
    const user = userEvent.setup();
    renderAuth();
    const before = useMockAuth.getState().credentials.length;
    await user.click(screen.getAllByRole('switch', { name: 'tavily enabled' })[0]!);
    expect(useMockAuth.getState().enabled['tavily']).toBe(false);
    expect(useMockAuth.getState().credentials.length).toBe(before);
  });
});
