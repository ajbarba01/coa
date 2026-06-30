import type { Locator } from '@coa/shared';

/**
 * The locator → SDK env overlay (the backend seam, subscription-aware). coa's
 * neutral account locator becomes an environment overlay for the rented loop:
 * select the login (CLAUDE_CONFIG_DIR / ANTHROPIC_PROFILE) and CLEAR the vars
 * that would otherwise outrank a subscription OAuth login — the API-key vars
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
  if (locator.type === 'ambient') return undefined;

  const overlay: Record<string, string | undefined> = {};
  if (locator.type === 'config-dir') overlay['CLAUDE_CONFIG_DIR'] = locator.dir;
  else overlay['ANTHROPIC_PROFILE'] = locator.profile;

  for (const name of clearVars) overlay[name] = undefined;
  return overlay;
}
