import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { ButtonLink } from '../components/Button'
import { SiteLayout } from '../components/SiteLayout'
import { HomePage } from '../pages/HomePage'
import { docPages } from '../generated/docs'

// Catch-all for mistyped URLs — without it an unknown path renders the layout
// with a blank content area.
function NotFound() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center px-5 py-28 text-center">
      <p className="font-heading text-5xl font-semibold tracking-tight text-text-faint">404</p>
      <h1 className="mt-4 font-heading text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-text-soft">
        That page doesn't exist. Try the docs or head back home.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink to="/">Back home</ButtonLink>
        <ButtonLink to="/docs" variant="outline">
          Browse docs
        </ButtonLink>
      </div>
    </div>
  )
}

// Docs carry the full generated markdown corpus — keep it out of the initial
// chunk so the marketing home stays light. Loaded on first /docs navigation.
const DocsPage = lazy(() => import('../pages/DocsPage').then((m) => ({ default: m.DocsPage })))
const firstDocPath = docPages[0] ? `/docs/${docPages[0].slug}` : '/'

const DocsFallback = <LoadingHint className="min-h-[50vh]">Loading documentation…</LoadingHint>

/**
 * The one route table. The browser mounts it under `BrowserRouter` and the build renders `/`
 * from it under `StaticRouter`, so the pre-rendered homepage is the same tree the client
 * hydrates rather than a hand-kept copy that drifts from it.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/docs" element={<Navigate replace to={firstDocPath} />} />
        <Route
          path="/docs/:slug"
          element={
            <Suspense fallback={DocsFallback}>
              <DocsPage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
