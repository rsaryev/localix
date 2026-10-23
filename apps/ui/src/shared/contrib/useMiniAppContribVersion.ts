import { useSyncExternalStore } from 'react'
import { miniAppContribVersion, subscribeMiniAppContrib } from './enabledMiniApps'

/**
 * This client's capability publish counter, as a hook — see `miniAppContribVersion` for
 * why it is not the server's revision. Consumers that hold something DERIVED from the
 * capability set, but not carried in the document itself, use it as a reload key.
 */
export function useMiniAppContribVersion(): number {
  return useSyncExternalStore(subscribeMiniAppContrib, miniAppContribVersion, miniAppContribVersion)
}
