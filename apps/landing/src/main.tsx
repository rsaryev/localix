import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './styles.css'
import { AppRoutes } from './app/AppRoutes'
import { ErrorBoundary } from './components/ErrorBoundary'

const app = (
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)

const root = document.getElementById('root')!

// `/` is pre-rendered from this very tree (scripts/render-home.tsx), so React adopts the markup
// already painted instead of replacing it. Any other URL starts from a docs shell that is not
// this tree, so it is mounted fresh.
if (root.hasAttribute('data-prerendered') && window.location.pathname === '/') {
  hydrateRoot(root, app)
} else {
  createRoot(root).render(app)
}
