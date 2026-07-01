import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { IconButton } from '@coa/console-ui';
import { Flag, History, Settings, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ConsoleState } from './state.js';

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** The nav-driven main surfaces. Grows as surfaces land (Flags/Timeline P2, the
 *  Settings gear P3). */
export const NAV_SECTIONS: readonly NavSection[] = [
  { id: 'cost', label: 'Cost', icon: Wallet },
  { id: 'flags', label: 'Flags', icon: Flag },
  { id: 'timeline', label: 'Timeline', icon: History },
];

export interface NavVm {
  activeId: string;
  setRoute: (id: string) => void;
}

export function selectNavVm(state: ConsoleState): NavVm {
  return { activeId: state.ui.activeMainPanelId, setRoute: state.actions.setRoute };
}

function NavRail({ vm }: { vm: NavVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <nav
      aria-label="Sections"
      className="flex h-full flex-col items-center gap-1 border-r border-hairline bg-subtle py-2"
    >
      <div className="flex flex-col gap-1">
        {NAV_SECTIONS.map((s) => (
          <IconButton
            key={s.id}
            icon={s.icon}
            label={s.label}
            variant="tertiary"
            aria-current={s.id === vm.activeId ? 'page' : undefined}
            data-active={s.id === vm.activeId ? 'true' : undefined}
            onClick={() => vm.setRoute(s.id)}
          />
        ))}
      </div>
      <div className="mt-auto">
        <IconButton icon={Settings} label="Settings" variant="tertiary" disabled />
      </div>
    </nav>
  );
}

export const navPanel: PanelDefinition<NavVm, ConsoleState> = {
  id: 'nav',
  displayName: 'Navigation',
  render: NavRail,
  selectVm: selectNavVm,
};
