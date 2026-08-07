/**
 * The renderer Content-Security-Policy, applied as a response header (the single
 * source of truth; `index.html` carries no competing meta policy).
 *
 * Production (the packaged app) is strict — only same-origin
 * scripts, no inline/eval, and `connect-src 'none'` (local-first — all data flows
 * over IPC, an anti-exfil control). Dev must additionally allow Vite's HMR: the
 * React Fast Refresh preamble is injected as an inline/eval script and HMR uses a
 * websocket, so `script-src` and `connect-src` are relaxed ONLY in dev. Without
 * the dev `script-src` relaxation the renderer throws
 * "@vitejs/plugin-react can't detect preamble" and the whole root fails to mount.
 */
export function contentSecurityPolicy(isDev: boolean): string {
  const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'";
  const connectSrc = isDev ? "'self' ws: wss:" : "'none'";
  return `default-src 'none'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${connectSrc}`;
}
