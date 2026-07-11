import { ZoomProvider } from '@coa/console-kit';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { runScriptedTurn, seedSessions } from './mock.js';
import { ZOOM, useWorkbench } from './store.js';
import './index.css';

seedSessions();

// Design-lab deep links: ?surface=showcase (etc.) and ?session=<id> land the
// lab on a specific state for review/screenshots without clicking through.
const params = new URLSearchParams(window.location.search);
const surface = params.get('surface');
if (surface !== null) useWorkbench.getState().setSurface(surface);
const session = params.get('session');
if (session !== null && useWorkbench.getState().sessions[session] !== undefined)
  useWorkbench.getState().select(session);
// ?demo=1 fires the scripted turn hands-free — watch the whole motion story.
if (params.get('demo') !== null) {
  setTimeout(() => {
    void runScriptedTurn(useWorkbench.getState().activeId, 'Fix the flaky pipe-transport test.');
  }, 900);
}

const root = document.getElementById('root');
if (!root) throw new Error('no #root');
createRoot(root).render(
  <StrictMode>
    <ZoomProvider value={ZOOM}>
      <App />
    </ZoomProvider>
  </StrictMode>,
);
