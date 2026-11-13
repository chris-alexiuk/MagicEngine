import '@fontsource-variable/instrument-sans/wdth.css';
import '@fontsource-variable/crimson-pro';
import 'mana-font/css/mana.min.css';
import './styles/base.css';
import './styles/card.css';
import './styles/browser.css';
import './styles/decks.css';
import './styles/table.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadArtBundle } from './art';
import { registerImageCache } from './imageCache';

void registerImageCache(import.meta.env.BASE_URL);
// Card art shipped with the app, if this build has any (a host that can't load images from the CDN).
void loadArtBundle(import.meta.env.BASE_URL);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
