import { useEffect, useRef, useState } from 'react';
import { AppShell, DaemonStatus, type DaemonStatusProps } from '@coa/console-ui';
import { startConsole, type ConsoleController } from './console.js';

const POLL_MS = 2000;

export function App(): React.JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ConsoleController | undefined>(undefined);
  const statusRef = useRef<DaemonStatusProps['status']>('stopped');
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatusProps['status']>('stopped');

  // Track daemon status for the title-bar control: seed from the current value, then
  // follow the one-way status stream main pushes on every transition. A transition
  // INTO `running` (launch/restart) triggers a refresh so the panels repopulate.
  useEffect(() => {
    const apply = (status: DaemonStatusProps['status']): void => {
      const cameUp = status === 'running' && statusRef.current !== 'running';
      statusRef.current = status;
      setDaemonStatus(status);
      if (cameUp) void controllerRef.current?.refresh();
    };
    void window.coa.daemon.status().then(apply);
    return window.coa.daemon.onStatus(apply);
  }, []);

  useEffect(() => {
    const container = slotRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    void (async () => {
      const controller = await startConsole(container, window.coa);
      if (disposed) {
        controller.dispose();
        return;
      }
      controllerRef.current = controller;
      // Only read when the daemon is up — a stopped/starting daemon would just error
      // (reads surface cleanly as empty/loading; the title-bar control drives recovery).
      if (statusRef.current === 'running') void controller.refresh();
      timer = setInterval(() => {
        if (statusRef.current === 'running') void controllerRef.current?.refresh();
      }, POLL_MS);
    })();
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      controllerRef.current?.dispose();
      controllerRef.current = undefined;
    };
  }, []);

  return (
    <AppShell
      platform={window.coa.platform}
      workspaceName="myproject"
      statusSlot={
        <DaemonStatus
          status={daemonStatus}
          onStart={() => void window.coa.daemon.start()}
          onStop={() => void window.coa.daemon.stop()}
          onRestart={() => void window.coa.daemon.restart()}
        />
      }
    >
      <div ref={slotRef} style={{ height: '100%' }} />
    </AppShell>
  );
}
