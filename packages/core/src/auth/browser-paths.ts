import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Where an identity's browser session lives on disk, and what names it.
 *
 * Split out of `browser-session.ts` so the launcher and the reclaim surface can both build
 * paths without depending on each other — one owns starting a login, the other owns
 * deleting a dead jar, and neither should have to import the other to say where a
 * directory is. Everything here is pure.
 */

/** Pure: a key safe to spend as ONE path segment. {@link profileKey} produces these by
 *  construction, so this guards the legacy account ids migration still reads out of a
 *  hand-editable `accounts.yaml` — anything that could escape the profile root gets no
 *  isolation rather than a sanitized approximation. */
export function isSafeProfileKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(key);
}

/** Keeps the readable half of a key bounded so a long address cannot produce a path no
 *  filesystem will take. */
const KEY_SLUG_MAX = 48;
const KEY_HASH_LENGTH = 6;

/**
 * Pure: the profile key for an identity — a readable slug plus a short digest of the
 * normalized address, e.g. `wormsegment1000-gmail-com-4f9a2c`.
 *
 * Keyed by IDENTITY rather than by account row. The consequences are the
 * point: a relogin reuses the jar it already signed into, two providers signed in as the
 * same person share one jar, and removing an account row no longer strands a directory
 * nothing can name again.
 *
 * The digest is what makes this safe where a bare slug was not — slugging collapses every
 * non-alphanumeric run, so `a.b@c.com`, `a-b@c.com`, and `a+b@c.com` would otherwise share
 * one cookie jar. The slug survives only so the profile root stays inspectable by a human.
 */
export function profileKey(email: string): string | undefined {
  const normalized = email.trim().toLowerCase();
  if (normalized === '') return undefined;
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, KEY_SLUG_MAX)
    .replace(/-+$/, '');
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, KEY_HASH_LENGTH);
  return slug === '' ? digest : `${slug}-${digest}`;
}

/** Pure: the root coa owns for browser sessions — the shims and relayed urls live directly
 *  here, the jars one level down. */
export function browserSessionRoot(home: string): string {
  return join(home, '.coa', 'browser-session');
}

/**
 * Pure: the ONE Chrome `--user-data-dir` every identity's jar sits inside.
 *
 * Measured 2026-07-31: ~90% of a profile is not the login. The model store, the Safe
 * Browsing database and the component cache live at the user-data-dir root, while the
 * actual sign-in — 44 KB of cookies — lives in the profile directory. Sharing the root pays
 * the large half once for all identities instead of once per identity.
 *
 * Nested under {@link browserSessionRoot} rather than being it, so Chrome's ~30 root
 * directories stay contained and the root coa owns is still readable by eye.
 */
export function browserUserDataDir(home: string): string {
  return join(browserSessionRoot(home), 'profiles');
}

/** Pure: an identity's browser profile (its own cookie jar), keyed by {@link profileKey}.
 *  A `--profile-directory` inside the shared root — verified 2026-07-31 to carry its own
 *  `Network/Cookies`, `Login Data` and `Preferences`, which is the per-profile isolation the login design
 *  requires and how multi-person Chrome has always worked. */
export function browserProfileDir(home: string, key: string): string {
  return join(browserUserDataDir(home), key);
}

/** Pure: the shim `BROWSER` points at. Outside the user-data-dir, so coa's own files never
 *  mix with Chrome's, but keyed the same way so removing an identity takes its launcher. */
export function launcherPath(home: string, key: string, platform: string): string {
  const ext = platform === 'win32' ? '.cmd' : '.sh';
  return join(browserSessionRoot(home), `${key}${ext}`);
}

/** Pure: where the shim writes the url it was handed. Beside the launcher, keyed the same
 *  way, so removing an identity takes its relayed url with it. */
export function courierPath(home: string, key: string): string {
  return join(browserSessionRoot(home), `${key}.url`);
}
