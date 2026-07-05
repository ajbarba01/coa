import { readFileSync } from 'node:fs';
import type { Locator } from '@coa/shared';

/** The env var a LongCat account with no explicit pointer falls back to. */
export const DEFAULT_API_KEY_VAR = 'LONGCAT_API_KEY';

/** Read a key file's contents (trimmed); a missing/unreadable file resolves to undefined. */
export type ReadKeyFile = (path: string) => string | undefined;

const defaultReadKeyFile: ReadKeyFile = (path) => {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return undefined;
  }
};

/**
 * Resolve the LongCat API key from the account's locator — a POINTER, never a
 * secret stored in `accounts.yaml` (credential-blind invariant): an `env-var`
 * locator names the environment variable that holds the key; a `key-file` locator
 * names a coa-written 0600 file to read it from; any other/absent locator falls
 * back to the {@link DEFAULT_API_KEY_VAR} env var. `readKeyFile` is injectable for tests.
 */
export function resolveApiKey(
  locator: Locator | undefined,
  env: Record<string, string | undefined> = process.env,
  readKeyFile: ReadKeyFile = defaultReadKeyFile,
): string | undefined {
  if (locator?.type === 'key-file') return nonEmpty(readKeyFile(locator.path));
  const name = locator?.type === 'env-var' ? locator.name : DEFAULT_API_KEY_VAR;
  return nonEmpty(env[name]);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}
