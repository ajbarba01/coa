import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above this file's imports, so a factory that closes over an
// outer `const` throws (TDZ) unless that const is itself built through `vi.hoisted`
// (the standard escape hatch — see modelsStore.test.ts for the sibling idiom of
// mocking bare, then aliasing via `vi.mocked` after import; this file's brief calls
// for a single `rpc` object instead, so `vi.hoisted` is the fit).
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
// A mutable stand-in for the auth store's state, so `hydrate` can simulate populating
// `activeByProvider` the way the real store's `apply()` does on a real `authView` read.
const authState = vi.hoisted(() => ({ activeByProvider: {} as Record<string, string> }));
const hydrate = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./mockAuth.js', () => ({
  useMockAuth: { getState: () => ({ activeByProvider: authState.activeByProvider, hydrate }) },
}));

import {
  providerAttention,
  totalAttention,
  activeNeedsRelogin,
  reportActiveClaudeAuthFailure,
  useLogin,
} from './loginStore.js';

/** Flush the microtask queue past a couple of chained `.then()`s. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const cred = (id: string, providerId: string, health?: 'healthy' | 'needs-relogin') => ({
  id,
  providerId,
  label: id,
  masked: '',
  disabled: false,
  ...(health !== undefined ? { health } : {}),
});

describe('badge derivation over the view', () => {
  const creds = [
    cred('claude:a', 'claude', 'needs-relogin'),
    cred('claude:b', 'claude', 'healthy'),
    cred('deepseek:k', 'deepseek'),
  ];
  it('counts needs-relogin per provider and in total', () => {
    expect(providerAttention(creds, 'claude')).toBe(1);
    expect(providerAttention(creds, 'deepseek')).toBe(0);
    expect(totalAttention(creds)).toBe(1);
  });
  it('flags a broken ACTIVE account', () => {
    expect(activeNeedsRelogin({ claude: 'claude:a' }, 'claude', creds)).toBe(true);
    expect(activeNeedsRelogin({ claude: 'claude:b' }, 'claude', creds)).toBe(false);
  });
});

describe('useLogin', () => {
  beforeEach(() => {
    useLogin.setState({ flow: undefined });
    vi.clearAllMocks();
  });

  it('startLogin projects the returned snapshot', async () => {
    rpc.rpcStartLogin.mockResolvedValue({ phase: 'launching', mode: 'new', email: 'a@x.org' });
    await useLogin.getState().startLogin({ providerId: 'claude', mode: 'new', email: 'a@x.org' });
    expect(useLogin.getState().flow?.phase).toBe('launching');
  });

  it('poll reprojects; entering registered rehydrates the auth store; idle clears', async () => {
    useLogin.setState({ flow: { phase: 'watching', mode: 'new', email: 'a@x.org' } });
    rpc.rpcLoginState.mockResolvedValue({ phase: 'registered', identity: 'a@x.org · pro' });
    await useLogin.getState().poll();
    expect(useLogin.getState().flow?.phase).toBe('registered');
    expect(hydrate).toHaveBeenCalled();
    rpc.rpcLoginState.mockResolvedValue({ phase: 'idle' });
    await useLogin.getState().poll();
    expect(useLogin.getState().flow).toBeUndefined();
  });
});

describe('reportActiveClaudeAuthFailure', () => {
  beforeEach(() => {
    authState.activeByProvider = {};
    vi.clearAllMocks();
    rpc.rpcReportAuthFailure.mockResolvedValue({});
  });

  it('reports directly when the auth store already has an active claude id', async () => {
    authState.activeByProvider = { claude: 'claude:already' };
    reportActiveClaudeAuthFailure();
    await flush();
    expect(rpc.rpcReportAuthFailure).toHaveBeenCalledWith('claude:already');
  });

  it('hydrates first when the store has not hydrated yet this run, then reports the hydrated id', async () => {
    hydrate.mockImplementationOnce(async () => {
      authState.activeByProvider = { claude: 'claude:hydrated' };
    });
    reportActiveClaudeAuthFailure();
    await flush();
    expect(hydrate).toHaveBeenCalled();
    expect(rpc.rpcReportAuthFailure).toHaveBeenCalledWith('claude:hydrated');
  });

  it('stays a silent no-op when the id is genuinely absent even after hydrating', async () => {
    reportActiveClaudeAuthFailure();
    await flush();
    expect(hydrate).toHaveBeenCalled();
    expect(rpc.rpcReportAuthFailure).not.toHaveBeenCalled();
  });
});
