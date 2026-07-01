import { Ban, CircleDollarSign } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

/** The only two real blocks in the system: the close-gate and the cost-cap. */
export type DenyKind = 'close-gate' | 'cost-cap';

export interface DenyNoticeProps {
  kind: DenyKind;
  /** The daemon-issued reason, rendered verbatim. */
  reason: string;
  /** Optional next step the operator can take. */
  detail?: string;
  className?: string;
}

const kindIcon: Record<DenyKind, LucideIcon> = { 'close-gate': Ban, 'cost-cap': CircleDollarSign };
const kindSource: Record<DenyKind, string> = {
  'close-gate': 'Blocked at close',
  'cost-cap': 'Cost cap',
};

/** Surfaces a deny the daemon already issued. It gates nothing itself. */
export function DenyNotice({
  kind,
  reason,
  detail,
  className,
}: DenyNoticeProps): React.JSX.Element {
  return (
    <div
      role="alert"
      data-deny-kind={kind}
      className={cx(
        'flex items-start gap-2 rounded-surface border border-danger/50 bg-danger-tint px-3 py-2 text-label text-danger-text',
        className,
      )}
    >
      <Icon name={kindIcon[kind]} size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="text-eyebrow font-medium uppercase tracking-[0.06em] text-faint">
          {kindSource[kind]}
        </div>
        <div className="font-medium text-fg">{reason}</div>
        {detail !== undefined && <div className="text-muted">{detail}</div>}
      </div>
    </div>
  );
}
