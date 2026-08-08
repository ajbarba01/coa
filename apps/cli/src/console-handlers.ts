import { homedir } from 'node:os';
import {
  AccountsRegistry,
  BrowserSession,
  buildAuthHandlers,
  buildConsoleHandlers,
  ConsoleStateStore,
  KeyStateStore,
  LoginManager,
  WebConfigStore,
  type DaemonCoreHandle,
  type RpcHandlers,
} from '@coa/core';
import type { LoginDriverPort } from '@coa/spi';

/** The plumbing the console handlers consume but core must not construct itself. */
export interface DaemonConsoleDeps {
  /**
   * The rented CLI's driven-login plumbing (pty spawn + auth probe), built over the
   * backend package. Absent ⇒ no login manager is constructed and every login verb
   * degrades to its idle floor (auth reads, account verbs, and key management still
   * work).
   */
  loginDriver?: LoginDriverPort;
  /** The home the `~/.coa` stores live under; a test seam (defaults to the user's home). */
  home?: string;
}

/**
 * Bind the daemon's live singletons to the inspector + auth handler map the
 * JSON-RPC router serves — the seam between the daemon core and the console's
 * reads. The inspector half is pure projection (each port reads an existing
 * surface: cost state, flag user feed); the auth half needs the user's on-disk
 * stores and the driven-login manager, which is why this composition lives in the
 * app rather than in core: core declares the ports, the binary decides that they
 * are files under `~/.coa` and a pty over the rented CLI. The transport layer
 * (socket/pipe + peer-cred) calls `dispatch(message, handlers)` with this map.
 */
export function buildDaemonConsoleHandlers(
  handle: DaemonCoreHandle,
  deps: DaemonConsoleDeps = {},
): RpcHandlers {
  const home = deps.home ?? homedir();
  const accounts = new AccountsRegistry(home);
  const consoleState = new ConsoleStateStore(home);
  // The one place the three isolation facts meet: the user's setting, the provider's
  // declared capability, and what browser this machine actually has.
  const browser = new BrowserSession({
    home,
    platform: process.platform,
    env: process.env,
    settings: () => {
      const state = consoleState.read();
      return {
        enabled: state.isolatedBrowserLogins,
        ...(state.browserPath !== undefined ? { browserPath: state.browserPath } : {}),
      };
    },
  });
  const loginManager =
    deps.loginDriver === undefined
      ? undefined
      : new LoginManager(accounts, deps.loginDriver, {
          browserSession: {
            launcherFor: (email) => browser.launcherFor('claude', email),
            // Fire-and-forget: the open waits briefly for the shim's relayed url, and a login
            // must never block on a browser window.
            openUrl: (email, url) => void browser.openUrl('claude', email, url),
            removeProfile: (email) => browser.removeProfile(email),
          },
        });
  return {
    ...buildConsoleHandlers({
      capState: (sessionId) => handle.governance.capState(sessionId),
      flagsForUser: (scope) => handle.flags.flagsForUser(scope),
      listTimeline: () => handle.kernel.listTimeline(),
    }),
    ...buildAuthHandlers({
      accounts,
      web: new WebConfigStore(home),
      keys: new KeyStateStore(home),
      console: consoleState,
      ...(loginManager !== undefined ? { loginManager } : {}),
      browser,
    }),
  };
}
