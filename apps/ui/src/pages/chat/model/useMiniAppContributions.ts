import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { reconcileUnavailableContributedItems } from '@/entities/workspace-grid/model'
import {
  miniAppContribSnapshot,
  miniAppContribSourceFor,
  prepareMiniAppContribScope,
  refetchMiniAppContrib,
  startMiniAppContribSync,
  subscribeMiniAppContrib,
} from '@/shared/contrib/enabledMiniApps'
import {
  listThirdPartyViews,
  subscribeThirdPartyViews,
  thirdPartyViewsVersion,
} from '@/shared/contrib/runtimeViews'
import { whenUiSurfacesReady } from '@/shared/contrib/discover'
import { startUiLocationCatalogSync } from '@/shared/contrib/uiLocationCatalogSync'
import { enqueueMicrotask } from '@/shared/lib/enqueueMicrotask'
import { useSettledContribScope } from './useSettledContribScope'

export function useMiniAppContributions({
  routeProjectId: routeScope,
  onHomeRoute,
}: {
  routeProjectId: string | null
  /** A home route redirects to a project; the scope holds across it (`useSettledContribScope`). */
  onHomeRoute: boolean
}) {
  const routeProjectId = useSettledContribScope(routeScope, onHomeRoute)
  // The LIVE enabled-mini-app contribution set (names + views) — an external store
  // refetched on the server's `resources.changed` event, so a toggle applies with no
  // page reload. `enabledNames === null` = not loaded yet (gates fail closed).
  const {
    document,
    enabledNames: enabledMiniAppNames,
    miniApps,
  } = useSyncExternalStore(subscribeMiniAppContrib, miniAppContribSnapshot)
  useEffect(() => {
    if (enabledMiniAppNames === null) return
    reconcileUnavailableContributedItems()
  }, [enabledMiniAppNames])
  // Publish as soon as CORE discovery has settled — `discoverUi()` starts that
  // staged pass at app composition, so this is one chunk load, not a round trip.
  // Do not wait for mini app bootstrap/hydration: that left early agent runs with
  // the workbench capability but no catalog. When mini app activation becomes
  // authoritative, the registry revision triggers an atomic follow-up snapshot
  // with the newly available destinations.
  useEffect(() => {
    if (routeProjectId === undefined) return
    // Fail closed synchronously at the route boundary. Otherwise the first
    // project-B catalog can capture project-A mini app destinations while B's
    // contribution discovery is still in flight.
    prepareMiniAppContribScope(routeProjectId)
    return startUiLocationCatalogSync(routeProjectId, whenUiSurfacesReady())
  }, [routeProjectId])
  // Bridged views declared by enabled mini apps — the runtime
  // discovery pass (runtimeViews). A subscribe/version store, not React state,
  // because the same set feeds several surfaces (rail sections, rail buttons, and
  // the palette commands below); the version bumps on every (re)sync.
  const thirdPartyViewsV = useSyncExternalStore(subscribeThirdPartyViews, thirdPartyViewsVersion)

  // A restored shell frame has enabled names, but its mini app UI modules have not
  // been imported yet. Only a completed server snapshot also completes UI discovery.
  return {
    enabledMiniAppNames,
    miniApps,
    miniAppsPending: document === null,
    thirdPartyViewsV,
    /** The settled scope, which the sync below must load — not the raw route. */
    contribScope: routeProjectId,
  }
}

export function useMiniAppContributionsSync({
  hasHydrated,
  routeProjectId,
  thirdPartyViewsV,
}: {
  hasHydrated: boolean
  /** `useMiniAppContributions().contribScope`; `undefined` while a cold home route holds. */
  routeProjectId: string | null | undefined
  thirdPartyViewsV: number
}) {
  // Initial load of the mini app contribution set (panels + enabled names +
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
        stop = startMiniAppContribSync(() =>
          refetchMiniAppContrib(miniAppContribSourceFor(routeProjectId)),
        )
      }
    })
    return () => {
      disposed = true
      stop?.()
    }
  }, [hasHydrated, routeProjectId])
  // No socket-connect refetch here: `resourceSync.connected()` re-reads `capabilities` on
  // every connect (`app/workspaceResourceSync.ts`), which closes the startup race of a
  // `resources.changed` landing before the socket existed. A second one here doubled it.
  // Recomputed when the runtime view store changes (add/remove on (re)sync). The
  // version is the dep even though the body reads the store directly — the linter
  // can't see that data dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => listThirdPartyViews(), [thirdPartyViewsV])
}
