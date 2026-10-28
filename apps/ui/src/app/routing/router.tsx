import { createHashRouter } from 'react-router'
import { ChatPage } from '@/pages/chat'
import { GridPreviewPage } from '@/pages/grid-preview'
import { RootLayout } from '../RootLayout'
import { RouteErrorBoundary } from './RouteErrorBoundary'
import { ROUTE_PATTERNS } from '@/shared/routing/routes'

// The workspace shell is monolithic: Settings/Stats/mini app views are inspector
// panels *inside* ChatPage (opened from the rail, no URL of their own), not
// separate pages. So every route renders the same ChatPage element under the
// shared layout Outlet — React keeps it mounted across navigations (same element
// at the same slot), while `useParams` exposes the active session/section.
const chatElement = <ChatPage />

export const router = createHashRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: ROUTE_PATTERNS.index, element: chatElement },
      // Dev-only harness for the editor grid (Phase 3) — listed before catchAll.
      { path: 'grid-preview', element: <GridPreviewPage /> },
      { path: ROUTE_PATTERNS.projectChat, element: chatElement },
      { path: ROUTE_PATTERNS.catchAll, element: chatElement },
    ],
  },
])
