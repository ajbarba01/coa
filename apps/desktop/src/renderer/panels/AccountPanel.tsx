import { InlineMessage, Pane, Select, Skeleton } from '@coa/console-ui';
import type { AccountsInfo, ConsoleState } from './state.js';

/** The value a per-provider selector uses for "no account" (resets that provider to its ambient login). */
const AMBIENT = 'ambient';

const PROVIDER_LABELS: Record<string, string> = { claude: 'Claude', deepseek: 'DeepSeek' };
function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** The distinct providers present in the account list, in first-seen order. */
export function providersOf(accounts: AccountsInfo['accounts']): string[] {
  return [...new Set(accounts.map((a) => a.provider))];
}

export type AccountVm =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ok';
      value: AccountsInfo;
      switchAccount: (label: string, provider?: string) => void;
    };

export function selectAccountVm(state: ConsoleState): AccountVm {
  const r = state.data.accounts;
  if (r.status === 'ok') {
    return { status: 'ok', value: r.value, switchAccount: state.actions.switchAccount };
  }
  return r;
}

function AccountView({ vm }: { vm: AccountVm }): React.JSX.Element {
  return (
    <Pane title="Accounts">
      {vm.status === 'loading' && <Skeleton className="w-32" />}
      {vm.status === 'error' && <InlineMessage tone="danger">{vm.message}</InlineMessage>}
      {vm.status === 'ok' && vm.value.accounts.length === 0 && (
        <div className="text-label text-muted">Ambient login (no accounts configured).</div>
      )}
      {vm.status === 'ok' && vm.value.accounts.length > 0 && (
        <div className="flex flex-col gap-3">
          {providersOf(vm.value.accounts).map((provider) => (
            <Select
              key={provider}
              label={`${providerLabel(provider)} account`}
              value={vm.value.active[provider] ?? AMBIENT}
              onValueChange={(label) => vm.switchAccount(label, provider)}
              options={[
                { value: AMBIENT, label: 'Ambient' },
                ...vm.value.accounts
                  .filter((a) => a.provider === provider)
                  .map((a) => ({ value: a.label, label: a.label })),
              ]}
            />
          ))}
        </div>
      )}
    </Pane>
  );
}

/** State-fed surface: computes the vm from console state and renders the accounts pane. */
export function AccountSurface({ state }: { state: ConsoleState }): React.JSX.Element {
  return <AccountView vm={selectAccountVm(state)} />;
}
