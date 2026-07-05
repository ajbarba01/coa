import { Check, X } from 'lucide-react';
import { cx } from '../lib/cx.js';

/** One parsed check result: its name and pass/fail. */
export interface CheckResult {
  name: string;
  ok: boolean;
}

/** A parsed `run_checks` summary: the per-check results plus an optional flag count. */
export interface ChecksSummary {
  checks: CheckResult[];
  flags?: number;
}

// `<name> ✓|✗` tokens. ✓/✔ pass, ✗/✘ fail. Name is a word so freeform prose doesn't match.
const CHECK_TOKEN = /([A-Za-z][\w-]*)\s*([✓✔✗✘])/gu;
const FLAGS_TAIL = /(\d+)\s+flags?/u;

/** Parse a `run_checks` output line into structured results, or undefined when it carries
 *  no recognizable check tokens (→ plain preview fallback). Pure; never throws. */
export function parseChecks(output: string): ChecksSummary | undefined {
  const checks: CheckResult[] = [];
  for (const m of output.matchAll(CHECK_TOKEN)) {
    const name = m[1];
    const mark = m[2];
    if (name === undefined || mark === undefined) continue;
    checks.push({ name, ok: mark === '✓' || mark === '✔' });
  }
  if (checks.length === 0) return undefined;
  const flagsMatch = FLAGS_TAIL.exec(output);
  const summary: ChecksSummary = { checks };
  if (flagsMatch?.[1] !== undefined) summary.flags = Number(flagsMatch[1]);
  return summary;
}

export interface RunChecksProps {
  output: string;
}

/** The structured `run_checks` body: a status chip per check (success/danger token) plus a
 *  flags chip. Defensive — an unparseable output degrades to a plain verbatim preview. */
export function RunChecks({ output }: RunChecksProps): React.JSX.Element {
  const parsed = parseChecks(output);
  if (parsed === undefined) {
    return (
      <div className="overflow-x-auto whitespace-pre px-2.5 py-2 font-mono text-label leading-[1.55] text-muted">
        {output}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
      {parsed.checks.map((c) => (
        <span
          key={c.name}
          className={cx(
            'inline-flex items-center gap-1 rounded-surface border px-1.5 py-0.5 text-caption',
            c.ok
              ? 'border-success/40 bg-success-tint text-success-text'
              : 'border-danger/40 bg-danger-tint text-danger-text',
          )}
        >
          {c.ok ? <Check aria-hidden size={11} /> : <X aria-hidden size={11} />}
          {c.name}
        </span>
      ))}
      {parsed.flags !== undefined && (
        <span
          className={cx(
            'inline-flex items-center rounded-surface border px-1.5 py-0.5 text-caption',
            parsed.flags === 0
              ? 'border-hairline text-faint'
              : 'border-warning/40 bg-warning-tint text-warning-text',
          )}
        >
          {parsed.flags} {parsed.flags === 1 ? 'flag' : 'flags'}
        </span>
      )}
    </div>
  );
}
