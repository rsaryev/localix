import { useEffect } from 'react'
import { eventSocket } from '@/shared/api/eventSocket'
import { resourceSync } from '@/shared/api/resourceSync'
import {
  pluginContribSourceFor,
  preparePluginContribScope,
  refetchActivePluginContrib,
  refetchPluginContrib,
  startPluginContribSync,
} from '@/shared/contrib/enabledPlugins'

/** The shared context bar includes project-scoped contributed pills in this WebView too. */
export function useIslandContributions(projectId: string | null | undefined) {
  useEffect(() => {
    if (projectId === undefined) return
    preparePluginContribScope(projectId)
    const stop = startPluginContribSync(() =>
      refetchPluginContrib(pluginContribSourceFor(projectId)),
    )
    const refresh = () => {
      void refetchActivePluginContrib()
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
