import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles.css';
import './styles/intro.css';
import { isDemoMode } from './demoMode';
import { log } from './logger';

log.info(isDemoMode() ? 'mode: demo (no backend, API calls skipped)' : 'mode: full stack (API enabled)');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
