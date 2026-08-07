import { StatusDot } from '@coa/console-kit';

/** Quiet skeleton bars — one per width class. Keeps the `animate-pulse` marker
 *  the states-first tests assert, in the sand ground. */
export function SkeletonLines({ widths }: { widths: string[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3">
      {widths.map((w, i) => (
        <div key={i} className={`h-3 animate-pulse rounded-r2 bg-s3 ${w}`} />
      ))}
    </div>
  );
}

/** A surface read that failed — a quiet line, red dot, `role="alert"` so it is
 *  announced (and asserted). Never an error affordance the user must clear (advisory). */
export function SurfaceError({ message }: { message: string }): React.JSX.Element {
  return (
    <div role="alert" className="flex items-center gap-2 px-3.5 py-3 text-body text-s10">
      <StatusDot status="critical" />
      <span className="min-w-0 flex-1">{message}</span>
    </div>
  );
}

/** The empty state — centered, text-only, quiet register (no icon chrome). */
export function SurfaceEmpty({ title, hint }: { title: string; hint?: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
      <span className="text-body text-s8">{title}</span>
      {hint !== undefined && <span className="font-mono text-meta text-s6">{hint}</span>}
    </div>
  );
}
