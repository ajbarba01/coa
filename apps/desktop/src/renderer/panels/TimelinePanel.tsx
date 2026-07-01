import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { Badge, EmptyState, InlineMessage, List, Pane, Skeleton } from '@coa/console-ui';
import type { Checkpoint } from '@coa/console-viewmodel';
import { History } from 'lucide-react';
import type { ConsoleState } from './state.js';

export type TimelineVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: Checkpoint[] };

export function selectTimelineVm(state: ConsoleState): TimelineVm {
  return state.data.timeline;
}

function TimelineView({ vm }: { vm: TimelineVm; host: PanelHostApi }): React.JSX.Element {
  const newestFirst = vm.status === 'ok' ? [...vm.value].reverse() : [];
  return (
    <Pane title="Timeline" scroll>
      {vm.status === 'loading' && (
        <div className="flex flex-col gap-2">
          <Skeleton className="w-2/3" />
          <Skeleton className="w-1/2" />
        </div>
      )}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {vm.status === 'ok' && vm.value.length === 0 && (
        <EmptyState
          icon={History}
          title="No checkpoints"
          description="Checkpoints appear as the session progresses."
        />
      )}
      {vm.status === 'ok' && vm.value.length > 0 && (
        <List
          label="Checkpoints"
          items={newestFirst}
          getKey={(c) => c.id}
          renderItem={(c) => (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted">seq {c.seq}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{c.ts}</span>
              {c.pinned && <Badge tone="info">pinned</Badge>}
            </div>
          )}
        />
      )}
    </Pane>
  );
}

export const timelinePanel: PanelDefinition<TimelineVm, ConsoleState> = {
  id: 'timeline',
  displayName: 'Timeline',
  render: TimelineView,
  selectVm: selectTimelineVm,
};
