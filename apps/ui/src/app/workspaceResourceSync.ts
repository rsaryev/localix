import { backendClient } from '@/shared/api/client'
import { resourceSync } from '@/shared/api/resourceSync'
import { startResourceSyncTransport } from '@/shared/api/resourceSyncTransport'
import { applyServerProjects } from '@/features/chat/model/sessionSync'
import { registerConnectionsSync } from '@/features/chat/model/connectionsSync'
import { useSettingsStore } from '@/shared/lib/user-settings/settingsStore'
import { startPluginContribSync } from '@/shared/contrib/enabledPlugins'
import { invalidateAllCapabilities } from '@/shared/contrib/capabilityCache'

/** App composition owns adapters. Shared transport/scheduler never imports feature stores. */
export function startWorkspaceResourceSync(): () => void {
  let stopCapabilities: (() => void) | undefined
  const stops = [
    resourceSync.register('projects', {
      read: (signal) => backendClient.listProjects(signal),
      apply: applyServerProjects,
      onError: (error) => console.warn('[realtime] project sync failed', error),
    }),
    registerConnectionsSync(),
    resourceSync.register('profile', {
      read: async (signal) => {
        const state = useSettingsStore.getState()
        // Join startup's precedence barrier, then read again to close events received while
        // that initial request was in flight. Returning early would lose those invalidations.
        if (!state.synced && !(await state.loadFromBackend())) {
          throw new Error('Profile bootstrap has not completed')
        }
        signal.throwIfAborted()
        await useSettingsStore.getState().flushIfPending()
        signal.throwIfAborted()
        return backendClient.getUserProfile(signal)
      },
      apply: (profile) => {
        useSettingsStore.getState().applyBackendProfile(profile)
      },
      onError: (error) => console.warn('[realtime] profile sync failed', error),
    }),
    resourceSync.subscribe('capabilities', () => {
      invalidateAllCapabilities()
      stopCapabilities?.()
      stopCapabilities = startPluginContribSync()
    }),
    startResourceSyncTransport(),
  ]
  return () => {
    for (const stop of stops) stop()
    stopCapabilities?.()
  }
}
