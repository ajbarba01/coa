import { WindowControls } from '@coa/console-kit';
import { useShell } from './store.js';

/** The kit window controls wired to the real window IPC. Renders in whichever
 *  title-bar segment is rightmost (the dock's when open, the center's otherwise,
 *  and on the daemon gate). Nothing on macOS — native traffic lights own the
 *  frame there. */
export function AppWindowControls(): React.JSX.Element | null {
  const maximized = useShell((s) => s.maximized);
  if (window.coa.platform === 'darwin') return null;
  return (
    <WindowControls
      isMaximized={maximized}
      onMinimize={() => void window.coa.window.minimize()}
      onToggleMaximize={() => void window.coa.window.toggleMaximize()}
      onClose={() => void window.coa.window.close()}
    />
  );
}
