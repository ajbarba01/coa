import { toCapViewModel, type CapViewModel } from '@coa/console-viewmodel';
import { cx } from '@coa/console-kit';
import type { ConsoleState } from './state.js';
import { SkeletonLines, SurfaceError } from './surfaceStates.js';

export type CostVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; vm: CapViewModel };

/** Pure: maps the polled cap read into a render state. */
export function selectCostVm(state: ConsoleState): CostVm {
  const r = state.data.cap;
  if (r.status === 'ok') return { status: 'ok', vm: toCapViewModel(r.value) };
  return r;
}

function CostView({ vm }: { vm: CostVm }): React.JSX.Element {
  if (vm.status === 'loading') return <SkeletonLines widths={['w-24', 'w-16']} />;
  if (vm.status === 'error') return <SurfaceError message={vm.message} />;
  return (
    <div className="flex flex-col gap-1 px-4 py-4">
      <div
        className={cx('text-2xl font-semibold', vm.vm.tone === 'danger' ? 'text-crit' : 'text-s12')}
      >
        {vm.vm.headline}
      </div>
      <div className="text-meta text-s7">{vm.vm.sub}</div>
    </div>
  );
}

/** State-fed surface: computes the vm from console state and renders the cost pane. */
export function CostSurface({ state }: { state: ConsoleState }): React.JSX.Element {
  return <CostView vm={selectCostVm(state)} />;
}
