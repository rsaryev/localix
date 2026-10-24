import { useMemo } from 'react'
import useSWR from 'swr'

import { localModelsApi } from '@/shared/api/localModelsApi'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'
import { storeApi } from '@/shared/api/store-client'
import { useDesktopUpdate } from '@/shared/hooks/useDesktopUpdate'
import { useLocalModelsStatus } from '@/shared/hooks/useLocalModels'
import { openStore } from '@/shared/lib/openStore'
import { buildActivity, type ActivityItem, type ActivityOps } from './activityItems'

const STORE_ACTIVITY_KEY = 'store-activity'

/**
 * What the app is doing in the background, live: the Store's jobs and updates across every
 * package kind (`/rpc/store/activity`, read again on the `store` poke), local model downloads (on
 * `local-models`), and the app's own update from the shell's shared state. Read by the bell
 * (always mounted), the Event Center and the composer's update strip; nothing here is written to
 * any store.
 */
export function useBackgroundActivity(host: { restartToUpdate?: () => void } = {}) {
  useRevalidateOnResources(STORE_ACTIVITY_KEY, ['store'])
  const store = useSWR(STORE_ACTIVITY_KEY, () => storeApi.activity(), {
    shouldRetryOnError: false,
  })
  const { status: localModels, refresh: refreshModels } = useLocalModelsStatus()
  const { state: app } = useDesktopUpdate({ poll: false })
  const { restartToUpdate } = host

  return useMemo(() => {
    const after = (work: Promise<unknown>, refresh: () => unknown) =>
      void work.catch(() => {}).finally(() => void refresh())
    const ops: ActivityOps = {
      openStore,
      pauseModel: (id) => after(localModelsApi.pause(id), refreshModels),
      resumeModel: (id) => after(localModelsApi.install(id), refreshModels),
      cancelModel: (id) => after(localModelsApi.cancel(id), refreshModels),
      updateStore: () => after(storeApi.applyUpdates(), () => store.mutate()),
      ...(restartToUpdate ? { restartToUpdate } : {}),
    }
    const built = buildActivity({ store: store.data, localModels, app }, ops)
    return { ...built, ...progressOf(built.items) }
    // `mutate` is stable per key; the data are what change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.data, localModels, app, restartToUpdate, refreshModels])
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
