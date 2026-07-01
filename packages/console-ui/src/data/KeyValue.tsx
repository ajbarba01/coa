import { cx } from '../lib/cx.js';

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface KeyValueProps {
  pairs: KeyValuePair[];
  className?: string;
}

export function KeyValue({ pairs, className }: KeyValueProps): React.JSX.Element {
  return (
    <dl className={cx('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]', className)}>
      {pairs.map((p) => (
        <div key={p.key} className="contents">
          <dt className="text-muted">{p.key}</dt>
          <dd className="m-0 text-fg">{p.value}</dd>
        </div>
      ))}
    </dl>
  );
}
