import { createRealtimeFeed, useRealtimeFeed } from './realtime-feed'
import { useWorkItemVisible } from './visibility'
import {
  STORE_FRAME_TAG,
  storeFeedCommands,
  storeFrameSchema,
  type StoreFrame,
} from '../store-changes'

export type StoreScope = Pick<StoreFrame, 'plugin' | 'sessionId'>
const scopeId = (scope: StoreScope) => `${scope.plugin}\n${scope.sessionId ?? ''}`

/** One host-shared subscription registry across every plugin using the JSON-store protocol. */
export const storeFeed = createRealtimeFeed<StoreScope, StoreFrame>({
  tag: STORE_FRAME_TAG,
  pauseWhileHidden: true,
  subscribe: (scope) => ({
    t: storeFeedCommands(scope.plugin).subscribe,
    sessionId: scope.sessionId,
  }),
  unsubscribe: (scope) => ({
    t: storeFeedCommands(scope.plugin).unsubscribe,
    sessionId: scope.sessionId,
  }),
  id: scopeId,
  decode: (json) => storeFrameSchema.parse(JSON.parse(json)),
  route: scopeId,
  status: (frame) => frame.live,
})

/** Scope invalidation, never snapshot content. Read and draft policies remain with the owner. */
export function useStoreChanges(
  scope: StoreScope | null,
  onChange: () => void,
  enabled = true,
): boolean {
  const visible = useWorkItemVisible()
  return useRealtimeFeed(storeFeed, enabled && visible ? scope : null, {
    frame: onChange,
    reconnect: onChange,
  })
}
