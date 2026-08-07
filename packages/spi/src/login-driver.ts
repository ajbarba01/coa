/**
 * The driven-login capability port — the narrow surface the core's login state
 * machine consumes to watch a rented CLI's OAuth handshake. The concrete
 * implementation (pty spawn + auth-status probe + managed-login-dir layout) lives
 * in the backend package and is injected by the composition root; the core never
 * imports it. Absent driver ⇒ the auth surface degrades to its idle floor.
 */

/** One live login attempt: the spawned CLI's observable events + control surface. */
export interface LoginDriverHandle {
  onUrl(fn: (url: string) => void): void;
  onExit(fn: (code: number | undefined) => void): void;
  writeCode(code: string): void;
  kill(): void;
  /** False ⇒ the pty capture failed and no OAuth url will ever be observed ("link unavailable" copy). */
  readonly ptyCaptured: boolean;
}

export interface LoginDriverPort {
  /** `browserLauncher`, when present, is the courier shim: it displaces the rented CLI's own
   *  default-browser open and writes down the authorize url the CLI would have opened, which
   *  is the one that completes without a pasted code. Absent ⇒ the spawn is
   *  exactly today's. */
  start(opts: { dir: string; email: string; browserLauncher?: string }): LoginDriverHandle;
  /** Probe a login dir's auth state; `undefined` = unknown (never a verdict). */
  probe(
    dir: string,
  ): Promise<{ loggedIn: boolean; email?: string; subscriptionType?: string } | undefined>;
  home: string;
  /** The managed login dir a fresh login for this identity should target. */
  dirFor(email: string): string;
}
