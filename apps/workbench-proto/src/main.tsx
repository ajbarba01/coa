import { ZoomProvider } from '@coa/console-kit';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { seedSessions } from './mock.js';
import { ZOOM } from './store.js';
import './index.css';

seedSessions();

const root = document.getElementById('root');
if (!root) throw new Error('no #root');
createRoot(root).render(
  <StrictMode>
    <ZoomProvider value={ZOOM}>
      <App />
    </ZoomProvider>
  </StrictMode>,
);
