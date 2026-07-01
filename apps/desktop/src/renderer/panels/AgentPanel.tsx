import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { KeyValue, Pane } from '@coa/console-ui';
import type { ConsoleState } from './state.js';

export interface AgentVm {
  role: string;
  scope: string;
}

/** Mock preview of the agent config surface (its live role/piece editor is 4c-2).
 *  Framed like the other panels so the dock reads cohesively rather than as dead space. */
export function selectAgentVm(): AgentVm {
  return { role: 'refactor', scope: 'src/**' };
}

function AgentView({ vm }: { vm: AgentVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <Pane title="Agent">
      <KeyValue
        pairs={[
          { key: 'role', value: vm.role },
          { key: 'scope', value: vm.scope },
        ]}
      />
      <p className="mt-3 text-[11px] text-faint">
        Role and piece configuration arrives with a later build.
      </p>
    </Pane>
  );
}

export const agentPanel: PanelDefinition<AgentVm, ConsoleState> = {
  id: 'agent',
  displayName: 'Agent',
  render: AgentView,
  selectVm: selectAgentVm,
};
