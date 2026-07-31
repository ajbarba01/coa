import type { AccountsRegistry } from './registry.js';

/**
 * The driven-login orchestrating state machine (core). Watches a rented CLI's
 * OAuth handshake via an injected `LoginDriverPort` (the adapter's pty driver +
 * managed-login-dir semantics — core never imports the adapter directly, keeping
 * the adapter import surface at the composition root) and folds the result into
 * the credential-blind `AccountsRegistry`. Also owns the generic health/identity
 * channel: SC-1 means a broken account is flagged (`needs-relogin`), never
 * auto-switched or blocked.
 */

export type LoginPhase = 'launching' | 'awaiting' | 'watching' | 'registered' | 'mismatch' | 'failed';
export type Health = 'healthy' | 'needs-relogin';

export interface LoginSnapshot {
  phase: LoginPhase;
  mode: 'new' | 'relogin';
  email: string; // the declared/requested email
  credentialId?: string; // relogin target
  oauthUrl?: string; // captured; absent while unknown or degraded
  ptyCaptured: boolean; // false ⇒ show "link unavailable" copy
  landedEmail?: string; // set on mismatch
  identity?: string; // "email · plan" on registered
  error?: string; // set on failed
}

export interface LoginDriverHandle {
  onUrl(fn: (url: string) => void): void;
  onExit(fn: (code: number | undefined) => void): void;
  writeCode(code: string): void;
  kill(): void;
  readonly ptyCaptured: boolean;
}

export interface LoginDriverPort {
  start(opts: { dir: string; email: string }): LoginDriverHandle;
  probe(dir: string): Promise<{ loggedIn: boolean; email?: string; subscriptionType?: string } | undefined>;
  home: string;
  dirFor(email: string): string; // managedLoginDir(home, email)
}

type Identity = { email?: string; plan?: string };

/** The in-flight flow's private state (not part of the public snapshot shape). */
interface Flow {
  mode: 'new' | 'relogin';
  email: string;
  credentialId?: string;
  dir: string;
  handle: LoginDriverHandle;
  snapshot: LoginSnapshot;
  pollTimer?: ReturnType<typeof setInterval>;
  graceTimer?: ReturnType<typeof setTimeout>;
  probing: boolean;
  done: boolean;
  /** Stashed on mismatch so `resolveMismatch('keep')` can finalize with the same plan. */
  mismatchStatus?: { loggedIn: boolean; email?: string; subscriptionType?: string };
}

function unref(timer: { unref?: () => void }): void {
  timer.unref?.();
}

export class LoginManager {
  readonly #registry: AccountsRegistry;
  readonly #driver: LoginDriverPort;
  readonly #pollMs: number;
  readonly #health = new Map<string, Health>();
  readonly #identity = new Map<string, Identity>();
  #flow: Flow | undefined;

  constructor(registry: AccountsRegistry, driver: LoginDriverPort, opts?: { pollMs?: number }) {
    this.#registry = registry;
    this.#driver = driver;
    this.#pollMs = opts?.pollMs ?? 2000;
  }

  startLogin(args: { email: string; credentialId?: string }): LoginSnapshot {
    this.#clearFlow();
    const dir = this.#driver.dirFor(args.email);
    const mode: 'new' | 'relogin' = args.credentialId !== undefined ? 'relogin' : 'new';
    const handle = this.#driver.start({ dir, email: args.email });
    const snapshot: LoginSnapshot = {
      phase: 'launching',
      mode,
      email: args.email,
      ptyCaptured: handle.ptyCaptured,
      ...(args.credentialId !== undefined ? { credentialId: args.credentialId } : {}),
    };
    const flow: Flow = {
      mode,
      email: args.email,
      dir,
      handle,
      snapshot,
      probing: false,
      done: false,
      ...(args.credentialId !== undefined ? { credentialId: args.credentialId } : {}),
    };
    this.#flow = flow;

    handle.onUrl((url) => {
      if (flow.done) return;
      flow.snapshot = { ...flow.snapshot, phase: 'awaiting', oauthUrl: url };
    });
    handle.onExit((code) => {
      if (flow.done) return;
      this.#onExit(flow, code);
    });

    this.#startPolling(flow);
    return { ...flow.snapshot };
  }

  submitCode(code: string): void {
    this.#flow?.handle.writeCode(code);
  }

  cancelLogin(): void {
    this.#clearFlow();
  }

  resolveMismatch(action: 'keep' | 'retry'): LoginSnapshot | undefined {
    const flow = this.#flow;
    if (flow === undefined || flow.snapshot.phase !== 'mismatch') return this.snapshot();
    const landedEmail = flow.snapshot.landedEmail;
    if (action === 'retry') {
      // #clearFlow (called by startLogin below) does the one kill — don't double-kill here.
      return this.startLogin({
        email: flow.email,
        ...(flow.credentialId !== undefined ? { credentialId: flow.credentialId } : {}),
      });
    }
    // keep: finalize under the landed email.
    if (landedEmail === undefined) return this.snapshot();
    this.#complete(flow, landedEmail, undefined);
    return this.snapshot();
  }

  snapshot(): LoginSnapshot | undefined {
    return this.#flow === undefined ? undefined : { ...this.#flow.snapshot };
  }

  healthOf(credentialId: string): Health | undefined {
    return this.#health.get(credentialId);
  }

  identityOf(credentialId: string): Identity | undefined {
    return this.#identity.get(credentialId);
  }

  reportAuthFailure(credentialId: string): void {
    this.#health.set(credentialId, 'needs-relogin');
  }

  async probeAll(): Promise<void> {
    const accounts = this.#registry
      .listByProvider('claude')
      .filter((a) => a.locator.type === 'config-dir');
    for (const account of accounts) {
      const credentialId = `claude:${account.label}`;
      const dir = account.locator.type === 'config-dir' ? account.locator.dir : undefined;
      if (dir === undefined) continue;
      const status = await this.#driver.probe(dir);
      if (status === undefined) continue; // unknown is not a verdict
      if (!status.loggedIn) {
        this.#health.set(credentialId, 'needs-relogin');
        continue;
      }
      this.#health.set(credentialId, 'healthy');
      this.#identity.set(credentialId, {
        ...(status.email !== undefined ? { email: status.email } : {}),
        ...(status.subscriptionType !== undefined ? { plan: status.subscriptionType } : {}),
      });
      if (status.email !== undefined && account.email === undefined) {
        try {
          this.#registry.setEmail(account.label, status.email);
        } catch {
          // account may have been removed mid-sweep; nothing to backfill.
        }
      }
    }
  }

  // ---- internals ----

  #startPolling(flow: Flow): void {
    const timer = setInterval(() => {
      void this.#pollOnce(flow);
    }, this.#pollMs);
    unref(timer);
    flow.pollTimer = timer;
  }

  async #pollOnce(flow: Flow): Promise<void> {
    if (flow.probing || flow.done) return;
    flow.probing = true;
    try {
      const status = await this.#driver.probe(flow.dir);
      if (flow.done) return;
      if (status?.loggedIn === true) {
        this.#stopPolling(flow);
        this.#finalize(flow, status);
        return;
      }
      // The probe didn't finalize the flow. Refresh ptyCaptured from the live handle:
      // the real driver's capture flips true ASYNCHRONOUSLY (a dynamic `import('node-pty')`
      // resolving after spawn), so a snapshot taken at start can be stale.
      flow.snapshot = { ...flow.snapshot, ptyCaptured: flow.handle.ptyCaptured };
      // A degraded driver (no pty) never fires onUrl — the CLI has no pipe to print the
      // OAuth URL to. But the spike confirms the browser still auto-opens even degraded,
      // so once we know capture failed, "awaiting" with no URL is the honest state: it's
      // what lets the renderer show its degraded "link unavailable" copy instead of
      // sitting silently at "launching" forever.
      if (flow.snapshot.phase === 'launching' && !flow.handle.ptyCaptured) {
        flow.snapshot = { ...flow.snapshot, phase: 'awaiting' };
      }
    } finally {
      flow.probing = false;
    }
  }

  #stopPolling(flow: Flow): void {
    if (flow.pollTimer !== undefined) {
      clearInterval(flow.pollTimer);
      delete flow.pollTimer;
    }
    if (flow.graceTimer !== undefined) {
      clearTimeout(flow.graceTimer);
      delete flow.graceTimer;
    }
  }

  #onExit(flow: Flow, _code: number | undefined): void {
    // Exit is not failure by itself — the browser handshake may still be pending.
    // Stop polling on the normal cadence and give it one grace probe instead.
    this.#stopPolling(flow);
    const timer = setTimeout(() => {
      void this.#graceProbe(flow);
    }, this.#pollMs);
    unref(timer);
    flow.graceTimer = timer;
  }

  async #graceProbe(flow: Flow): Promise<void> {
    if (flow.done) return;
    const status = await this.#driver.probe(flow.dir);
    if (flow.done) return;
    if (status?.loggedIn === true) {
      this.#finalize(flow, status);
      return;
    }
    if (status?.loggedIn === false) {
      flow.done = true;
      flow.snapshot = { ...flow.snapshot, phase: 'failed' };
      return;
    }
    // status undefined: unknown is not a verdict — don't conclude the flow, just
    // resume the normal poll cadence (the exit stopped it) so a later probe can
    // still finalize. The user can always cancel.
    this.#startPolling(flow);
  }

  #finalize(
    flow: Flow,
    status: { loggedIn: boolean; email?: string; subscriptionType?: string },
  ): void {
    if (status.email !== undefined && status.email !== flow.email) {
      flow.done = true;
      flow.snapshot = { ...flow.snapshot, phase: 'mismatch', landedEmail: status.email };
      // Stash the raw status so `resolveMismatch('keep')` can finalize with the plan too.
      flow.mismatchStatus = status;
      return;
    }
    this.#complete(flow, status.email ?? flow.email, status.subscriptionType);
  }

  #complete(flow: Flow, email: string, plan: string | undefined): void {
    flow.done = true;
    this.#stopPolling(flow);
    const resolvedPlan = plan ?? flow.mismatchStatus?.subscriptionType;

    let credentialId: string;
    if (flow.mode === 'new') {
      let label = email;
      let n = 2;
      while (true) {
        try {
          this.#registry.add(label, { type: 'config-dir', dir: flow.dir }, 'claude', email);
          break;
        } catch {
          label = `${email}-${n}`;
          n += 1;
        }
      }
      this.#registry.setActive(label);
      credentialId = `claude:${label}`;
    } else {
      credentialId = flow.credentialId ?? `claude:${email}`;
      this.#health.set(credentialId, 'healthy');
      try {
        const label = credentialId.startsWith('claude:') ? credentialId.slice('claude:'.length) : credentialId;
        const account = this.#registry.list().find((a) => a.label === label);
        if (account !== undefined && account.email === undefined) {
          this.#registry.setEmail(label, email);
        }
      } catch {
        // account may have been removed mid-flow; nothing to backfill.
      }
    }

    this.#identity.set(credentialId, {
      email,
      ...(resolvedPlan !== undefined ? { plan: resolvedPlan } : {}),
    });
    flow.snapshot = {
      ...flow.snapshot,
      phase: 'registered',
      identity: resolvedPlan === undefined ? email : `${email} · ${resolvedPlan}`,
    };
  }

  #clearFlow(): void {
    const flow = this.#flow;
    if (flow === undefined) return;
    flow.done = true;
    this.#stopPolling(flow);
    flow.handle.kill();
    this.#flow = undefined;
  }
}
