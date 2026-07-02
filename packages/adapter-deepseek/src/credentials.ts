import type { Locator } from '@coa/shared';

/** The env var a DeepSeek account with no explicit pointer falls back to. */
export const DEFAULT_API_KEY_VAR = 'DEEPSEEK_API_KEY';

/**
 * Resolve the DeepSeek API key from the account's locator — a POINTER, never a
 * stored secret (credential-blind invariant): an `env-var` locator names the
 * environment variable that holds the key; any other/absent locator falls back to
 * {@link DEFAULT_API_KEY_VAR}. The secret itself lives in the environment, so
 * account-switching selects which key is live without coa ever persisting one.
 */
export function resolveApiKey(
  locator: Locator | undefined,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const name = locator?.type === 'env-var' ? locator.name : DEFAULT_API_KEY_VAR;
  const value = env[name];
  return value !== undefined && value !== '' ? value : undefined;
}
