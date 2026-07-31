// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthView } from '@coa/console-viewmodel';
import { useShell } from '../shell/store.js';
import { AuthStrip, AuthSurface, statusText } from './AuthPanel.js';
import {
  credentialStatus,
  credentialsOf,
  poolHealth,
  useMockAuth,
  type Credential,
} from './mockAuth.js';
import { useAuthUi } from './surfaceUi.js';
import { useModels } from './modelsStore.js';

// The store now talks to the daemon through these RPC callers (console.ts) — mocked here so
// every write action resolves with a CRAFTED `AuthView` fixture instead of a real IPC round
// trip. Daemon-owned outcomes (heir promotion, rename re-key, the remove cascade, how a
// pointer vs. a secret gets masked) are exercised by the daemon's own suite, not re-tested
// here: this file only asserts that the right verb is called with the right args, and that
// the view it resolves with lands in the store.
vi.mock('../console.js', () => ({
  rpcAuthView: vi.fn(),
  rpcAddProvider: vi.fn(),
  rpcRemoveProvider: vi.fn(),
  rpcAddCredential: vi.fn(),
  rpcReplaceSecret: vi.fn(),
  rpcRenameCredential: vi.fn(),
  rpcRemoveCredential: vi.fn(),
  rpcSetProviderEnabled: vi.fn(),
  rpcSetCredentialDisabled: vi.fn(),
  rpcMakeActive: vi.fn(),
  rpcClearCooldown: vi.fn(),
  rpcRefreshAuth: vi.fn(),
  // The model editor rides the same surface (ModelsSection), so its callers join the mock.
  rpcModelCatalog: vi.fn(),
  rpcAddModels: vi.fn(),
  rpcAddCustomModel: vi.fn(),
  rpcEditModel: vi.fn(),
  rpcRemoveModel: vi.fn(),
  rpcSetModelHidden: vi.fn(),
  notifyModelsChanged: vi.fn().mockResolvedValue(undefined),
  onModelsChanged: vi.fn(),
  // The driven-login flow (LoginFlow + loginStore) rides the surface too.
  rpcStartLogin: vi.fn(),
  rpcLoginState: vi.fn(),
  rpcSubmitLoginCode: vi.fn(),
  rpcCancelLogin: vi.fn().mockResolvedValue({ phase: 'idle' }),
  rpcResolveLoginMismatch: vi.fn(),
  rpcProbeHealth: vi.fn(),
  rpcReportAuthFailure: vi.fn(),
}));

import {
  rpcAddCredential,
  rpcAddProvider,
  rpcAuthView,
  rpcClearCooldown,
  rpcMakeActive,
  rpcProbeHealth,
  rpcRemoveCredential,
  rpcRemoveProvider,
  rpcRenameCredential,
  rpcReplaceSecret,
  rpcSetCredentialDisabled,
  rpcSetProviderEnabled,
  rpcStartLogin,
} from '../console.js';
import { useLogin } from './loginStore.js';

// The store is module-level (it feeds the surface AND the rail HUD), so each test starts from
// the same empty shape rather than its predecessor's leftovers. The shell store joins the
// reset because the add-provider dialog lives in its single-dialog slot.
const EMPTY_STATE = useMockAuth.getState();
const UI_SEED = useAuthUi.getState();
const SHELL_SEED = useShell.getState();
beforeEach(() => {
  vi.resetAllMocks();
  useMockAuth.setState(EMPTY_STATE, true);
  useAuthUi.setState(UI_SEED, true);
  useShell.setState(SHELL_SEED, true);
  useModels.setState({ lists: {}, catalog: {} });
  useLogin.setState({ flow: undefined });
});

/** Mirrors the real `~/.coa` shape (3 claude logins, keyed backends, a fat tavily pool with
 *  one key cooling and one benched) — the states the surface has to survive, not a happy path.
 *  Fed to the store through `hydrate()` (mocked `authView`), never poked in directly, so every
 *  render test exercises the same live path the app takes. */
const FIXTURE_VIEW: AuthView = {
  added: ['claude', 'deepseek', 'longcat', 'tavily', 'firecrawl', 'parallel'],
  credentials: [
    {
      id: 'c1',
      providerId: 'claude',
      label: 'worm',
      masked: '~/.claude',
      identity: 'wormsegment1000@gmail.com',
      plan: 'Claude Pro',
      disabled: false,
      lastUsed: 'now',
    },
    {
      id: 'c2',
      providerId: 'claude',
      label: 'school',
      masked: '~/.claude-school',
      identity: 'alex@barba.edu',
      plan: 'Claude Pro',
      disabled: false,
      lastUsed: '3d',
    },
    {
      id: 'c3',
      providerId: 'claude',
      label: 'personal',
      masked: '~/.claude-personal',
      expired: true,
      disabled: false,
      lastUsed: '2w',
    },
    {
      id: 'c4',
      providerId: 'deepseek',
      label: 'ds',
      masked: 'sk-9…4f1',
      disabled: false,
      lastUsed: '1d',
    },
    {
      id: 'c5',
      providerId: 'longcat',
      label: 'lc',
      masked: 'lc-2…c07',
      disabled: false,
      lastUsed: '2w',
    },
    {
      id: 't1',
      providerId: 'tavily',
      label: 'tavily-1',
      masked: 'tvly…8f2',
      disabled: false,
      lastUsed: '2m',
    },
    {
      id: 't2',
      providerId: 'tavily',
      label: 'tavily-2',
      masked: 'tvly…a10',
      disabled: false,
      lastUsed: '11m',
    },
    {
      id: 't3',
      providerId: 'tavily',
      label: 'tavily-3',
      masked: 'tvly…c4d',
      coolingSec: 252,
      disabled: false,
      lastUsed: '5m',
    },
    {
      id: 't4',
      providerId: 'tavily',
      label: 'tavily-4',
      masked: 'tvly…33e',
      disabled: false,
      lastUsed: '1h',
    },
    { id: 't5', providerId: 'tavily', label: 'tavily-5', masked: 'tvly…9be', disabled: true },
    {
      id: 't6',
      providerId: 'tavily',
      label: 'tavily-6',
      masked: 'tvly…71c',
      disabled: false,
      lastUsed: '4h',
    },
    {
      id: 't7',
      providerId: 'tavily',
      label: 'tavily-7',
      masked: 'tvly…e50',
      disabled: false,
      lastUsed: '2d',
    },
    {
      id: 'f1',
      providerId: 'firecrawl',
      label: 'fc-1',
      masked: 'fc-1…b22',
      disabled: false,
      lastUsed: '18m',
    },
    {
      id: 'f2',
      providerId: 'firecrawl',
      label: 'fc-2',
      masked: 'fc-2…9a4',
      disabled: false,
      lastUsed: '1d',
    },
    { id: 'p1', providerId: 'parallel', label: 'px-1', masked: 'px-0…5d1', disabled: false },
  ],
  activeByProvider: { claude: 'c1', deepseek: 'c4' },
  enabled: {
    claude: true,
    deepseek: true,
    longcat: false,
    tavily: true,
    firecrawl: true,
    parallel: false,
  },
  chains: { search: ['tavily', 'firecrawl', 'parallel'], fetch: ['firecrawl', 'tavily'] },
};

const EMPTY_VIEW: AuthView = {
  added: [],
  credentials: [],
  activeByProvider: {},
  enabled: {},
  chains: {},
};

/** The surface AND its title-bar strip: the strip is part of the surface (it carries the
 *  add-provider control), so a test that renders only the body is testing half a screen.
 *  Mounting fires `AuthSurface`'s real `hydrate()` effect against the mocked `authView` —
 *  awaited here so every test starts from the resolved view, not a still-loading one. */
async function renderAuth(view: AuthView = FIXTURE_VIEW): Promise<void> {
  vi.mocked(rpcAuthView).mockResolvedValue(view);
  render(
    <>
      <AuthStrip />
      <AuthSurface />
    </>,
  );
  await waitFor(() => expect(useMockAuth.getState().added).toEqual(view.added));
}

const credential = (over: Partial<Credential> = {}): Credential => ({
  id: 'x',
  providerId: 'tavily',
  label: 'k',
  masked: 'tvly…8f2',
  disabled: false,
  ...over,
});

describe('hydrate', () => {
  it('populates the store from authView and keeps selectors working', async () => {
    vi.mocked(rpcAuthView).mockResolvedValue(FIXTURE_VIEW);
    await useMockAuth.getState().hydrate();
    expect(credentialsOf(useMockAuth.getState().credentials, 'tavily').length).toBe(7);
    expect(useMockAuth.getState().added).toEqual(FIXTURE_VIEW.added);
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

describe('AuthSurface', () => {
  it('groups backends and services, and names each provider by its mark', async () => {
    await renderAuth();
    expect(screen.getByText('agent backends')).toBeTruthy();
    expect(screen.getByText('tool services')).toBeTruthy();
    // The mark is the identity: it must survive with images or color off.
    expect(screen.getAllByRole('img', { name: 'Claude' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Tavily' }).length).toBeGreaterThan(0);
  });

  it('shows the selected provider’s credentials in the detail pane, not inline in the list', async () => {
    const user = userEvent.setup();
    await renderAuth();
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
    await renderAuth();
    const renamed: AuthView = {
      ...FIXTURE_VIEW,
      credentials: FIXTURE_VIEW.credentials.map((c) =>
        c.id === 'c4' ? { ...c, label: 'ds-main' } : c,
      ),
    };
    vi.mocked(rpcRenameCredential).mockResolvedValue(renamed);

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

    expect(rpcRenameCredential).toHaveBeenCalledWith('c4', 'ds-main');
    await waitFor(() =>
      expect(useMockAuth.getState().credentials.some((c) => c.label === 'ds-main')).toBe(true),
    );
  });

  it('replace stays for real secrets, and a healthy pointer row offers no replace at all', async () => {
    const user = userEvent.setup();
    await renderAuth();
    await user.click(screen.getByRole('button', { name: 'worm actions' }));
    await screen.findByText('edit…');
    // worm is a healthy config-dir login: re-pointing is edit's job; re-login is expiry's.
    expect(screen.queryByText('re-login…')).toBeNull();
    expect(screen.queryByText(/^replace/)).toBeNull();
  });

  it('offers re-login on an expired login — the pointer’s one recovery act', async () => {
    const user = userEvent.setup();
    await renderAuth();
    await user.click(screen.getByRole('button', { name: 'personal actions' }));
    expect(await screen.findByText('re-login…')).toBeTruthy();
  });

  it('replaces a real secret by calling rpcReplaceSecret and applying the returned view', async () => {
    const user = userEvent.setup();
    await renderAuth();
    // A fresh secret clears what the OLD one earned (its cooldown) — modelled here the same
    // way the store itself would have to drop the field (exactOptionalPropertyTypes: absence,
    // never `coolingSec: undefined`).
    const replaced: AuthView = {
      ...FIXTURE_VIEW,
      credentials: FIXTURE_VIEW.credentials.map((c) => {
        if (c.id !== 't3') return c;
        const { coolingSec: _cooling, ...rest } = c;
        return { ...rest, masked: 'tvly…zzz' };
      }),
    };
    vi.mocked(rpcReplaceSecret).mockResolvedValue(replaced);

    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await screen.findByText('keys');
    await user.click(screen.getByRole('button', { name: 'tavily-3 actions' }));
    await user.click(await screen.findByText('replace key…'));
    await user.type(
      await screen.findByLabelText(/paste the replacement/i),
      'tvly-brand-new-key-000zzz',
    );
    await user.click(screen.getByRole('button', { name: 'replace' }));

    expect(rpcReplaceSecret).toHaveBeenCalledWith('t3', 'tvly-brand-new-key-000zzz');
    await waitFor(() =>
      expect(
        useMockAuth.getState().credentials.find((c) => c.id === 't3')?.coolingSec,
      ).toBeUndefined(),
    );
  });

  it('opens the same ⋯ menu on right-click — a second door, not a second menu', async () => {
    const user = userEvent.setup();
    await renderAuth();
    const row = screen.getByText('school').closest('div[class*="group"]');
    expect(row).toBeTruthy();
    await user.pointer({ keys: '[MouseRight]', target: row! });
    expect(await screen.findByText('edit…')).toBeTruthy();
  });

  it('right-clicking the open menu does not reposition it — menus don’t get menus', async () => {
    const user = userEvent.setup();
    await renderAuth();
    const row = screen.getByText('school').closest('div[class*="group"]');
    await user.pointer({ keys: '[MouseRight]', target: row! });
    const item = await screen.findByText('edit…');
    // The portaled popup bubbles through the React tree into the row's handler; the
    // guard must swallow it (menu stays open, exactly one instance).
    fireEvent.contextMenu(item, { clientX: 500, clientY: 500 });
    expect(screen.getAllByText('edit…').length).toBe(1);
  });

  it('is its own empty state when nothing is configured', async () => {
    await renderAuth(EMPTY_VIEW);
    expect(screen.getByText(/no providers yet/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /add provider/i }).length).toBeGreaterThan(0);
  });

  it('adds a provider through the catalogue — sequences addProvider then addCredential, and lands on it', async () => {
    const user = userEvent.setup();
    await renderAuth(EMPTY_VIEW);
    const afterAdd: AuthView = { ...EMPTY_VIEW, added: ['exa'], enabled: { exa: true } };
    const afterCredential: AuthView = {
      ...afterAdd,
      credentials: [{ id: 'e1', providerId: 'exa', label: 'exa', masked: 'exa-…456', disabled: false }],
    };
    vi.mocked(rpcAddProvider).mockResolvedValue(afterAdd);
    vi.mocked(rpcAddCredential).mockResolvedValue(afterCredential);

    await user.click(screen.getAllByRole('button', { name: /add provider/i })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /exa/i }));

    // Step 2 is chosen by the LOCATOR KIND (exa is key-file), never by the provider.
    await user.type(await screen.findByLabelText(/paste the key/i), 'exa-key-abc123456');
    await user.click(screen.getByRole('button', { name: 'add key' }));

    expect(rpcAddProvider).toHaveBeenCalledWith('exa');
    expect(rpcAddCredential).toHaveBeenCalledWith('exa', 'exa', 'exa-key-abc123456');
    await waitFor(() => expect(useMockAuth.getState().added).toContain('exa'));
    expect(useMockAuth.getState().credentials.some((c) => c.providerId === 'exa')).toBe(true);
  });

  it('adds a key inline, without a modal covering the table it is adding to', async () => {
    const user = userEvent.setup();
    await renderAuth();
    const eighth: AuthView = {
      ...FIXTURE_VIEW,
      credentials: [
        ...FIXTURE_VIEW.credentials,
        { id: 't8', providerId: 'tavily', label: 'tavily-8', masked: 'tvly…001', disabled: false },
      ],
    };
    vi.mocked(rpcAddCredential).mockResolvedValue(eighth);

    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await user.click(await screen.findByRole('button', { name: '+ add key' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await user.type(await screen.findByLabelText(/paste the key/i), 'tvly-eighth-key-99001');
    await user.click(screen.getByRole('button', { name: 'add' }));

    expect(rpcAddCredential).toHaveBeenCalledWith('tavily', 'tavily-8', 'tvly-eighth-key-99001');
    await waitFor(() =>
      expect(
        useMockAuth.getState().credentials.filter((c) => c.providerId === 'tavily').length,
      ).toBe(8),
    );
  });

  it('switches the active login with one click on the row — not from inside a menu', async () => {
    const user = userEvent.setup();
    await renderAuth();
    const switched: AuthView = {
      ...FIXTURE_VIEW,
      activeByProvider: { ...FIXTURE_VIEW.activeByProvider, claude: 'c2' },
    };
    vi.mocked(rpcMakeActive).mockResolvedValue(switched);

    await user.click(screen.getByRole('button', { name: 'use school' }));

    expect(rpcMakeActive).toHaveBeenCalledWith('c2');
    await waitFor(() => expect(useMockAuth.getState().activeByProvider['claude']).toBe('c2'));
  });

  it('offers no one-click activation for a pool — a service has no "active" key', async () => {
    const user = userEvent.setup();
    await renderAuth();
    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await screen.findByText('keys');
    expect(screen.queryByRole('button', { name: /^use tavily-/ })).toBeNull();
  });

  it('un-benches a credential by calling rpcSetCredentialDisabled and applying the returned view', async () => {
    const user = userEvent.setup();
    await renderAuth();
    const unbenched: AuthView = {
      ...FIXTURE_VIEW,
      credentials: FIXTURE_VIEW.credentials.map((c) =>
        c.id === 't5' ? { ...c, disabled: false } : c,
      ),
    };
    vi.mocked(rpcSetCredentialDisabled).mockResolvedValue(unbenched);

    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await screen.findByText('keys');
    await user.click(screen.getByRole('button', { name: 'tavily-5 actions' }));
    await user.click(await screen.findByText('un-bench'));

    expect(rpcSetCredentialDisabled).toHaveBeenCalledWith('t5', false);
    await waitFor(() =>
      expect(useMockAuth.getState().credentials.find((c) => c.id === 't5')?.disabled).toBe(false),
    );
  });

  it('clears a cooldown by calling rpcClearCooldown and applying the returned view', async () => {
    const user = userEvent.setup();
    await renderAuth();
    const cleared: AuthView = {
      ...FIXTURE_VIEW,
      credentials: FIXTURE_VIEW.credentials.map((c) => {
        if (c.id !== 't3') return c;
        const { coolingSec: _cooling, ...rest } = c;
        return rest;
      }),
    };
    vi.mocked(rpcClearCooldown).mockResolvedValue(cleared);

    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await screen.findByText('keys');
    await user.click(screen.getByRole('button', { name: 'tavily-3 actions' }));
    await user.click(await screen.findByText('clear cooldown'));

    expect(rpcClearCooldown).toHaveBeenCalledWith('t3');
    await waitFor(() =>
      expect(
        useMockAuth.getState().credentials.find((c) => c.id === 't3')?.coolingSec,
      ).toBeUndefined(),
    );
  });

  it('removes a credential by calling rpcRemoveCredential and applying the returned view', async () => {
    const user = userEvent.setup();
    await renderAuth();
    const removed: AuthView = {
      ...FIXTURE_VIEW,
      credentials: FIXTURE_VIEW.credentials.filter((c) => c.id !== 't7'),
    };
    vi.mocked(rpcRemoveCredential).mockResolvedValue(removed);

    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await screen.findByText('keys');
    await user.click(screen.getByRole('button', { name: 'tavily-7 actions' }));
    await user.click(await screen.findByText('remove'));

    expect(rpcRemoveCredential).toHaveBeenCalledWith('t7');
    await waitFor(() =>
      expect(useMockAuth.getState().credentials.some((c) => c.id === 't7')).toBe(false),
    );
  });

  it('removing a provider asks first — and cancel keeps everything', async () => {
    const user = userEvent.setup();
    await renderAuth();
    const removed: AuthView = {
      ...FIXTURE_VIEW,
      added: FIXTURE_VIEW.added.filter((id) => id !== 'tavily'),
      credentials: FIXTURE_VIEW.credentials.filter((c) => c.providerId !== 'tavily'),
    };
    vi.mocked(rpcRemoveProvider).mockResolvedValue(removed);

    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await screen.findByText('keys');
    await user.click(screen.getByRole('button', { name: 'tavily actions' }));
    await user.click(await screen.findByText('remove provider…'));

    // Nothing removed yet — the dialog is the gate.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'cancel' }));
    expect(rpcRemoveProvider).not.toHaveBeenCalled();
    expect(useMockAuth.getState().added).toContain('tavily');

    await user.click(screen.getByRole('button', { name: 'tavily actions' }));
    await user.click(await screen.findByText('remove provider…'));
    const again = await screen.findByRole('dialog');
    await user.click(within(again).getByRole('button', { name: 'remove provider' }));

    expect(rpcRemoveProvider).toHaveBeenCalledWith('tavily');
    await waitFor(() => expect(useMockAuth.getState().added).not.toContain('tavily'));
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
    await renderAuth();
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

  it('a backend detail renders the model editor, fed by the daemon-mirroring store', async () => {
    useModels.setState({
      lists: { claude: [{ id: 'claude-fable-5', label: 'fable 5', origin: 'default' }] },
      catalog: { claude: [{ id: 'claude-fable-5', label: 'fable 5', origin: 'default' }] },
    });
    await renderAuth();
    expect(await screen.findByText('models')).toBeTruthy();
    expect(screen.getByText('fable 5')).toBeTruthy();
  });

  it('a tool service page shows no models section — a pool has no models', async () => {
    const user = userEvent.setup();
    await renderAuth();
    await user.click(screen.getByRole('button', { name: /tavily/i }));
    await screen.findByText('keys');
    // The outgoing backend detail lingers through its exit cross-fade — wait it out.
    await waitFor(() => expect(screen.queryByText('models')).toBeNull());
  });

  it('wears the provider version in the subtitle where one applies', async () => {
    await renderAuth();
    expect(screen.getByText(/agent sdk 0\.72/)).toBeTruthy();
  });

  it('benches a provider by calling rpcSetProviderEnabled — credentials stay untouched', async () => {
    const user = userEvent.setup();
    await renderAuth();
    const benched: AuthView = { ...FIXTURE_VIEW, enabled: { ...FIXTURE_VIEW.enabled, tavily: false } };
    vi.mocked(rpcSetProviderEnabled).mockResolvedValue(benched);
    const before = useMockAuth.getState().credentials.length;

    await user.click(screen.getAllByRole('switch', { name: 'tavily enabled' })[0]!);

    expect(rpcSetProviderEnabled).toHaveBeenCalledWith('tavily', false);
    await waitFor(() => expect(useMockAuth.getState().enabled['tavily']).toBe(false));
    expect(useMockAuth.getState().credentials.length).toBe(before);
  });
});

describe('login health on the surface', () => {
  /** The fixture with the ACTIVE claude login flagged by the probe — the headline case:
   *  flagged, never auto-switched (SC-1). */
  const FLAGGED_VIEW: AuthView = {
    ...FIXTURE_VIEW,
    credentials: FIXTURE_VIEW.credentials.map((c) =>
      c.id === 'c1'
        ? { ...c, email: 'wormsegment1000@gmail.com', health: 'needs-relogin' as const }
        : c,
    ),
  };

  it('probes login health on mount — the surface never trusts yesterday’s verdict', async () => {
    vi.mocked(rpcProbeHealth).mockResolvedValue(FLAGGED_VIEW);
    await renderAuth();
    expect(rpcProbeHealth).toHaveBeenCalled();
    // The probe's view reprojects: the flagged row appears without a manual refresh.
    await waitFor(() =>
      expect(useMockAuth.getState().credentials.find((c) => c.id === 'c1')?.health).toBe(
        'needs-relogin',
      ),
    );
  });

  it('a needs-relogin row wears the amber state and a one-click re-login', async () => {
    vi.mocked(rpcProbeHealth).mockResolvedValue(FLAGGED_VIEW);
    await renderAuth(FLAGGED_VIEW);
    expect(await screen.findByText('active · needs relogin')).toBeTruthy();
    expect(screen.getByRole('button', { name: 're-login' })).toBeTruthy();
  });

  it('re-login starts the driven flow with the credential’s known email — no pre-step', async () => {
    const user = userEvent.setup();
    vi.mocked(rpcProbeHealth).mockResolvedValue(FLAGGED_VIEW);
    vi.mocked(rpcStartLogin).mockResolvedValue({
      phase: 'launching',
      mode: 'relogin',
      email: 'wormsegment1000@gmail.com',
    });
    await renderAuth(FLAGGED_VIEW);
    await user.click(await screen.findByRole('button', { name: 're-login' }));
    expect(rpcStartLogin).toHaveBeenCalledWith({
      email: 'wormsegment1000@gmail.com',
      credentialId: 'c1',
    });
  });

  it('a config-dir backend’s add path is the driven sign-in, email-first', async () => {
    await renderAuth();
    // The claude detail is the default (first backend) — its logins header carries the
    // driven entry point, not the manual "+ add login".
    expect(await screen.findByText('sign in with claude')).toBeTruthy();
    fireEvent.click(screen.getByText('sign in with claude'));
    expect(useShell.getState().loginEmailFor).toEqual({ providerId: 'claude' });
  });

  it('an email-defined login renders email-first; a nickname keeps the email in view', async () => {
    const view: AuthView = {
      ...FIXTURE_VIEW,
      credentials: FIXTURE_VIEW.credentials.map((c) =>
        c.id === 'c2'
          ? { ...c, label: 'school', email: 'alex@barba.edu', identity: 'alex@barba.edu · pro' }
          : c.id === 'c1'
            ? { ...c, label: 'worm@x.org', email: 'worm@x.org' }
            : c,
      ),
    };
    await renderAuth(view);
    // label === email ⇒ the email IS the first line (no doubled identity). It also rides
    // the provider list row's active-label slot, so multiple hits are expected.
    expect((await screen.findAllByText('worm@x.org')).length).toBeGreaterThan(0);
    // label differs ⇒ nickname first, the probe identity (carrying the email) beneath.
    expect(screen.getByText('school')).toBeTruthy();
    expect(screen.getByText('alex@barba.edu · pro')).toBeTruthy();
  });
});
