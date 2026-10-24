import { useMemo } from 'react'
import useSWR from 'swr'

import { backendClient } from '@/shared/api/client'
import { localModelsApi } from '@/shared/api/localModelsApi'
import { pluginUpdatesApi } from '@/shared/api/plugin-updates-client'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'
import { useDesktopUpdate } from '@/shared/hooks/useDesktopUpdate'
import { useLocalModelsStatus } from '@/shared/hooks/useLocalModels'
import { openMiniAppStore } from '@/shared/lib/openStore'
import { buildActivity, type ActivityItem, type ActivityOps } from './activityItems'

const MINI_APP_ACTIVITY_KEY = 'mini-app-store-activity'
const PLUGIN_UPDATES_KEY = 'plugin-updates'

/**
 * What the app is doing in the background, live: each source is read from its owner and read
 * again on the owner's poke (`mini-app-installs`, `local-models`, `plugin-updates`), and the app's
 * own update from the shell's shared state. Read by the bell (always mounted), the Event Center
 * and the composer's update strip; nothing here is written to any store.
 */
export function useBackgroundActivity(
  host: { openPlugins?: () => void; restartToUpdate?: () => void } = {},
) {
  useRevalidateOnResources(MINI_APP_ACTIVITY_KEY, ['mini-app-installs', 'mini-apps'])
  useRevalidateOnResources(PLUGIN_UPDATES_KEY, ['plugin-updates'])
  const miniApps = useSWR(MINI_APP_ACTIVITY_KEY, () => backendClient.getMiniAppStoreActivity(), {
    shouldRetryOnError: false,
  })
  // A server without plugin updates answers null (404): nothing to show, nothing to retry.
  const plugins = useSWR(PLUGIN_UPDATES_KEY, () => pluginUpdatesApi.list(), {
    shouldRetryOnError: false,
  })
  const { status: localModels, refresh: refreshModels } = useLocalModelsStatus()
  const { state: app } = useDesktopUpdate({ poll: false })
  const { openPlugins, restartToUpdate } = host

  return useMemo(() => {
    const after = (work: Promise<unknown>, refresh: () => unknown) =>
      void work.catch(() => {}).finally(() => void refresh())
    const ops: ActivityOps = {
      openStore: openMiniAppStore,
      pauseModel: (id) => after(localModelsApi.pause(id), refreshModels),
      resumeModel: (id) => after(localModelsApi.install(id), refreshModels),
      cancelModel: (id) => after(localModelsApi.cancel(id), refreshModels),
      updateMiniApps: () => after(backendClient.updateMiniApps(), () => miniApps.mutate()),
      updatePlugins: () => after(pluginUpdatesApi.apply(), () => plugins.mutate()),
      openPlugins: openPlugins ?? (() => {}),
      ...(restartToUpdate ? { restartToUpdate } : {}),
    }
    const built = buildActivity(
      { miniApps: miniApps.data, localModels, app, plugins: plugins.data },
      ops,
    )
    return { ...built, ...progressOf(built.items) }
    // `mutate` is stable per key; the data are what change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miniApps.data, plugins.data, localModels, app, openPlugins, restartToUpdate, refreshModels])
}

/**
 * How much is in progress, for the bell: the jobs that are moving (paused ones are not), and how
 * far along they are together — null when none of them can say.
 */
export function progressOf(items: readonly ActivityItem[]): {
  active: number
  fraction: number | null
} {
  const moving = items.filter((item) => item.state !== 'paused')
  const known = moving.filter((item) => item.percent !== null)
  const fraction =
    known.length === 0
      ? null
      : known.reduce((sum, item) => sum + (item.percent ?? 0), 0) / known.length / 100
  return { active: moving.length, fraction }
}
