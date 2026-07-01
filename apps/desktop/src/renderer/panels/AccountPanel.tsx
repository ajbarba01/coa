import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { InlineMessage, Pane, Select, Skeleton } from '@coa/console-ui';
import type { AccountsInfo, ConsoleState } from './state.js';

export type AccountVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; value: AccountsInfo; switchAccount: (label: string) => void };

export function selectAccountVm(state: ConsoleState): AccountVm {
  const r = state.data.accounts;
  if (r.status === 'ok') {
    return { status: 'ok', value: r.value, switchAccount: state.actions.switchAccount };
  }
  return r;
}

function AccountView({ vm }: { vm: AccountVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <Pane title="Account">
      {vm.status === 'loading' && <Skeleton className="w-32" />}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {vm.status === 'ok' && vm.value.accounts.length === 0 && (
        <div className="text-[12px] text-muted">Ambient login (no accounts configured).</div>
      )}
      {vm.status === 'ok' && vm.value.accounts.length > 0 && (
        <Select
          label="Active account"
          value={vm.value.active}
          onValueChange={vm.switchAccount}
          options={vm.value.accounts.map((a) => ({ value: a.label, label: a.label }))}
        />
      )}
    </Pane>
  );
}

export const accountPanel: PanelDefinition<AccountVm, ConsoleState> = {
  id: 'account',
  displayName: 'Account',
  render: AccountView,
  selectVm: selectAccountVm,
};
