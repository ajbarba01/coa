import { Button, cx } from '@coa/console-kit';
import { useEffect } from 'react';
import { AppWindowControls } from './windowControls.js';
import { useShell } from './store.js';

const MESSAGE: Record<'starting' | 'stopped' | 'error', string> = {
  starting: 'starting the coa daemon…',
  stopped: 'the coa daemon is not running',
  error: 'the coa daemon hit an error',
};

/** While the gate is up and the daemon is down, retry `start` on an interval:
 *  `start` probes the pipe first, so a daemon that appears out-of-band (a
 *  terminal `coa serve`, another workspace) is adopted without a click — the
 *  gate must never sit stuck in front of a daemon that is actually up. */
const RETRY_MS = 5000;

/** No daemon, no console — the whole window yields to one message and one
 *  action. The chrome strip survives the gate so the window stays movable
 *  and closable while the daemon is down. */
export function DaemonGate(): React.JSX.Element {
  const daemon = useShell((s) => s.daemon);
  const state = daemon === 'running' ? 'starting' : daemon;

  useEffect(() => {
    if (state === 'starting') return;
    const t = setInterval(() => {
      if (useShell.getState().daemon !== 'running') void window.coa.daemon.start();
    }, RETRY_MS);
    return () => clearInterval(t);
  }, [state]);

  return (
    <div className="slip-enter flex h-full flex-col bg-s1">
      <div className="flex h-(--titlebar-h) flex-none items-stretch">
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <AppWindowControls />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <span
          className={cx(
            'h-2.5 w-2.5 rounded-full',
            state === 'starting' ? 'animate-pulse bg-warn' : 'bg-crit',
          )}
        />
        <div className="text-body text-s9">{MESSAGE[state]}</div>
        {state !== 'starting' && (
          <Button variant="primary" onClick={() => void window.coa.daemon.start()}>
            Start daemon
          </Button>
        )}
      </div>
    </div>
  );
}
