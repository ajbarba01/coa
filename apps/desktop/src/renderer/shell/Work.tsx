import { CapsLabel, StatusDot } from '@coa/console-kit';
import { useConsoleState } from './consoleStore.js';
import { useShell } from './store.js';
import { AppWindowControls } from './windowControls.js';

/** Right column: the active session's working state, honestly floored — today
 *  that is the root agent row (real title + real run status); the subagent
 *  tree, changes, worktree, and record sections arrive with the surfaces pass
 *  and render NOTHING until then (quiet register: no placeholder chrome).
 *  Title-bar segment carries the AGENTS header + the window controls. */
export function Work(): React.JSX.Element {
  const workWidth = useShell((s) => s.workWidth);
  const toggleWork = useShell((s) => s.toggleWork);
  // In search mode the column previews whichever session the browser hovers.
  const previewId = useShell((s) => s.previewId);
  const state = useConsoleState((s) => s);
  const activeId = previewId ?? state?.ui.activeSessionId;
  const sessions = state?.data.sessions.status === 'ok' ? state.data.sessions.value : [];
  const session = sessions.find((s) => s.id === activeId);
  const running = activeId !== undefined && state?.ui.runStatus[activeId] !== undefined;

  return (
    <div className="flex flex-none flex-col border-l border-s4 bg-s2" style={{ width: workWidth }}>
      <div className="flex h-(--titlebar-h) flex-none items-stretch">
        <CapsLabel className="self-center px-3.5 pt-0 pb-0">agents</CapsLabel>
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <AppWindowControls />
      </div>

      {session ? (
        <div className="pb-1">
          <div className="flex items-center gap-2 px-3.5 py-1 text-sec font-[550] text-s12">
            <StatusDot status={running ? 'running' : 'idle'} />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{session.title}</span>
            <span className="ml-auto font-mono text-caps text-s6">root</span>
          </div>
        </div>
      ) : (
        <div className="px-3.5 pt-4 text-code text-s7">no session</div>
      )}

      <div className="mt-auto flex items-center border-t border-s3 px-3.5 py-2">
        <button
          type="button"
          aria-label="hide session panel"
          onClick={toggleWork}
          className="slip ml-auto cursor-pointer font-mono text-body text-s7 hover:text-s9"
        >
          »
        </button>
      </div>
    </div>
  );
}

/** The reopen affordance floats in the window's bottom-right corner — exactly
 *  where » folded the column away, so the toggle round-trips in place. */
export function ReopenWork(): React.JSX.Element {
  const toggleWork = useShell((s) => s.toggleWork);
  return (
    <button
      type="button"
      aria-label="show session panel"
      onClick={toggleWork}
      className="slip fixed right-1.5 bottom-1.5 z-(--z-seam) flex h-8 w-8 cursor-pointer items-center justify-center font-mono text-body text-s7 hover:text-s9"
    >
      «
    </button>
  );
}
