/**
 * Validate a URL before it is opened in the default browser via `shell.openExternal`.
 * The open-external IPC's load-bearing safety check: only `http:`/`https:` URLs may be
 * handed to the OS — any other scheme (`file:`, `javascript:`, `mailto:`, a shell command,
 * a malformed string) is rejected here before any `openExternal` call. Pure; never throws
 * — a bad input returns a rejection object rather than raising (surface, never block).
 */

/** The web-open scheme allow-list. Only these two reach `shell.openExternal`. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Whether `raw` is a safe web URL to open externally. Parses it (a non-URL is rejected),
 * then gates on the `http(s)` allow-list. Returns the normalized href on success so the
 * caller opens exactly what was validated.
 */
export function validateExternalUrl(raw: string): UrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: `Not a valid URL: ${raw}` };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: `Refusing to open a non-web URL (${parsed.protocol})` };
  }
  return { ok: true, url: parsed.href };
}
