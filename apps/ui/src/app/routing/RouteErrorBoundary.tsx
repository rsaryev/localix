import { useEffect, useRef, useState } from 'react'
import { useRouteError, useNavigate, isRouteErrorResponse } from 'react-router'
import { CircleAlert } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { captureApplicationFailure } from '@/shared/lib/notifications/applicationFailures'
import { tauriFrontendLog } from '@/shared/lib/tauri'
import { openNotificationCenter } from '@/shared/lib/notificationCenterBus'
import { NotificationCenterLauncher } from '@/shared/ui/notification-center/NotificationCenterLauncher'

/**
 * Route-level error UI. Replaces React Router's default "add an errorElement"
 * dev screen with a calm, recoverable surface: it says what failed, keeps the
 * Event Center available even though the ordinary app chrome has unmounted,
 * and offers a reload / go-home path instead of a dead end.
 */
export function RouteErrorBoundary() {
  const error = useRouteError()
  const navigate = useNavigate()

  // `404 Not Found` and a React error message are both raw: one is a status line, the other is
  // written for whoever wrote the component. The line says what happened to the view; the router's
  // status and the thrown text keep their exact wording in the Event Center.
  const routeResponse = isRouteErrorResponse(error) ? error : null
  const message =
    routeResponse?.status === 404 ? 'This view does not exist.' : 'This view could not load.'
  const detail = routeResponse
    ? [
        `${routeResponse.status} ${routeResponse.statusText}`,
        typeof routeResponse.data === 'string' ? routeResponse.data : '',
      ]
        .filter(Boolean)
        .join(' — ')
    : error instanceof Error
      ? (error.stack ?? `${error.name}: ${error.message}`)
      : undefined

  const [entryId, setEntryId] = useState<string>()
  const reportedError = useRef<{ error: unknown } | null>(null)
  useEffect(() => {
    if (reportedError.current?.error === error) return
    reportedError.current = { error }
    console.error('[RouteErrorBoundary] route failed', error)
    tauriFrontendLog('route.error', detail ?? 'Unknown route error')
    setEntryId(captureApplicationFailure(error, { surface: 'Route', kind: 'route' }))
  }, [detail, error])

  // Unlike RootErrorBoundary — which must keep its inline styles because it is
  // the last containment layer and has to render even when the design system
  // did not load — a route error renders inside a working shell, so it reports
  // the way every other surface does and only owns the centring.
  // It DOES keep a ground of its own, unlike the feature panes: a crash screen has to render when
  // the pane that would have painted one may never have mounted. `scripts/pane-ground-guard.test.ts`
  // allowlists it for exactly that reason.
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background p-6 text-foreground">
      <div className="absolute top-3 right-3">
        <NotificationCenterLauncher />
      </div>
      <div role="alert" className="flex max-w-xl flex-col items-center gap-2 text-center">
        <p className="flex items-center gap-2 text-sm text-text-soft">
          <CircleAlert className="size-4 text-status-error" aria-hidden />
          {message}
        </p>
        <button
          type="button"
          onClick={() => openNotificationCenter(entryId)}
          className="text-xs text-text-faint underline-offset-2 hover:text-foreground hover:underline"
        >
          Details
        </button>
      </div>
      <div
        role="group"
        aria-label="Recovery actions"
        className="flex max-w-full flex-wrap items-center justify-center gap-1.5"
      >
        <Button
          type="button"
          variant="mono"
          size="lg"
          onClick={() => {
            void navigate('/', { replace: true })
            platformCapabilities().navigation.reload()
          }}
        >
          Reload app
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={() => {
            void navigate('/', { replace: true })
          }}
        >
          Go home
        </Button>
      </div>
    </div>
  )
}
