import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { IconButton } from '@coa/console-ui';
import { GitGraph, MessagesSquare, ScrollText, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DaemonState } from './state.js';

export interface NavVm {
  activeId: string;
}

/** 4a has one section's worth of content, so the active section is fixed;
 *  real routing lands when a second surface exists. */
export function selectNavVm(_state: DaemonState): NavVm {
  return { activeId: 'conversation' };
}

const SECTIONS: ReadonlyArray<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'conversation', label: 'Conversation', icon: MessagesSquare },
  { id: 'decisions', label: 'Decisions', icon: ScrollText },
  { id: 'graph', label: 'Graph', icon: GitGraph },
];

function NavRail({ vm }: { vm: NavVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <nav
      aria-label="Sections"
      className="flex h-full flex-col items-center gap-1 border-r border-hairline bg-subtle py-2"
    >
      <div className="flex flex-col gap-1">
        {SECTIONS.map((s) => (
          <IconButton
            key={s.id}
            icon={s.icon}
            label={s.label}
            variant="tertiary"
            aria-current={s.id === vm.activeId ? 'page' : undefined}
            data-active={s.id === vm.activeId ? 'true' : undefined}
          />
        ))}
      </div>
      <div className="mt-auto">
        <IconButton icon={Settings} label="Settings" variant="tertiary" />
      </div>
    </nav>
  );
}

export const navPanel: PanelDefinition<NavVm, DaemonState> = {
  id: 'nav',
  displayName: 'Navigation',
  render: NavRail,
  selectVm: selectNavVm,
};
