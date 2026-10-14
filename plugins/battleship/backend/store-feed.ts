import { createStoreChangeFeed } from '@localixai/plugin-sdk/backend'
import { onStoreWrite } from './store'

export { STORE_FEED_WINDOW_MS } from '@localixai/plugin-sdk/backend'
export function createStoreFeed(
  options: Omit<Parameters<typeof createStoreChangeFeed>[0], 'subscribeWrites'>,
) {
  return createStoreChangeFeed({ ...options, subscribeWrites: onStoreWrite })
}
