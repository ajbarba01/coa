import type { PanelDefinition, PanelHostApi } from '@coa/console-layout';
import type { DaemonState } from './state.js';

/** A registered-but-not-yet-wired surface: real chrome, honest "arrives later"
 *  copy, no emoji. Swapped for a live panel when its M8 seam lands (spec §16). */
export function makePlaceholderPanel(
  id: string,
  displayName: string,
  note: string,
): PanelDefinition<string, DaemonState> {
  function View({ vm }: { vm: string; host: PanelHostApi }): React.JSX.Element {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <div className="text-[13px] font-medium text-muted">{displayName}</div>
          <div className="mt-1 text-[12px] text-faint">{vm}</div>
        </div>
      </div>
    );
  }
  return { id, displayName, render: View, selectVm: () => note };
}
