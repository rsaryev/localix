import { useEffect } from 'react'
import { eventSocket } from '@/shared/api/eventSocket'
import { resourceSync } from '@/shared/api/resourceSync'
import {
  miniAppContribSourceFor,
  prepareMiniAppContribScope,
  refetchActiveMiniAppContrib,
  refetchMiniAppContrib,
  startMiniAppContribSync,
} from '@/shared/contrib/enabledMiniApps'

/** The shared context bar includes project-scoped contributed pills in this WebView too. */
export function useIslandContributions(projectId: string | null | undefined) {
  useEffect(() => {
    if (projectId === undefined) return
    prepareMiniAppContribScope(projectId)
    const stop = startMiniAppContribSync(() =>
      refetchMiniAppContrib(miniAppContribSourceFor(projectId)),
    )
    const refresh = () => {
      void refetchActiveMiniAppContrib()
    }
    const offCapabilities = resourceSync.subscribe('capabilities', refresh)
    const offConnect = eventSocket.onConnected(refresh)
    return () => {
      stop()
      offCapabilities()
      offConnect()
    }
  }, [projectId])
}
