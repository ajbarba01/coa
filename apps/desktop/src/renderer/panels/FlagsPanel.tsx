import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { Badge, EmptyState, InlineMessage, List, Pane, Skeleton } from '@coa/console-ui';
import type { BadgeTone } from '@coa/console-ui';
import type { FeedView } from '@coa/console-viewmodel';
import { CircleCheck } from 'lucide-react';
import type { ConsoleState } from './state.js';

export type FlagsVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: FeedView };

export function selectFlagsVm(state: ConsoleState): FlagsVm {
  return state.data.flags;
}

const SEVERITY_TONE: Record<string, BadgeTone> = {
  crit: 'danger',
  high: 'warning',
  med: 'neutral',
  low: 'neutral',
};

function FlagsView({ vm }: { vm: FlagsVm; host: PanelHostApi }): React.JSX.Element {
  const empty =
    vm.status === 'ok' && vm.value.expanded.length === 0 && vm.value.collapsed.length === 0;
  return (
    <Pane title="Flags" scroll>
      {vm.status === 'loading' && (
        <div className="flex flex-col gap-2">
          <Skeleton className="w-3/4" />
          <Skeleton className="w-1/2" />
        </div>
      )}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {empty && (
        <EmptyState
          icon={CircleCheck}
          title="No flags"
          description="The governor has raised nothing to review."
        />
      )}
      {vm.status === 'ok' && !empty && (
        <div className="flex flex-col gap-1">
          <List
            label="Flags"
            items={vm.value.expanded}
            getKey={(f) => f.fingerprint}
            renderItem={(f) => (
              <div className="flex items-center gap-2">
                <Badge tone={SEVERITY_TONE[f.severity] ?? 'neutral'}>{f.severity}</Badge>
                <span className="min-w-0 flex-1 truncate">{f.message}</span>
                <span className="text-caption text-faint">{f.location}</span>
              </div>
            )}
          />
          {vm.value.collapsed.map((c) => (
            <div key={c.concernKey} className="px-2 py-1 text-label text-muted">
              {c.count} more {c.severity}
            </div>
          ))}
        </div>
      )}
    </Pane>
  );
}

export const flagsPanel: PanelDefinition<FlagsVm, ConsoleState> = {
  id: 'flags',
  displayName: 'Flags',
  render: FlagsView,
  selectVm: selectFlagsVm,
};
