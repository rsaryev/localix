import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { LandingPage } from '@/pages/landing';
import '@/shared/styles/global.css';
// The site's own tokens, last: they win over the template's.
import '@content/theme.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

const app = (
  <StrictMode>
    <LandingPage />
  </StrictMode>
);

// The build prerenders the page into #root (scripts/prerender.mjs), so the text is there before any script
// runs; the dev server serves an empty #root.
if (container.hasChildNodes()) hydrateRoot(container, app);
else createRoot(container).render(app);
