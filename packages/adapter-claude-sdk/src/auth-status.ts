import { spawn } from 'node:child_process';
import { z } from 'zod';

/**
 * The login-health probe — `claude auth status --json` against a config dir.
 * Purpose-built, non-interactive, honors CLAUDE_CONFIG_DIR (an empty dir reports
 * loggedIn:false). This is all coa ever learns about a login: CLI output, never
 * the token file (credential-blind, see the ADR added with this feature). One
 * probe feeds three consumers: health, the identity line, and the declared-email
 * backfill for manually-added accounts.
 */

export const authStatusSchema = z
  .object({
    loggedIn: z.boolean(),
    email: z.string().optional(),
    orgName: z.string().optional(),
    subscriptionType: z.string().optional(),
  })
  .strip();
export type AuthStatus = z.infer<typeof authStatusSchema>;

export type RunCommand = (
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
) => Promise<string>;

/** Pure: parse the probe's stdout. Undefined ⇒ unknown (no verdict), never a throw. */
export function parseAuthStatus(stdout: string): AuthStatus | undefined {
  try {
    const parsed = authStatusSchema.safeParse(JSON.parse(stdout));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const PROBE_TIMEOUT_MS = 15_000;

/** Default runner: spawn the CLI, resolve its stdout. `shell` on win32 reaches the npm shim. */
const defaultRun: RunCommand = (cmd, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let out = '';
    const timer = setTimeout(() => child.kill(), PROBE_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });

/** Probe one config dir. Resolves undefined when the CLI is unreachable/unparseable. */
export async function probeAuthStatus(
  dir: string,
  run: RunCommand = defaultRun,
): Promise<AuthStatus | undefined> {
  try {
    return parseAuthStatus(
      await run('claude', ['auth', 'status', '--json'], { CLAUDE_CONFIG_DIR: dir }),
    );
  } catch {
    return undefined;
  }
}
