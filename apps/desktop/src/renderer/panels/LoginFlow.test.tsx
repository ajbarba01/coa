// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShell } from '../shell/store.js';

// The dialog reaches the daemon only through the console.ts rpc wrappers — stubbed here so
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
vi.mock('../console.js', () => rpc);
const hydrate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./mockAuth.js', () => ({ useMockAuth: { getState: () => ({ hydrate }) } }));

import { useLogin } from './loginStore.js';
import { LoginDialog, SignInButton } from './LoginFlow.js';
import { PROVIDERS } from './providers.js';

const claude = PROVIDERS.find((p) => p.id === 'claude');
if (claude === undefined) throw new Error('claude missing from the provider registry');

const SHELL_SEED = useShell.getState();

describe('the driven login dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLogin.setState({ flow: undefined });
    useShell.setState(SHELL_SEED, true);
  });

  it('sign in opens the email-first step and starts the flow with the email', () => {
    rpc.rpcStartLogin.mockResolvedValue({ phase: 'launching', mode: 'new', email: 'a@x.org' });
    render(
      <>
        <SignInButton provider={claude} />
        <LoginDialog />
      </>,
    );
    fireEvent.click(screen.getByText('sign in'));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.org' } });
    fireEvent.click(screen.getByText(/continue/i));
    expect(rpc.rpcStartLogin).toHaveBeenCalledWith({ email: 'a@x.org' });
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
    expect(screen.getByText('copy link')).toBeInTheDocument();
  });

  it('degraded capture says so instead of showing an empty link box', () => {
    useLogin.setState({
      flow: { phase: 'awaiting', mode: 'new', email: 'a@x.org', ptyCaptured: false },
    });
    render(<LoginDialog />);
    expect(screen.getByText(/isn't available on this system/)).toBeInTheDocument();
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
    expect(screen.getByLabelText('authorization code')).toBeInTheDocument();
    expect(screen.queryByText(/prompted for a code instead/)).not.toBeInTheDocument();
  });

  /** The browser handshake is the primary action — the dialog must not pull focus into a
   *  field the user usually never touches. */
  it('does not steal focus into the code field', () => {
    useLogin.setState({
      flow: { phase: 'awaiting', mode: 'new', email: 'a@x.org', ptyCaptured: true },
    });
    render(<LoginDialog />);
    expect(screen.getByLabelText('authorization code')).not.toBe(document.activeElement);
  });

  it('mismatch offers keep-landed and try-again, never a block', () => {
    rpc.rpcResolveLoginMismatch.mockResolvedValue({ phase: 'registered', identity: 'b@x.org' });
    useLogin.setState({
      flow: { phase: 'mismatch', mode: 'new', email: 'a@x.org', landedEmail: 'b@x.org' },
    });
    render(<LoginDialog />);
    expect(screen.getByText(/signed in as b@x.org/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('keep b@x.org'));
    expect(rpc.rpcResolveLoginMismatch).toHaveBeenCalledWith('keep');
  });
});
