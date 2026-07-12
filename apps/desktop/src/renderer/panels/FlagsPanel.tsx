import { StatusDot } from '@coa/console-kit';
import type { FeedView } from '@coa/console-viewmodel';
import type { ConsoleState } from './state.js';
import { SkeletonLines, SurfaceError, SurfaceEmpty } from './surfaceStates.js';

export type FlagsVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: FeedView };

export function selectFlagsVm(state: ConsoleState): FlagsVm {
  return state.data.flags;
}

// crit=red, high=amber, med/low=ground — state is a dot, severity is the color.
const SEVERITY_DOT: Record<string, 'critical' | 'needs-you' | 'idle'> = {
  crit: 'critical',
  high: 'needs-you',
  med: 'idle',
  low: 'idle',
};

function FlagsView({ vm }: { vm: FlagsVm }): React.JSX.Element {
  if (vm.status === 'loading') return <SkeletonLines widths={['w-3/4', 'w-1/2']} />;
  if (vm.status === 'error') return <SurfaceError message={vm.message} />;
  const empty = vm.value.expanded.length === 0 && vm.value.collapsed.length === 0;
  if (empty) {
    return <SurfaceEmpty title="No flags" hint="the governor has raised nothing to review" />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
      {vm.value.expanded.map((f) => (
        <div
          key={f.fingerprint}
          className="slip flex items-center gap-2 px-3.5 py-1.5 text-sec hover:bg-s3"
        >
          <StatusDot status={SEVERITY_DOT[f.severity] ?? 'idle'} />
          <span className="w-9 flex-none font-mono text-meta text-s6">{f.severity}</span>
          <span className="min-w-0 flex-1 truncate text-s11">{f.message}</span>
          <span className="flex-none font-mono text-meta text-s6">{f.location}</span>
        </div>
      ))}
      {vm.value.collapsed.map((c) => (
        <div key={c.concernKey} className="px-3.5 py-1 text-meta text-s7">
          {c.count} more {c.severity}
        </div>
      ))}
    </div>
  );
}

/** State-fed surface: computes the vm from console state and renders the flags pane. */
export function FlagsSurface({ state }: { state: ConsoleState }): React.JSX.Element {
  return <FlagsView vm={selectFlagsVm(state)} />;
}
