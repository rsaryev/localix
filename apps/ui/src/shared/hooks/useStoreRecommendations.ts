import { useEffect, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import {
  completionWorkingSet,
  subscribeCompletionWorkingSet,
} from '@/shared/api/completionWorkingSet'
import { useResourceGeneration } from '@/shared/api/resourceGeneration'
import type { StoreClient } from '@/shared/api/store-client'

/**
 * The Store's recommendations for the open project and chat, as the Store's row and the
 * composer's notice both read them. The working set (the tabs and chips open on screen) is
 * reported when it moves and worked out on the server in the background; this reads the answer
 * again on its `store-recommendations` poke (P11) and never waits for it.
 */

/** What each project and chat last reported, so an unchanged working set is not sent again. */
const reported = new Map<string, string>()

const workingKey = () =>
  JSON.stringify(completionWorkingSet().map((reference) => [reference.kind, reference.token]))

export function useStoreRecommendations(
  client: StoreClient,
  projectId: string | null,
  sessionId: string | null,
) {
  const working = useSyncExternalStore(subscribeCompletionWorkingSet, workingKey, () => '[]')
  useEffect(() => {
    const where = JSON.stringify([projectId, sessionId])
    if (reported.get(where) === working) return
    reported.set(where, working)
    client
      .reportWorkingSet({
        references: completionWorkingSet(),
        ...(projectId ? { projectId } : {}),
        ...(sessionId ? { sessionId } : {}),
      })
      // Not heard: the next move reports it again.
      .catch(() => reported.delete(where))
  }, [client, projectId, sessionId, working])
  const generation = useResourceGeneration('store-recommendations')
  return useSWR(
    ['store-recommendations', projectId, sessionId, generation],
    () => client.recommendations({ projectId, sessionId }),
    { keepPreviousData: true, shouldRetryOnError: false },
  )
}
