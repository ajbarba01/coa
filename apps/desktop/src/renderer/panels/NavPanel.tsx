import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import { Icon, Tooltip, TooltipProvider, cx, focusRing } from '@coa/console-ui';
import { Blocks, Bot, CircleUser, Flag, History, Settings, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ConsoleState } from './state.js';

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** The nav-driven main surfaces. Grows as surfaces land (Prompt/Graph in 4c-3).
 *  `showcase` is a dev-facing reference of the component kit (temporary). */
export const NAV_SECTIONS: readonly NavSection[] = [
  { id: 'cost', label: 'Cost', icon: Wallet },
  { id: 'flags', label: 'Flags', icon: Flag },
  { id: 'timeline', label: 'Timeline', icon: History },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'showcase', label: 'Components', icon: Blocks },
];

export interface NavVm {
  activeId: string;
  setRoute: (id: string) => void;
}

export function selectNavVm(state: ConsoleState): NavVm {
  return { activeId: state.ui.activeMainPanelId, setRoute: state.actions.setRoute };
}

/** A rail item — the active one carries a brass icon, a raised ground, and a brass
 *  edge marker so the selected section is unmistakable (P5 feedback). */
function NavButton({
  icon,
  label,
  active,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        data-active={active ? 'true' : undefined}
        onClick={onSelect}
        className={cx(
          'relative flex h-10 w-10 items-center justify-center rounded-control transition-[color,background-color,transform] duration-fast active:scale-95',
          active ? 'bg-raised text-accent' : 'text-muted hover:bg-raised hover:text-fg',
          focusRing,
        )}
      >
        {/* The brass selection marker sits in the gutter to the LEFT of the rail card
            (negative offset clears the button's centering margin + the card border). */}
        {active && (
          <span className="absolute inset-y-2 -left-2 w-0.75 rounded-full bg-accent" aria-hidden />
        )}
        <Icon name={icon} size={20} />
      </button>
    </Tooltip>
  );
}

function NavRail({ vm }: { vm: NavVm; host: PanelHostApi }): React.JSX.Element {
  return (
    <TooltipProvider>
      <nav
        aria-label="Sections"
        // The rail is the combined card's left edge: outer border on top/left/bottom,
        // rounded left only, and a hairline on the right as the internal divider between
        // it and the main pane (which butts flush against it — root split gap 0).
        className="flex h-full flex-col items-center gap-1.5 rounded-l-surface border border-border-default border-r-hairline bg-subtle py-2.5"
      >
        {NAV_SECTIONS.map((s) => (
          <NavButton
            key={s.id}
            icon={s.icon}
            label={s.label}
            active={s.id === vm.activeId}
            onSelect={() => vm.setRoute(s.id)}
          />
        ))}
        {/* Account + Settings are utility surfaces, pinned to the rail's foot below the
            primary sections. */}
        <div className="mt-auto flex flex-col items-center gap-1.5">
          <NavButton
            icon={CircleUser}
            label="Account"
            active={vm.activeId === 'account'}
            onSelect={() => vm.setRoute('account')}
          />
          <NavButton
            icon={Settings}
            label="Settings"
            active={vm.activeId === 'settings'}
            onSelect={() => vm.setRoute('settings')}
          />
        </div>
      </nav>
    </TooltipProvider>
  );
}

export const navPanel: PanelDefinition<NavVm, ConsoleState> = {
  id: 'nav',
  displayName: 'Navigation',
  render: NavRail,
  selectVm: selectNavVm,
};
