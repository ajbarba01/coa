import type { Locator } from '@coa/shared';

/**
 * The locator → SDK env overlay (the backend seam, subscription-aware). coa's
 * neutral account locator becomes an environment overlay for the rented loop:
 * select the login (CLAUDE_CONFIG_DIR) and CLEAR the vars that would otherwise
 * outrank a subscription OAuth login — the API-key vars
 * (which force API billing) and the ambient OAuth-token var that a headless
 * daemon shell may carry and would otherwise pin every session to one login.
 *
 * The overlay is applied per session via the SDK `Options.env` field, which
 * REPLACES the subprocess env — so the caller spreads `process.env` first, then
 * this overlay; setting a var to `undefined` removes it. `ambient` returns
 * `undefined` (no overlay) ⇒ the subprocess inherits `process.env` unchanged,
 * which is today's zero-auth behavior.
 *
 * The clear list is data so the attended subscription-login spike can finalize
 * the exact set without a code change.
 */
export const DEFAULT_CLEAR_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
];

export function resolveAuthEnv(
  locator: Locator,
  clearVars: readonly string[] = DEFAULT_CLEAR_VARS,
): Record<string, string | undefined> | undefined {
  // Only a config-dir login overlays the Claude env; `env-var` (an API-key
  // provider like DeepSeek) and `ambient` carry no Claude overlay.
  if (locator.type !== 'config-dir') return undefined;

  const overlay: Record<string, string | undefined> = { CLAUDE_CONFIG_DIR: locator.dir };
  for (const name of clearVars) overlay[name] = undefined;
  return overlay;
}

/**
 * The full `Options.env` value for a session: the base environment (the daemon's
 * `process.env`) with the locator overlay applied on top. `Options.env` REPLACES
 * the subprocess env, so the base MUST be spread in. Returns `undefined` (leave
 * `Options.env` unset ⇒ inherit `process.env`) when there is no locator or the
 * locator is `ambient` — both are today's zero-auth behavior. `base` is injectable
 * for tests.
 */
export function sessionAuthEnv(
  locator: Locator | undefined,
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> | undefined {
  if (locator === undefined) return undefined;
  const overlay = resolveAuthEnv(locator);
  return overlay === undefined ? undefined : { ...base, ...overlay };
}
