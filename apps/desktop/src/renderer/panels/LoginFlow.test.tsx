// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShell } from '../shell/store.js';

// The dialog reaches the daemon only through the rpc wrappers — stubbed here so
// every flow action resolves a crafted `LoginSnapshot` instead of a real IPC round trip.
// (The daemon's own suite pins what the verbs DO; this file pins what the dialog SHOWS.)
const rpc = vi.hoisted(() => ({
  rpcStartLogin: vi.fn(),
  rpcLoginState: vi.fn(),
  rpcSubmitLoginCode: vi.fn(),
  rpcCancelLogin: vi.fn().mockResolvedValue({ phase: 'idle' }),
  rpcResolveLoginMismatch: vi.fn(),
  rpcProbeHealth: vi.fn(),
  rpcReportAuthFailure: vi.fn(),
}));
vi.mock('./rpc.js', () => rpc);
// Same stub-store shape as `hydrate` was (loginStore's `apply` calls it on every finalize),
// widened to also carry the isolated-browser-session read the pre-step now projects — a
// minimal double, not the real daemon-backed store.
const authState = vi.hoisted(() => ({
  hydrate: vi.fn().mockResolvedValue(undefined),
  browserSession: { enabled: false, available: false },
}));
type AuthStateStub = typeof authState;
vi.mock('./authStore.js', () => ({
  useAuthStore: Object.assign((selector: (s: AuthStateStub) => boolean) => selector(authState), {
    getState: () => authState,
    setState: (partial: Partial<AuthStateStub>) => Object.assign(authState, partial),
  }),
}));

import { useLogin } from './loginStore.js';
import { LoginDialog, SignInButton } from './LoginFlow.js';
import { useAuthStore } from './authStore.js';
import { PROVIDERS } from './providers.js';

const claude = PROVIDERS.find((p) => p.id === 'claude');
if (claude === undefined) throw new Error('claude missing from the provider registry');

const SHELL_SEED = useShell.getState();

/** The file's one way of opening the email-first step: the driven sign-in button, same as
 *  a person clicks. No second path to keep in sync with it. */
function renderEmailStep(): void {
  render(
    <>
      <SignInButton provider={claude} />
      <LoginDialog />
    </>,
  );
  fireEvent.click(screen.getByText(/^sign in$/i));
}

describe('the driven login dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLogin.setState({ flow: undefined });
    useShell.setState(SHELL_SEED, true);
    useAuthStore.setState({ browserSession: { enabled: false, available: false } });
  });

  it('sign in opens the email-first step and starts the flow with the email', () => {
    rpc.rpcStartLogin.mockResolvedValue({ phase: 'launching', mode: 'new', email: 'a@x.org' });
    render(
      <>
        <SignInButton provider={claude} />
        <LoginDialog />
      </>,
    );
    fireEvent.click(screen.getByText(/^sign in$/i));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.org' } });
    fireEvent.click(screen.getByText(/continue/i));
    expect(rpc.rpcStartLogin).toHaveBeenCalledWith({ email: 'a@x.org' });
  });

  describe('the email pre-step', () => {
    it('names the dedicated profile in the pre-step when isolation is live', () => {
      useAuthStore.setState({ browserSession: { enabled: true, available: true } });
      renderEmailStep();
      expect(screen.getByText(/its own browser profile/i)).toBeTruthy();
    });

    it('keeps today’s copy when isolation is off', () => {
      useAuthStore.setState({ browserSession: { enabled: false, available: false } });
      renderEmailStep();
      expect(screen.getByText(/opens in your browser/i)).toBeTruthy();
    });
  });

  it('awaiting shows the captured url with a copy affordance', () => {
    useLogin.setState({
      flow: {
        phase: 'awaiting',
        mode: 'new',
        email: 'a@x.org',
        oauthUrl: 'https://claude.com/cai/oauth/x',
        ptyCaptured: true,
      },
    });
    render(<LoginDialog />);
    expect(screen.getByText('https://claude.com/cai/oauth/x')).toBeInTheDocument();
    expect(screen.getByText(/^copy link$/i)).toBeInTheDocument();
  });

  /** Removing an account leaves the login's credentials on disk, so re-adding the same email
   *  can find a dir that is ALREADY signed in. Reporting that as a successful handshake was
   *  the defect — the user had closed the browser without authorizing. It is a decision now,
   *  and the copy has to say that nothing was just signed in. */
  it('a pre-existing session asks to be used instead of claiming a login', () => {
    useLogin.setState({
      flow: {
        phase: 'preexisting',
        mode: 'new',
        email: 'a@x.org',
        landedEmail: 'old@x.org',
        ptyCaptured: true,
      },
    });
    render(<LoginDialog />);
    expect(screen.getByText(/already signed in as old@x.org/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing was signed in just now/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use old@x.org/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    // Retrying would land the same credentials again — it is not offered.
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('degraded capture says so instead of showing an empty link box', () => {
    useLogin.setState({
      flow: { phase: 'awaiting', mode: 'new', email: 'a@x.org', ptyCaptured: false },
    });
    render(<LoginDialog />);
    expect(screen.getByText(/not available on this system/i)).toBeInTheDocument();
  });

  /** The code field used to hide behind a disclosure click. It is reachable the moment the
   *  CLI could ask for a code, because that is exactly when hunting for it is worst. */
  it('offers the code field without making the user reveal it first', () => {
    useLogin.setState({
      flow: {
        phase: 'awaiting',
        mode: 'new',
        email: 'a@x.org',
        oauthUrl: 'https://claude.com/cai/oauth/x',
        ptyCaptured: true,
      },
    });
    render(<LoginDialog />);
    expect(screen.getByLabelText(/^authorization code$/i)).toBeInTheDocument();
    expect(screen.queryByText(/prompted for a code instead/)).not.toBeInTheDocument();
  });

  /** The browser handshake is the primary action — the dialog must not pull focus into a
   *  field the user usually never touches. */
  it('does not steal focus into the code field', () => {
    useLogin.setState({
      flow: { phase: 'awaiting', mode: 'new', email: 'a@x.org', ptyCaptured: true },
    });
    render(<LoginDialog />);
    expect(screen.getByLabelText(/^authorization code$/i)).not.toBe(document.activeElement);
  });

  it('mismatch offers keep-landed and try-again, never a block', () => {
    rpc.rpcResolveLoginMismatch.mockResolvedValue({ phase: 'registered', identity: 'b@x.org' });
    useLogin.setState({
      flow: { phase: 'mismatch', mode: 'new', email: 'a@x.org', landedEmail: 'b@x.org' },
    });
    render(<LoginDialog />);
    expect(screen.getByText(/signed in as b@x.org/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/^keep b@x.org$/i));
    expect(rpc.rpcResolveLoginMismatch).toHaveBeenCalledWith('keep');
  });
});
