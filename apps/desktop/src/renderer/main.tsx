import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { tokensToCss } from '@coa/console-ui';
import './globals.css';

const style = document.createElement('style');
style.id = 'coa-tokens';
style.textContent = tokensToCss('dark', 'compact');
document.head.appendChild(style);

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
