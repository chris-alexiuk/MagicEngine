import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/crimson-pro';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerImageCache } from './imageCache';

void registerImageCache(import.meta.env.BASE_URL);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
