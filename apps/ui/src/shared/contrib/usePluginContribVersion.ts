import { useSyncExternalStore } from 'react'
import { pluginContribVersion, subscribePluginContrib } from './enabledPlugins'

/**
 * This client's capability publish counter, as a hook — see `pluginContribVersion` for
 * why it is not the server's revision. Consumers that hold something DERIVED from the
 * capability set, but not carried in the document itself, use it as a reload key.
 */
export function usePluginContribVersion(): number {
  return useSyncExternalStore(subscribePluginContrib, pluginContribVersion, pluginContribVersion)
}
