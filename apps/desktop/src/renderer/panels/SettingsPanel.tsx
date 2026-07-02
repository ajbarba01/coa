import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { Pane, Select, Switch } from '@coa/console-ui';
import type { ConsoleSettings } from '../../shared/settings.js';
import type { ConsoleState } from './state.js';

export interface SettingsVm {
  settings: ConsoleSettings;
  setSettings: (patch: Partial<ConsoleSettings>) => void;
}

export function selectSettingsVm(state: ConsoleState): SettingsVm {
  return { settings: state.ui.settings, setSettings: state.actions.setSettings };
}

function SettingsView({ vm }: { vm: SettingsVm; host: PanelHostApi }): React.JSX.Element {
  const { settings, setSettings } = vm;
  return (
    <Pane title="Settings" scroll seam="left">
      <div className="flex max-w-xs flex-col gap-4">
        <Select
          label="Theme"
          value={settings.theme}
          onValueChange={(v) => setSettings({ theme: v as ConsoleSettings['theme'] })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
        <Select
          label="Density"
          value={settings.density}
          onValueChange={(v) => setSettings({ density: v as ConsoleSettings['density'] })}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Comfortable' },
          ]}
        />
        <Switch
          label="Reduce motion"
          checked={settings.motion === 'reduce'}
          onCheckedChange={(on) => setSettings({ motion: on ? 'reduce' : 'full' })}
        />
      </div>
    </Pane>
  );
}

export const settingsPanel: PanelDefinition<SettingsVm, ConsoleState> = {
  id: 'settings',
  displayName: 'Settings',
  render: SettingsView,
  selectVm: selectSettingsVm,
};
