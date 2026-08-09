import { Button, cx } from '@coa/console-kit';
import { useEffect, useRef, useState } from 'react';
import { DRAG } from './appRegion.js';
import { AppWindowControls } from './windowControls.js';
import { useShell } from './store.js';

const MESSAGE: Record<'starting' | 'stopped' | 'error', string> = {
  starting: 'Starting the coa daemon…',
  stopped: 'The coa daemon is not running.',
  error: 'The coa daemon hit an error.',
};

/** While the gate is up and the daemon is down, retry on an interval: `start` probes the
 *  pipe first, so a daemon that appears out-of-band (a terminal `coa serve`, another
 *  workspace) is adopted without a click — the gate must never sit stuck in front of a
 *  daemon that is actually up. */
const RETRY_MS = 5000;

/** How many times a start may fail THE SAME WAY before the gate stops relaunching. A
 *  daemon that cannot start says so identically every time; respawning it every five
 *  seconds forever only piles up dead children. Past this the ticks switch to `adopt`,
 *  which attaches to an already-serving daemon and never spawns — so a `coa serve` started
 *  in a terminal is still picked up without a click — and the button is how a user asks
 *  for another launch. Only a STATED reason can repeat: a plain `stopped` (nothing has
 *  gone wrong, the daemon simply isn't up) keeps retrying for as long as the gate is up. */
const IDENTICAL_FAILURE_LIMIT = 5;

/** No daemon, no console — the whole window yields to one message and one
 *  action. The chrome strip survives the gate so the window stays movable
 *  and closable while the daemon is down. */
export function DaemonGate(): React.JSX.Element {
  const daemon = useShell((s) => s.daemon);
  const reason = useShell((s) => s.daemonReason);
  const state = daemon === 'running' ? 'starting' : daemon;
  // How many ticks in a row have seen this exact failure. A ref, not state: it steers the
  // next tick and must not re-run the interval effect every time it moves.
  const repeats = useRef<{ reason: string | undefined; count: number }>({
    reason: undefined,
    count: 0,
  });
  const [stalled, setStalled] = useState(false);

  const startDaemon = (): void => {
    // An explicit click is a fresh ask: let the automatic retries spawn again.
    repeats.current = { reason: undefined, count: 0 };
    setStalled(false);
    void window.coa.daemon.start();
  };

  useEffect(() => {
    if (state === 'starting') return;
    const t = setInterval(() => {
      if (useShell.getState().daemon === 'running') return;
      const seen = useShell.getState().daemonReason;
      const tally = repeats.current;
      repeats.current =
        seen !== undefined && seen === tally.reason
          ? { reason: seen, count: tally.count + 1 }
          : { reason: seen, count: 1 };
      const capped = repeats.current.count > IDENTICAL_FAILURE_LIMIT;
      setStalled(capped);
      void (capped ? window.coa.daemon.adopt() : window.coa.daemon.start());
    }, RETRY_MS);
    return () => clearInterval(t);
  }, [state]);

  return (
    <div className="slip-enter flex h-full flex-col bg-s1">
      {/* the whole strip drags; interactive children opt out (appRegion policy) */}
      <div className="flex h-(--titlebar-h) flex-none items-stretch" style={DRAG}>
        <div className="flex-1" />
        <AppWindowControls />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        {/* Deliberately larger than Nav's compact 8px daemon dot (DAEMON_DOT_SIZE): this
         *  one is the whole hero state, alone on the screen, not a line of inline chrome. */}
        <span
          className={cx(
            'h-2.5 w-2.5 rounded-full',
            state === 'starting' ? 'animate-pulse bg-warn' : 'bg-crit',
          )}
        />
        <div className="text-body text-s9">{MESSAGE[state]}</div>
        {state !== 'starting' && reason !== undefined && (
          <div className="max-w-lg px-8 text-center text-sec wrap-break-word text-s8">{reason}</div>
        )}
        {state !== 'starting' && stalled && (
          <div className="text-cap text-s7">
            it has failed the same way each time — retrying automatically has stopped
          </div>
        )}
        {state !== 'starting' && (
          <Button variant="primary" onClick={startDaemon}>
            Start daemon
          </Button>
        )}
      </div>
    </div>
  );
}
