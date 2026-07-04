/**
 * Classify and humanize a loop failure surfaced through the session `.catch()`.
 *
 * A rented backend loop can throw for two very different reasons: a genuine
 * application fault (bad config, an unwired port) or a **transient network
 * error** — the socket to the model provider dropped mid-turn. The latter is by
 * far the most common in practice (undici raises a bare `TypeError: fetch
 * failed`) and it is recoverable, so it should read as "retry me", not as a hard
 * crash. Everything else passes through unchanged.
 */

/** Socket/DNS error codes that mean "the connection failed" — all transient. */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  // undici's own error codes
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Unambiguous connection-failure phrases (undici / Node http / TLS). */
const TRANSIENT_MESSAGES = [
  'fetch failed',
  'socket hang up',
  'terminated',
  'econnreset',
  'network error',
  'client network socket disconnected',
];

/** Read a string `code` off an unknown value, if present. */
function codeOf(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null && 'code' in value) {
    const code = (value as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** True when `err` (or any error in its `cause` chain) looks like a dropped
 *  connection rather than an application fault. */
export function isTransientNetworkError(err: unknown): boolean {
  let current: unknown = err;
  // Walk the cause chain (undici nests the socket error under `.cause`), bounded
  // so a self-referential cause can never loop forever.
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    const code = codeOf(current);
    if (code !== undefined && TRANSIENT_CODES.has(code)) return true;
    const message = current.message.toLowerCase();
    if (TRANSIENT_MESSAGES.some((m) => message.includes(m))) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** The message put on the surfaced error frame. Transient network failures are
 *  reframed as a retryable, message-preserving prompt; other errors pass through. */
export function describeLoopFailure(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'session failed';
  if (isTransientNetworkError(err)) {
    return `Lost connection to the model provider (${raw}). This is usually a transient network error — your message was saved, so send it again to retry.`;
  }
  return raw;
}
