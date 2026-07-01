import { useEffect, useRef } from 'react';
import { AppShell } from '@coa/console-ui';
import { startConsole, type ConsoleController } from './console.js';

const POLL_MS = 2000;

export function App(): React.JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = slotRef.current;
    if (!container) return;
    let controller: ConsoleController | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    void (async () => {
      controller = await startConsole(container, window.coa);
      if (disposed) {
        controller.dispose();
        return;
      }
      await controller.refresh();
      timer = setInterval(() => void controller?.refresh(), POLL_MS);
    })();
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      controller?.dispose();
    };
  }, []);

  return (
    <AppShell
      platform={window.coa.platform}
      workspaceName="myproject"
      onRaw={() => {
        // The `coa raw` transparency view is a later surface; the affordance is
        // always present and focusable in the chrome (D85).
      }}
    >
      <div ref={slotRef} style={{ height: '100%' }} />
    </AppShell>
  );
}
