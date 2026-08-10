/**
 * The minimal, secret-clean audit ledger (the secret guard; a build requirement).
 * A local-only billing/audit record defined by a **strict allow-list (NOT a
 * deny-list)** over the event schema. A deterministic redaction station enforces
 * the allow-list: a field outside it is dropped, never persisted. The ledger
 * is local-only by construction (under `.coa/local/`, gitignored, never
 * network-exposed) — the ledger-sync tripwire stays un-tripped.
 *
 * **DT-5 (non-negotiable):** prose-bearing fields (flag messages, the typed
 * feedback reason) NEVER enter this ledger — they stay WAL-local. `record()`
 * structurally excludes them by keeping only the allow-listed keys.
 */

/** The ONLY permitted attributes (the allow-list). Anything else is dropped. */
export interface LedgerRecord {
  /** Numeric token counts. */
  tokensIn?: number;
  tokensOut?: number;
  /** Cost in USD. */
  costUsd?: number;
  /** Cache hit/miss. */
  cacheHit?: boolean;
  /** An anonymized node id — hashed or relative, NEVER an absolute path. */
  nodeId?: string;
  /** Rule id(s). */
  ruleId?: string | string[];
  /** A coarse scope name. */
  scope?: string;
  /** The account label the session ran under (incl. `'ambient'`) — the per-account spend attribution. */
  account?: string;
  /** The family-tree root this spend belongs to — what makes a whole run's cost
   *  answerable, not just an account's. A session id: no path, no prose. */
  root?: string;
}

/**
 * The deterministic redaction station: project an arbitrary runtime event onto the
 * the allow-list. Keeps only allow-listed, well-typed fields; drops every other
 * field, drops any string that carries a full/absolute path, and flattens+caps
 * (never drops) an otherwise-allowed string that is over-length or carries a
 * hostile character (see {@link flattenPathSafe}).
 */
export function redactLedgerEvent(event: Record<string, unknown>): LedgerRecord {
  const out: LedgerRecord = {};
  copyNumber(event, 'tokensIn', out);
  copyNumber(event, 'tokensOut', out);
  copyNumber(event, 'costUsd', out);
  if (typeof event['cacheHit'] === 'boolean') out.cacheHit = event['cacheHit'];
  copyPathSafeString(event, 'nodeId', out);
  copyPathSafeString(event, 'scope', out);
  copyPathSafeString(event, 'account', out);
  copyPathSafeString(event, 'root', out);
  const ruleId = event['ruleId'];
  if (typeof ruleId === 'string') out.ruleId = ruleId;
  else if (Array.isArray(ruleId) && ruleId.every((r) => typeof r === 'string')) {
    out.ruleId = ruleId as string[];
  }
  return out;
}

export class Ledger {
  private readonly records: LedgerRecord[] = [];

  /** Append the allow-listed projection of a runtime event. An event that redacts to nothing is not appended. */
  record(event: Record<string, unknown>): void {
    const redacted = redactLedgerEvent(event);
    if (Object.keys(redacted).length > 0) this.records.push(redacted);
  }

  /** Read the local audit ledger (billing/audit + the A/B numeric record). */
  entries(): LedgerRecord[] {
    return [...this.records];
  }
}

function copyNumber(
  event: Record<string, unknown>,
  key: keyof LedgerRecord,
  out: LedgerRecord,
): void {
  const value = event[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    (out[key] as number) = value;
  }
}

/** These allow-listed strings are short identifiers/labels (a node id, a scope
 *  name, an account label, a session-id root) — never prose. Anything past this
 *  length cannot be a genuine one; kept (truncated), not dropped — see
 *  {@link flattenPathSafe}: an audit ledger's whole purpose is a faithful record,
 *  so an over-length or hostile-charactered value degrades to a safe, kept
 *  projection of itself rather than vanishing without a trace. */
const MAX_PATH_SAFE_LENGTH = 256;

/**
 * Project a raw string onto a safe-to-persist-and-later-render one, the same
 * shape `notify.ts`'s `sanitizeDetail` already uses for a child's error detail:
 * collapse every C0 control character, DEL, and either Unicode
 * line-break-class-BK separator (U+2028/U+2029) to a single space, trim, and cap
 * the length. `JSON.stringify` escapes the former (`\n` becomes the two
 * characters `\` `n`) but passes the latter through raw — and this ledger is
 * persisted to disk and read back later for display, so JSON encoding is not
 * the escaping boundary here. Flattening (never dropping) is deliberate: unlike
 * an absolute path, a long or control-charactered value is not inherently a
 * privacy leak — silently discarding the field would just make the audit trail
 * incomplete, which is the one thing this ledger cannot be. This runs BEFORE
 * `looksAbsolute` is checked (below), so a value that only *looks* safe because a
 * leading control character hides its `/`-prefix (e.g. a NUL then a real
 * absolute path) still gets caught once flattening exposes it.
 */
function flattenPathSafe(value: string): string {
  let flattened = '';
  let sawSpace = false;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029;
    if (isControl) {
      if (!sawSpace) {
        flattened += ' ';
        sawSpace = true;
      }
      continue;
    }
    flattened += ch;
    sawSpace = ch === ' ';
  }
  flattened = flattened.trim();
  return flattened.length > MAX_PATH_SAFE_LENGTH
    ? `${flattened.slice(0, MAX_PATH_SAFE_LENGTH)}…`
    : flattened;
}

/**
 * A full/absolute path (POSIX, Windows drive, UNC, or home-relative) is the one
 * thing on these fields still forbidden outright — pre-existing, unchanged: an
 * absolute path can carry a real username or directory layout, a genuine privacy
 * leak the flattening above does not (and should not) launder. Checked on the
 * FLATTENED value so a hostile control-character prefix can't smuggle a real
 * absolute path past this guard by hiding its leading `/`/`~`/drive letter.
 */
function looksAbsolute(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('~') ||
    value.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

function copyPathSafeString(
  event: Record<string, unknown>,
  key: 'nodeId' | 'scope' | 'account' | 'root',
  out: LedgerRecord,
): void {
  const value = event[key];
  if (typeof value !== 'string') return;
  const flattened = flattenPathSafe(value);
  if (looksAbsolute(flattened)) return;
  out[key] = flattened;
}
