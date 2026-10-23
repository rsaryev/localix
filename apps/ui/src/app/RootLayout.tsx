import './devPerformance'
import { startBrowserLinkRouting } from './browserLinkRouting'
import { installWorkbenchGestures } from '@/shared/lib/workbenchGesture'
import { startWorkspaceResourceSync } from './workspaceResourceSync'
import { lazy, Suspense, useEffect, useLayoutEffect } from 'react'
import { usePreviewHosts } from '@/features/inspector/model/previewHosts'
import { shouldMountBrowserHost } from '@/features/inspector/model/browserHostPolicy'
import { Outlet, useLocation } from 'react-router'
import { ActionConfirm } from '@/shared/ui/ActionConfirm'
import { useFontFamily } from '@/features/settings/model/useFontFamily'
import { useSettingsStore } from '@/shared/lib/user-settings/settingsStore'
import { startSettingsBootstrap } from '@/features/settings/model/settingsBootstrap'
import { useSyncKeybindings } from '@/features/settings/model/useKeybindings'
import { setActiveEventRoute } from '@/shared/lib/notifications/context'
import { installWhenIdle } from '@/shared/lib/runWhenIdle'
import { startRpcEventTracing } from '@/shared/lib/notifications/rpcInstrumentation'
import {
  publishUnreportedFailure,
  startGlobalErrorCapture,
} from '@/shared/lib/notifications/applicationFailures'
import { startHttpEventTracing } from '@/shared/lib/notifications/httpInstrumentation'
import { startUnreportedFailurePublisher } from '@/shared/lib/notifications/incidentFallback'
import { startNotificationCommandHandlers } from '@/shared/lib/notifications/runtime'
import { startNotificationSync } from '@/shared/lib/notifications/inboxSync'
import { startOpenChatRead } from '@/shared/lib/notifications/openChatRead'
import { retrySessionRun } from '@/entities/chat/model/retrySessionRun'
import { startUserIntentCapture } from '@/shared/lib/notifications/userIntent'
import { startRealtimeEventTracing } from '@/shared/lib/notifications/realtimeInstrumentation'
import { startDesktopEventTracing } from '@/shared/lib/notifications/desktopInstrumentation'
import { isDesktop } from '@localixai/kit/environment'

const BackgroundPreviews = lazy(() => import('@/features/inspector/ui/BackgroundPreviews'))

/** A row's Retry goes through the chat's own regenerate, so the chat paints the run as started. */
const startChatNotificationCommands = () =>
  startNotificationCommandHandlers({
    regenerate: (run) => retrySessionRun(run.sessionId, run.projectId, run.runId),
  })

/**
 * App-level shell rendered once for every route. Holds cross-cutting concerns
 * (fonts and settings bootstrap) so they survive route changes, and renders the
 * matched route through <Outlet/>. Notifications live in the durable center.
 */
export function RootLayout() {
  useFontFamily()
  const hasPreviewHosts = usePreviewHosts((s) => Object.keys(s.live).length > 0)
  useSyncKeybindings() // mirror persisted keybinding overrides into the shared read-store
  const loadFromBackend = useSettingsStore((s) => s.loadFromBackend)
  const { pathname } = useLocation()

  useLayoutEffect(() => {
    setActiveEventRoute(pathname)
  }, [pathname])

  useEffect(() => {
    return startSettingsBootstrap(loadFromBackend)
  }, [loadFromBackend])

  useEffect(() => startWorkspaceResourceSync(), [])
  useLayoutEffect(() => startBrowserLinkRouting(), [])
  useLayoutEffect(() => installWorkbenchGestures(), [])

  // ── Startup instrumentation, staged in two phases ───────────────────────────
  //
  // BEFORE PAINT. Each of these observes something that already happens during
  // boot, so deferring it is not a latency trade — it is a hole in the record:
  //
  //  - global error capture is the process-wide safety net; the errors it exists
  //    to journal include the ones thrown while the app is still coming up.
  //  - the unreported-failure publisher is a single assignment, and the fallback
  //    timers that read it are armed by boot requests with a 900 ms grace. Deferred,
  //    a failed boot mutation would find no publisher and vanish.
  //  - RPC and HTTP tracing observe the settings bootstrap and every other request
  //    the shell fires on mount. Installed late, a failed boot request produces
  //    neither a trace step nor its fallback notification.
  //  - realtime tracing observes the event socket's first connect. A connect
  //    diagnostic is a one-shot event: miss it and the outage is never journaled.
  //  - the notification sync reads the server journal on that same first connect;
  //    installed late, the bell and the dock badge are empty until a reconnect.
  useEffect(() => startGlobalErrorCapture(), [])
  useEffect(() => startNotificationSync(), [])
  useEffect(() => startOpenChatRead(), [])
  useEffect(() => startUnreportedFailurePublisher(publishUnreportedFailure), [])
  useEffect(() => startRpcEventTracing(), [])
  useEffect(() => startHttpEventTracing(), [])
  useEffect(() => startRealtimeEventTracing(), [])

  // ON IDLE. Nothing below can observe anything until there is a painted UI the
  // user can act on, so each one is staged off the first-paint commit. The gap is
  // bounded by `IDLE_TIMEOUT_MS`, or by `IDLE_FALLBACK_DELAY_MS` on the WebKit
  // shell, and each one's worst case in that gap is stated where it is staged.
  //
  // Command handlers back notification actions; a notification must be rendered
  // and clicked first, which cannot happen before the shell paints.
  useEffect(() => installWhenIdle(startChatNotificationCommands), [])
  // Intent capture annotates requests with the control that caused them. In the
  // gap, an interaction is not attributed: the request is still traced, it just
  // loses its `userInitiated` context. Metadata, not the record itself.
  useEffect(() => installWhenIdle(startUserIntentCapture), [])
  // Desktop invoke tracing drops every event that is neither failed nor
  // user-initiated, and boot-time invokes (theme, title, runtime status) are
  // best-effort commands that raise no fallback notification either way. The gap
  // costs at most a diagnostic breadcrumb for a failed boot invoke.
  useEffect(() => installWhenIdle(startDesktopEventTracing), [])

  return (
    <>
      <Outlet />
      {shouldMountBrowserHost(isDesktop, hasPreviewHosts) && (
        <Suspense fallback={null}>
          <BackgroundPreviews />
        </Suspense>
      )}
      {/* One host for the whole app: a link from a book, a model's Markdown, the
          terminal or a mini app panel all wait on this same confirmation — and so
          will the next outward action, without a second dialog. */}
      <ActionConfirm />
    </>
  )
}
