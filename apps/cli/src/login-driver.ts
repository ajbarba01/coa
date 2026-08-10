import type { LoginDriverPort } from '@coa/spi';
import {
  extractOauthUrl,
  managedLoginDir,
  probeAuthStatus,
  spawnLogin,
} from '@coa/adapter-claude-sdk';

/**
 * The rented CLI's driven-login plumbing (pty spawn + auth-status probe +
 * managed-login-dir layout), wrapped in the neutral {@link LoginDriverPort} the
 * core's login manager consumes. Constructed here because it imports the backend
 * package — the composition root is the one place that does.
 */
export function buildClaudeLoginDriver(home: string): LoginDriverPort {
  return {
    home,
    dirFor: (email) => managedLoginDir(home, email),
    probe: async (dir) => {
      // Rebuild by omission (exactOptionalPropertyTypes) — the probe's zod-inferred
      // status allows an explicit `undefined` per optional field and carries
      // `orgName`, neither of which the driver port's narrower shape accepts.
      const status = await probeAuthStatus(dir);
      if (status === undefined) return undefined;
      return {
        loggedIn: status.loggedIn,
        ...(status.email !== undefined ? { email: status.email } : {}),
        ...(status.subscriptionType !== undefined
          ? { subscriptionType: status.subscriptionType }
          : {}),
      };
    },
    start: ({ dir, email, browserLauncher }) => {
      const proc = spawnLogin({
        dir,
        email,
        ...(browserLauncher !== undefined ? { browserLauncher } : {}),
      });
      return {
        onUrl: (fn) =>
          proc.onData((chunk) => {
            const url = extractOauthUrl(chunk);
            if (url !== undefined) fn(url);
          }),
        onExit: (fn) => proc.onExit(fn),
        writeCode: (code) => proc.write(`${code}\r`),
        kill: () => proc.kill(),
        get ptyCaptured() {
          return proc.ptyCaptured;
        },
      };
    },
  };
}
