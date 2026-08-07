import { cx } from '@coa/console-kit';

/** The one real block in the system: the close-gate. */
export type DenyKind = 'close-gate';

export interface DenyNoticeProps {
  kind: DenyKind;
  /** The daemon-issued reason, rendered verbatim. */
  reason: string;
  /** Optional next step the operator can take. */
  detail?: string;
  className?: string;
}

/** Caps label + the two presentational ways-forward per deny kind. Wired to no
 *  navigation here (this package has no router seam) — the surfaces they name
 *  (flags, timeline) are a later task's concern. */
const DENY_COPY: Record<DenyKind, { label: string; ways: { act: string; hint: string }[] }> = {
  'close-gate': {
    label: 'Close gate',
    ways: [
      { act: 'Review the Flags', hint: 'Flags surface' },
      { act: 'See the Record', hint: 'Timeline' },
    ],
  },
};

/** Surfaces a deny the daemon already issued. It gates nothing itself.
 *
 *  The one block in the whole system (the rest is advisory — help, never cage): it must
 *  read as a firm, legible stop with a reason and a way forward, not an alarm — no
 *  fill, no modal, no scold. The critical dot is the only red; the reason is the
 *  daemon's, verbatim. `role="status"` (not "alert") — it is informational, not an
 *  interruption. */
export function DenyNotice({
  kind,
  reason,
  detail,
  className,
}: DenyNoticeProps): React.JSX.Element {
  const copy = DENY_COPY[kind];
  return (
    <div
      role="status"
      data-deny-kind={kind}
      className={cx('rounded-r2 border border-s4 bg-s2 px-3.5 py-3', className)}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="inline-block size-2 flex-none rounded-full bg-crit" />
        <span className="font-mono text-caps tracking-[0.07em] text-s9 uppercase">
          {copy.label}
        </span>
        <span className="ml-auto font-mono text-caps text-s6">Stopped by the daemon</span>
      </div>
      <div className="mt-1.5 text-body leading-[1.5] text-s11">{reason}</div>
      {detail !== undefined && <div className="mt-1 text-meta text-s7">{detail}</div>}
      <div className="mt-2.5 flex items-center gap-4 border-t border-s3 pt-2">
        {copy.ways.map((w) => (
          <button
            key={w.act}
            type="button"
            className="slip group flex cursor-pointer items-baseline gap-1.5 font-mono text-meta text-s9 hover:text-s11"
          >
            <span className="underline decoration-s6 decoration-dotted underline-offset-[3px] group-hover:decoration-s8">
              {w.act}
            </span>
            <span className="text-s6">{w.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
