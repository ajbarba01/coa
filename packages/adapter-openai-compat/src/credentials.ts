import { readFileSync } from 'node:fs';
import type { Locator } from '@coa/shared';
import type { ProviderSpec } from './provider-spec.js';

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
 * Resolve the provider's API key from the account's locator — a POINTER, never a
 * secret stored in `accounts.yaml` (credential-blind invariant): an `env-var`
 * locator names the environment variable that holds the key; a `key-file` locator
 * names a coa-written 0600 file to read it from; any other/absent locator falls
 * back to the spec's default env var. `readKeyFile` is injectable for tests.
 * Account-switching selects which key is live without coa persisting one in its
 * account list.
 */
export function resolveApiKey(
  spec: ProviderSpec,
  locator: Locator | undefined,
  env: Record<string, string | undefined> = process.env,
  readKeyFile: ReadKeyFile = defaultReadKeyFile,
): string | undefined {
  if (locator?.type === 'key-file') return nonEmpty(readKeyFile(locator.path));
  const name = locator?.type === 'env-var' ? locator.name : spec.apiKeyEnvVar;
  return nonEmpty(env[name]);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}
