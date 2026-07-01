import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { InlineMessage, Pane, Skeleton } from '@coa/console-ui';
import { toCapViewModel, type CapViewModel } from '@coa/console-viewmodel';
import type { DaemonState } from './state.js';

export type CostVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; vm: CapViewModel };

/** Pure: maps the polled cap read into a render state. */
export function selectCostVm(state: DaemonState): CostVm {
  const r = state.cap;
  if (r.status === 'ok') return { status: 'ok', vm: toCapViewModel(r.value) };
  return r;
}

function CostView({ vm }: { vm: CostVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <Pane title="Cost">
      {vm.status === 'loading' && (
        <div className="flex flex-col gap-2">
          <Skeleton className="w-24" />
          <Skeleton className="w-16" />
        </div>
      )}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {vm.status === 'ok' && (
        <div>
          <div
            className={
              vm.vm.tone === 'danger'
                ? 'text-[18px] font-semibold text-danger-text'
                : 'text-[18px] font-semibold text-fg'
            }
          >
            {vm.vm.headline}
          </div>
          <div className="text-[11px] text-muted">{vm.vm.sub}</div>
        </div>
      )}
    </Pane>
  );
}

export const costPanel: PanelDefinition<CostVm, DaemonState> = {
  id: 'cost',
  displayName: 'Cost',
  render: CostView,
  selectVm: selectCostVm,
};
