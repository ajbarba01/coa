import { TooltipProvider } from '@coa/console-kit';
import { useEffect, useRef } from 'react';
import type { DaemonStatus } from '../shared/methods.js';
import { startConsole, type ConsoleController } from './console.js';
import { publishConsoleState, useConsoleState } from './shell/consoleStore.js';
import { DaemonGate } from './shell/DaemonGate.js';
import { EditMenu } from './shell/EditMenu.js';
import { bindLayoutPersistence } from './shell/layoutPersistence.js';
import { useShell } from './shell/store.js';
import { Workbench } from './shell/Workbench.js';

const POLL_MS = 2000;

/** The composition root: owns the controller lifecycle, mirrors the daemon
 *  status + window state into the shell store, and yields the whole window to
 *  the gate while the daemon is down. */
export function App(): React.JSX.Element {
  const daemon = useShell((s) => s.daemon);
  const controllerRef = useRef<ConsoleController | undefined>(undefined);

  // Track the window's maximized state so the restore glyph matches the real
  // frame (main pushes it on every maximize/unmaximize and on load).
  useEffect(
    () => window.coa.window.onMaximizeChange((m) => useShell.getState().setMaximized(m)),
    [],
  );

  // The active session always has a tab: seed/append on every genuine change of
  // the controller's activeSessionId (boot-time open, browser pick, new session).
  useEffect(() => {
    // Seed from whatever is already active (a publish can precede this effect),
    // then follow genuine changes.
    let prev = useConsoleState.getState()?.ui.activeSessionId;
    if (prev !== undefined) useShell.getState().openTab(prev);
    return useConsoleState.subscribe((s) => {
      const id = s?.ui.activeSessionId;
      if (id !== undefined && id !== prev) useShell.getState().openTab(id);
      prev = id;
    });
  }, []);

  // The open project, for the nav's title-bar segment (main derives it).
  useEffect(() => {
    void window.coa
      .getWorkspace()
      .then((w) => useShell.getState().setWorkspace(w))
      .catch(() => {});
  }, []);

  // Daemon status drives the gate: seed from the current value, then follow the
  // one-way status stream. A transition INTO `running` (launch/restart) triggers
  // a refresh so the surfaces repopulate.
  useEffect(() => {
    const apply = (status: DaemonStatus): void => {
      const cameUp = status === 'running' && useShell.getState().daemon !== 'running';
      useShell.getState().setDaemon(status);
      if (cameUp) {
        void controllerRef.current?.refresh();
        // Recover the boot-time reads a cold start may have fired before the daemon
        // existed (they'd have settled into error Remotes with nothing else to retry
        // them) — see `ConsoleController.hydrate`'s doc for the restart-safety guard.
        void controllerRef.current?.hydrate();
      }
    };
    void window.coa.daemon.status().then(apply);
    return window.coa.daemon.onStatus(apply);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let unbindLayout: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      unbindLayout = await bindLayoutPersistence(window.coa);
      const controller = await startConsole(window.coa, {
        publish: publishConsoleState,
        navigate: (s) => useShell.getState().setSurface(s),
      });
      if (disposed) {
        // The cleanup below already ran (StrictMode's dev double-mount) — the
        // late-resolved bind + controller must tear down here or they leak.
        unbindLayout?.();
        controller.dispose();
        return;
      }
      controllerRef.current = controller;
      // Only read when the daemon is up — a stopped/starting daemon would just error
      // (reads surface cleanly as empty/loading; the gate drives recovery).
      if (useShell.getState().daemon === 'running') void controller.refresh();
      timer = setInterval(() => {
        if (useShell.getState().daemon === 'running') void controllerRef.current?.refresh();
      }, POLL_MS);
    })();
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      unbindLayout?.();
      controllerRef.current?.dispose();
      controllerRef.current = undefined;
    };
  }, []);

  // One tooltip provider for the whole frame: shared open delay + the warm
  // window that lets adjacent icon buttons show their tips instantly. The edit menu is
  // frame chrome too — every field on either side of the gate gets it.
  return (
    <TooltipProvider>
      <EditMenu />
      {daemon === 'running' ? <Workbench /> : <DaemonGate />}
    </TooltipProvider>
  );
}
