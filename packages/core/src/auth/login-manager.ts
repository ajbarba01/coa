import { isAbsolute, join, relative } from 'node:path';
import type { LoginDriverHandle, LoginDriverPort } from '@coa/spi';
import type { AccountsRegistry } from './registry.js';
import { mintAccountId } from './registry.js';

/**
 * The driven-login orchestrating state machine (core). Watches a rented CLI's
 * OAuth handshake via an injected `LoginDriverPort` (the adapter's pty driver +
 * managed-login-dir semantics — core never imports the adapter; the composition
 * root builds the driver and injects it) and folds the result into
 * the credential-blind `AccountsRegistry`. Also owns the generic health/identity
 * channel: a broken account is flagged (`needs-relogin`), never
 * auto-switched or blocked.
 */

/**
 * Pure: whether `dir` is a login directory coa itself created — inside its own
 * `~/.coa/logins` root, and not the root itself.
 *
 * The boundary that makes deleting-on-removal safe. An account added by
 * pointing at an existing config dir is the user's own data; coa may forget the row, but it
 * has no business deleting the directory. Anything it cannot positively claim it created is
 * left alone, so the failure mode is always "kept", never "destroyed".
 */
export function isManagedLoginDir(home: string, dir: string): boolean {
  const rel = relative(join(home, '.coa', 'logins'), dir);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export type LoginPhase =
  | 'launching'
  | 'awaiting'
  | 'watching'
  | 'registered'
  /** The dir was ALREADY authenticated when the flow started, so nothing this attempt did
   *  can be credited for it. Surfaced for a decision instead of reported as success. */
  | 'preexisting'
  | 'mismatch'
  | 'failed';
export type Health = 'healthy' | 'needs-relogin';

export interface LoginSnapshot {
  phase: LoginPhase;
  mode: 'new' | 'relogin';
  email: string; // the declared/requested email
  credentialId?: string; // relogin target
  oauthUrl?: string; // captured; absent while unknown or degraded
  ptyCaptured: boolean; // false ⇒ show "link unavailable" copy
  landedEmail?: string; // set on mismatch, and on preexisting (whoever the dir holds)
  identity?: string; // "email · plan" on registered
  error?: string; // set on failed
}

/** The isolation seam. Core asks; the composition root decides (setting, provider
 *  capability, detected browser) and never explains itself here. `openUrl` performs the real
 *  open; the url core hands it is the one it captured off the CLI's output, which the
 *  implementation treats as a FALLBACK — it prefers the url the `BROWSER` shim relayed,
 *  which completes without a pasted code. Fire-and-forget by contract. */
export interface BrowserSessionPort {
  launcherFor(email: string): string | undefined;
  openUrl(email: string, url: string): void;
  /** Drops the identity's jar. Used when a retry must not inherit the session that just
   *  landed the wrong account. */
  removeProfile(email: string): void;
}

type Identity = { email?: string; plan?: string };

/** The in-flight flow's private state (not part of the public snapshot shape). */
interface Flow {
  mode: 'new' | 'relogin';
  email: string;
  credentialId?: string;
  dir: string;
  accountId: string;
  handle: LoginDriverHandle;
  snapshot: LoginSnapshot;
  pollTimer?: ReturnType<typeof setInterval>;
  graceTimer?: ReturnType<typeof setTimeout>;
  probing: boolean;
  done: boolean;
  /** Whether a launcher was actually issued for THIS flow — the one thing that decides
   *  whether `openUrl` should ever fire. Carried here rather than re-asked of the port,
   *  because the port is free to answer differently on a later call (setting flipped
   *  mid-flow, say) and the flow must stay bound to what it started with. */
  isolated: boolean;
  /** Open-at-most-once guard: the CLI prints the authorize url more than once (once as
   *  "opening browser…", again as "if the browser didn't open, visit: …"), and both
   *  reach `onUrl`. A second open would put up a second window. */
  opened: boolean;
  /** Stashed on mismatch so `resolveMismatch('keep')` can finalize with the same plan. */
  mismatchStatus?: { loggedIn: boolean; email?: string; subscriptionType?: string };
  /** What the login dir looked like BEFORE this attempt touched it. A completion is only
   *  this attempt's to claim if the dir started `clean` — otherwise `loggedIn` is just the
   *  state a previous login left behind, which is not evidence of anything the user did
   *  here. `unknown` until the baseline probe answers; the poll waits for it. */
  baseline: 'unknown' | 'clean' | 'preexisting';
}

function unref(timer: { unref?: () => void }): void {
  timer.unref?.();
}

/** The registry label inside a `claude:<label>` credential id — everything after the
 *  first `:` (a label may itself contain `:`, though none do today). */
function labelOf(credentialId: string): string {
  const i = credentialId.indexOf(':');
  return i === -1 ? credentialId : credentialId.slice(i + 1);
}

const MAX_LABEL_SUFFIX = 100;

export class LoginManager {
  readonly #registry: AccountsRegistry;
  readonly #driver: LoginDriverPort;
  readonly #pollMs: number;
  readonly #browser: BrowserSessionPort | undefined;
  readonly #health = new Map<string, Health>();
  readonly #identity = new Map<string, Identity>();
  #flow: Flow | undefined;

  constructor(
    registry: AccountsRegistry,
    driver: LoginDriverPort,
    opts?: { pollMs?: number; browserSession?: BrowserSessionPort },
  ) {
    this.#registry = registry;
    this.#driver = driver;
    this.#pollMs = opts?.pollMs ?? 2000;
    this.#browser = opts?.browserSession;
  }

  startLogin(args: { email: string; credentialId?: string }): LoginSnapshot {
    this.#clearFlow();
    const dir = this.#resolveDir(args.email, args.credentialId);
    const mode: 'new' | 'relogin' = args.credentialId !== undefined ? 'relogin' : 'new';
    // The account's id has to exist BEFORE the handshake: a new account is only registered
    // once the login lands. A new flow mints one and carries it to registration; a relogin
    // reuses (or backfills) the account's own.
    const accountId = this.#resolveAccountId(args.credentialId);
    const launcher = this.#browser?.launcherFor(args.email);
    const handle = this.#driver.start({
      dir,
      email: args.email,
      ...(launcher !== undefined ? { browserLauncher: launcher } : {}),
    });
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
      accountId,
      handle,
      snapshot,
      probing: false,
      done: false,
      isolated: launcher !== undefined,
      opened: false,
      baseline: 'unknown',
      ...(args.credentialId !== undefined ? { credentialId: args.credentialId } : {}),
    };
    this.#flow = flow;

    handle.onUrl((url) => {
      if (flow.done) return;
      flow.snapshot = { ...flow.snapshot, phase: 'awaiting', oauthUrl: url };
      if (flow.isolated && !flow.opened) {
        // Set before the call, not after: the "at most once" guarantee has to hold even
        // if the port itself throws (see the catch below).
        flow.opened = true;
        try {
          this.#browser?.openUrl(flow.email, url);
        } catch {
          // A failed open is a no-op into the flow — copy-link + paste-code still works.
        }
      }
    });
    handle.onExit((code) => {
      if (flow.done) return;
      this.#onExit(flow, code);
    });

    this.#establishBaseline(flow);
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
    const phase = flow?.snapshot.phase;
    if (flow === undefined || (phase !== 'mismatch' && phase !== 'preexisting')) {
      return this.snapshot();
    }
    const landedEmail = flow.snapshot.landedEmail;
    // Retrying a dir that is already signed in would land the same credentials again — the
    // way out is to keep it or cancel, not to loop. Signing that dir out is the user's own
    // action, deliberately not coa's.
    if (action === 'retry' && phase === 'preexisting') return this.snapshot();
    if (action === 'retry') {
      // The jar now holds the session that landed the WRONG account, so a retry that reused
      // it would land the same one again. Keying by identity means the retry gets the same
      // directory back, so it has to be emptied rather than abandoned.
      try {
        this.#browser?.removeProfile(flow.email);
      } catch {
        // A jar we cannot clear costs a repeat mismatch, never the login.
      }
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

  /** The dir a login flow should target. A relogin (`credentialId` present) must land in
   *  the account's OWN config dir — a manually-added account's dir need not match
   *  `dirFor(email)` (its slug), so re-deriving from the email would log into the wrong
   *  dir while `#complete` marks the real, still-logged-out dir healthy. Falls back to
   *  `dirFor(email)` when the account is gone or its locator isn't a config-dir. */
  #resolveDir(email: string, credentialId: string | undefined): string {
    if (credentialId !== undefined) {
      const label = labelOf(credentialId);
      const account = this.#registry.list().find((a) => a.label === label);
      if (account?.locator.type === 'config-dir') return account.locator.dir;
    }
    return this.#driver.dirFor(email);
  }

  /** A relogin reuses (and lazily backfills) the account's own id; a new flow mints
   *  one up front so the browser profile has something to be keyed by before the
   *  account exists (see the comment in `startLogin`). */
  #resolveAccountId(credentialId: string | undefined): string {
    if (credentialId !== undefined) {
      const existing = this.#registry.ensureId(labelOf(credentialId));
      if (existing !== undefined) return existing;
    }
    return mintAccountId();
  }

  /**
   * Probe the login dir once, concurrently with the spawn, to learn whether it was already
   * authenticated before this attempt began. Racing the spawn is safe: the only way the CLI
   * could beat this probe is by completing a browser handshake in less time than one
   * `auth status` call, which a human cannot do.
   *
   * A dir that is already signed in ends the flow then and there — the CLI is killed so no
   * handshake is left running for a decision, and the browser open is suppressed. Nothing is
   * registered until the user says to use it.
   */
  #establishBaseline(flow: Flow): void {
    void this.#driver
      .probe(flow.dir)
      .then((status) => {
        if (flow.done || flow.baseline !== 'unknown') return;
        if (status?.loggedIn !== true) {
          flow.baseline = 'clean';
          return;
        }
        flow.baseline = 'preexisting';
        // Nothing is waiting on the handshake now, and an unattended CLI would keep a
        // browser window alive for a login the user has not agreed to.
        flow.opened = true;
        this.#stopPolling(flow);
        try {
          flow.handle.kill();
        } catch {
          // A CLI we cannot kill is a stray process, never a failed flow.
        }
        flow.mismatchStatus = status;
        flow.snapshot = {
          ...flow.snapshot,
          phase: 'preexisting',
          ...(status.email !== undefined ? { landedEmail: status.email } : {}),
        };
      })
      .catch(() => {
        // A baseline we cannot establish must not strand the flow: treat the dir as clean
        // and let the poll behave exactly as it did before.
        if (flow.baseline === 'unknown') flow.baseline = 'clean';
      });
  }

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
      // Only a dir that STARTED clean can credit this attempt for being logged in now.
      // `unknown` means the baseline probe has not answered yet — wait for it rather than
      // finalize on a state that may predate the flow entirely.
      if (status?.loggedIn === true && flow.baseline === 'clean') {
        this.#stopPolling(flow);
        this.#finalize(flow, status);
        return;
      }
      if (flow.baseline === 'preexisting') return;
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

  /**
   * The single funnel every probe-driven completion passes through — the poll, and the grace
   * probe the CLI's exit schedules. The baseline verdict is enforced HERE rather than at each
   * caller: guarding only the poll left the exit path free to register a session that predated
   * the flow, which is the bug this shape exists to prevent. The user's
   * explicit "use it" goes to {@link #complete} directly and is deliberately unaffected.
   */
  #finalize(
    flow: Flow,
    status: { loggedIn: boolean; email?: string; subscriptionType?: string },
  ): void {
    if (flow.baseline !== 'clean') return;
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
      let suffix = 2;
      for (;;) {
        try {
          this.#registry.add(
            label,
            { type: 'config-dir', dir: flow.dir },
            'claude',
            email,
            flow.accountId,
          );
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Only a genuine label collision is worth retrying under a numeric suffix —
          // anything else (permissions, a corrupt file) would retry forever and never
          // land, so it fails the flow instead of looping (bounded too: a runaway
          // collision count is itself a sign something's wrong, not real contention).
          if (!message.includes('account already exists') || suffix > MAX_LABEL_SUFFIX) {
            flow.snapshot = { ...flow.snapshot, phase: 'failed', error: message };
            return;
          }
          label = `${email}-${suffix}`;
          suffix += 1;
        }
      }
      this.#registry.setActive(label);
      credentialId = `claude:${label}`;
    } else {
      credentialId = flow.credentialId ?? `claude:${email}`;
      this.#health.set(credentialId, 'healthy');
      try {
        // Always backfill the DECLARED email under the landed/completed one — a keep
        // resolution over a mismatch must overwrite a stale declared email too, or every
        // future relogin pre-fills the old one and re-mismatches forever.
        this.#registry.setEmail(labelOf(credentialId), email);
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
