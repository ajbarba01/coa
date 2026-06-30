/**
 * D135 — the minimal, secret-clean audit ledger (the secret guard; a build requirement).
 * A local-only billing/audit record defined by a **strict allow-list (NOT a
 * deny-list)** over the event schema. A deterministic redaction station enforces
 * the allow-list (P1): a field outside it is dropped, never persisted. The ledger
 * is local-only by construction (under `.coa/local/`, gitignored, never
 * network-exposed) — the ledger-sync tripwire stays un-tripped.
 *
 * **DT-5 (non-negotiable):** prose-bearing fields (flag messages, the D131
 * feedback reason, the D137 vouch note, the D73 Decision-log entry text) NEVER
 * enter this ledger — they stay WAL-local. `record()` structurally excludes them by
 * keeping only the allow-listed keys.
 */

/** The ONLY permitted attributes (D135 allow-list). Anything else is dropped. */
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
}

/**
 * The deterministic redaction station: project an arbitrary runtime event onto the
 * D135 allow-list. Keeps only allow-listed, well-typed fields; drops every other
 * field, and drops any string that carries a full/absolute path.
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

  /** Read the local audit ledger (billing/audit + the D143 A/B numeric record). */
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

function copyPathSafeString(
  event: Record<string, unknown>,
  key: 'nodeId' | 'scope' | 'account',
  out: LedgerRecord,
): void {
  const value = event[key];
  if (typeof value === 'string' && !looksAbsolute(value)) out[key] = value;
}

/** A full/absolute path (POSIX, Windows drive, UNC, or home-relative) is forbidden. */
function looksAbsolute(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('~') ||
    value.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}
