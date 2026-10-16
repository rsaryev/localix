import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { reconcileUnavailableContributedItems } from '@/features/workspace-grid/model'
import { eventSocket } from '@/shared/api/eventSocket'
import {
  pluginContribSnapshot,
  pluginContribSourceFor,
  preparePluginContribScope,
  refetchActivePluginContrib,
  refetchPluginContrib,
  startPluginContribSync,
  subscribePluginContrib,
} from '@/shared/contrib/enabledPlugins'
import {
  listThirdPartyViews,
  subscribeThirdPartyViews,
  thirdPartyViewsVersion,
} from '@/shared/contrib/runtimeViews'
import { whenUiSurfacesReady } from '@/shared/contrib/discover'
import { startUiLocationCatalogSync } from '@/shared/contrib/uiLocationCatalogSync'
import { enqueueMicrotask } from '@/shared/lib/enqueueMicrotask'
import { useSettledContribScope } from './useSettledContribScope'

export function usePluginContributions({
  routeProjectId: routeScope,
  onHomeRoute,
}: {
  routeProjectId: string | null
  /** A home route redirects to a project; the scope holds across it (`useSettledContribScope`). */
  onHomeRoute: boolean
}) {
  const routeProjectId = useSettledContribScope(routeScope, onHomeRoute)
  // The LIVE enabled-plugin contribution set (names + views) — an external store
  // refetched on the server's `resources.changed` event, so a toggle applies with no
  // page reload. `enabledNames === null` = not loaded yet (gates fail closed).
  const {
    document,
    enabledNames: enabledPluginNames,
    plugins,
  } = useSyncExternalStore(subscribePluginContrib, pluginContribSnapshot)
  useEffect(() => {
    if (enabledPluginNames === null) return
    reconcileUnavailableContributedItems()
  }, [enabledPluginNames])
  // Publish as soon as CORE discovery has settled — `discoverUi()` starts that
  // staged pass at app composition, so this is one chunk load, not a round trip.
  // Do not wait for plugin bootstrap/hydration: that left early agent runs with
  // the workbench capability but no catalog. When plugin activation becomes
  // authoritative, the registry revision triggers an atomic follow-up snapshot
  // with the newly available destinations.
  useEffect(() => {
    if (routeProjectId === undefined) return
    // Fail closed synchronously at the route boundary. Otherwise the first
    // project-B catalog can capture project-A plugin destinations while B's
    // contribution discovery is still in flight.
    preparePluginContribScope(routeProjectId)
    return startUiLocationCatalogSync(routeProjectId, whenUiSurfacesReady())
  }, [routeProjectId])
  // Bridged views declared by enabled INSTALLED (non-bundled) plugins — the runtime
  // discovery pass (runtimeViews). A subscribe/version store, not React state,
  // because the same set feeds several surfaces (rail sections, rail buttons, and
  // the palette commands below); the version bumps on every (re)sync.
  const thirdPartyViewsV = useSyncExternalStore(subscribeThirdPartyViews, thirdPartyViewsVersion)

  // A restored shell frame has enabled names, but its plugin UI modules have not
  // been imported yet. Only a completed server snapshot also completes UI discovery.
  return {
    enabledPluginNames,
    plugins,
    pluginsPending: document === null,
    thirdPartyViewsV,
    /** The settled scope, which the sync below must load — not the raw route. */
    contribScope: routeProjectId,
  }
}

export function usePluginContributionsSync({
  hasHydrated,
  routeProjectId,
  thirdPartyViewsV,
}: {
  hasHydrated: boolean
  /** `usePluginContributions().contribScope`; `undefined` while a cold home route holds. */
  routeProjectId: string | null | undefined
  thirdPartyViewsV: number
}) {
  // Initial load of the plugin contribution set (panels + enabled names +
  // third-party views). Later refetches ride the `resources.changed` stream event
  // (agent-runtime restarts the same convergent sync), so enable/disable
  // applies live — no page reload.
  useEffect(() => {
    if (!hasHydrated || routeProjectId === undefined) return
    let disposed = false
    let stop: (() => void) | null = null
    // Defer one microtask so React Strict Mode's setup→cleanup→setup probe can
    // cancel its throwaway setup before it starts three network reads. The live
    // setup still begins in the same frame; stream-triggered resyncs stay immediate.
    enqueueMicrotask(() => {
      if (!disposed) {
        stop = startPluginContribSync(() =>
          refetchPluginContrib(pluginContribSourceFor(routeProjectId)),
        )
      }
    })
    return () => {
      disposed = true
      stop?.()
    }
  }, [hasHydrated, routeProjectId])
  // Close the startup half of that stream contract. The backend host wires plugin
  // backends OFF the readiness path on purpose — an unhealthy plugin must not be
  // able to stop the app from starting — and announces the result with a single
  // `resources.changed`. A cold desktop start has no socket yet when that lands, and
  // a first connect declares no cursor, so the server replays nothing: the set the
  // UI fetched a moment earlier would stay authoritative forever. Re-reading once
  // the socket is live makes the pair total. `publish()` only advances its version
  // when the capability set actually moved, so the common "nothing changed" case
  // costs exactly one GET and no dependent refetch.
  useEffect(() => {
    if (!hasHydrated) return
    return eventSocket.onConnected(() => {
      void refetchActivePluginContrib()
    })
  }, [hasHydrated])
  // Recomputed when the runtime view store changes (add/remove on (re)sync). The
  // version is the dep even though the body reads the store directly — the linter
  // can't see that data dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => listThirdPartyViews(), [thirdPartyViewsV])
}
