import { StatusDot } from '@coa/console-kit';
import type { Checkpoint } from '@coa/console-viewmodel';
import type { ConsoleState } from './state.js';
import { SkeletonLines, SurfaceError, SurfaceEmpty } from './surfaceStates.js';

export type TimelineVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: Checkpoint[] };

export function selectTimelineVm(state: ConsoleState): TimelineVm {
  return state.data.timeline;
}

function TimelineView({ vm }: { vm: TimelineVm }): React.JSX.Element {
  if (vm.status === 'loading') return <SkeletonLines widths={['w-2/3', 'w-1/2']} />;
  if (vm.status === 'error') return <SurfaceError message={vm.message} />;
  if (vm.value.length === 0) {
    return (
      <SurfaceEmpty title="No checkpoints" hint="checkpoints appear as the session progresses" />
    );
  }
  const newestFirst = [...vm.value].reverse();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
      {newestFirst.map((c) => (
        <div key={c.id} className="slip flex items-center gap-2 px-3.5 py-1.5 text-sec hover:bg-s3">
          <span className="w-12 flex-none font-mono text-meta text-s6">seq {c.seq}</span>
          <span className="min-w-0 flex-1 truncate text-meta text-s8">{c.ts}</span>
          {c.pinned && <StatusDot status="done" />}
        </div>
      ))}
    </div>
  );
}

/** State-fed surface: computes the vm from console state and renders the timeline pane. */
export function TimelineSurface({ state }: { state: ConsoleState }): React.JSX.Element {
  return <TimelineView vm={selectTimelineVm(state)} />;
}
