/** One parsed check result: its name, pass/fail, and an optional duration when the
 *  digestion can extract one. */
import { markErrors } from './errorMarks.js';

export interface CheckResult {
  name: string;
  ok: boolean;
  ms?: number;
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
  /** Whether the `run_checks` call failed (`ok === false`). Only matters for the
   *  unparseable-output fallback below: a parsed summary already surfaces failure through
   *  its own per-check ✗ marks, but a crash before any check reported (no `name ✓/✗`
   *  tokens at all) has nothing else to mark it failed — without this the fallback would
   *  render error output in the same neutral tone as a success. */
  failed?: boolean | undefined;
}

/** The verdict body: a mark (✓/✕) + name per check, an optional right-aligned duration,
 *  then a footer reading `N passed` and, when any failed, `· M failed`. Defensive — an
 *  unparseable output degrades to a plain verbatim preview, in the failed treatment (crit
 *  tint + `markErrors` highlighting, matching the `out` body kind) when the call failed. */
export function RunChecks({ output, failed = false }: RunChecksProps): React.JSX.Element {
  const parsed = parseChecks(output);
  if (parsed === undefined) {
    if (failed) {
      return (
        <div className="overflow-x-auto whitespace-pre px-3 py-2 font-mono text-code leading-[1.7] text-s10">
          {output.split('\n').map((ln, i) => (
            <div key={i}>{markErrors(ln)}</div>
          ))}
        </div>
      );
    }
    return (
      <div className="overflow-x-auto whitespace-pre px-3 py-2 font-mono text-code leading-[1.7] text-s8">
        {output}
      </div>
    );
  }
  const failedCount = parsed.checks.filter((c) => !c.ok).length;
  return (
    <div className="py-1.5">
      {parsed.checks.map((c, i) => (
        <div key={i} className="flex items-center gap-2.5 px-3 py-[3px] font-mono text-code">
          {c.ok ? (
            <span aria-label="Passed" className="w-3 text-center text-ok/70">
              ✓
            </span>
          ) : (
            <span aria-label="Failed" className="w-3 text-center font-[550] text-crit">
              ✕
            </span>
          )}
          <span className={c.ok ? 'text-s9' : 'text-s11'}>{c.name}</span>
          {c.ms !== undefined && (
            <span className="ml-auto text-meta text-s6">
              {c.ms >= 1000 ? `${(c.ms / 1000).toFixed(1)}s` : `${c.ms}ms`}
            </span>
          )}
        </div>
      ))}
      <div className="mt-1 border-t border-s3 px-3 pt-1.5 pb-0.5 font-mono text-meta text-s7">
        {parsed.checks.length - failedCount} passed
        {failedCount > 0 && (
          <>
            {' · '}
            <span className="text-crit">{failedCount} failed</span>
          </>
        )}
      </div>
    </div>
  );
}
