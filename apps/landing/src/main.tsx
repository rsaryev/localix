import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './styles.css'
import { AppRoutes } from './app/AppRoutes'
import { readDocBootstrap } from './pages/docs/docBootstrap'
import { ErrorBoundary } from './components/ErrorBoundary'

const initialDoc = readDocBootstrap(document, window.location.pathname)

const app = (
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AppRoutes initialDoc={initialDoc} />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)

const root = document.getElementById('root')!

// `/` is pre-rendered from this very tree (scripts/render-home.tsx), so React adopts the markup
// already painted instead of replacing it. Any other URL starts from a docs shell that is not
// the route table, so it is mounted fresh while its article is retained as the loading fallback.
if (root.hasAttribute('data-prerendered') && window.location.pathname === '/') {
  hydrateRoot(root, app)
} else {
  createRoot(root).render(app)
}
