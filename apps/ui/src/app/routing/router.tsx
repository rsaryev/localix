import { lazy, Suspense } from 'react'
import { createHashRouter } from 'react-router'
import { ChatPage } from '@/pages/chat'
import { GridPreviewPage } from '@/pages/grid-preview'
import { RootLayout } from '../RootLayout'
import { RouteErrorBoundary } from './RouteErrorBoundary'
import { ROUTE_PATTERNS } from '@/shared/routing/routes'
import { LoadingHint } from '@localixai/kit/empty-hint'

// The workspace shell is monolithic: Settings/Stats/plugin views are inspector
// panels *inside* ChatPage (opened from the rail, no URL of their own), not
// separate pages. So every route renders the same ChatPage element under the
// shared layout Outlet — React keeps it mounted across navigations (same element
// at the same slot), while `useParams` exposes the active session/section.
const chatElement = <ChatPage />

// First-run / replay only — lazy so the onboarding wizard graph stays out of
// the entry chunk (it renders solely on the /setup route).
// Lazy route boundary is module configuration, not a refreshable component export.
// eslint-disable-next-line react-refresh/only-export-components
const SetupPage = lazy(() => import('@/pages/setup').then((m) => ({ default: m.SetupPage })))

export const router = createHashRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: ROUTE_PATTERNS.index, element: chatElement },
      // First-run / replay setup — its OWN full page, not an app overlay.
      {
        path: ROUTE_PATTERNS.setup,
        element: (
          <Suspense fallback={<LoadingHint>Opening setup…</LoadingHint>}>
            <SetupPage />
          </Suspense>
        ),
      },
      // Dev-only harness for the editor grid (Phase 3) — listed before catchAll.
      { path: 'grid-preview', element: <GridPreviewPage /> },
      { path: ROUTE_PATTERNS.projectChat, element: chatElement },
      { path: ROUTE_PATTERNS.legacyChat, element: chatElement },
      { path: ROUTE_PATTERNS.catchAll, element: chatElement },
    ],
  },
])
