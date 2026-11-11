import type { PluginService } from './service-types'

/** What the provider asks of the plugin service. */
export type PluginStoreService = Pick<
  PluginService,
  | 'listPlugins'
  | 'install'
  | 'dependencies'
  | 'update'
  | 'remove'
  | 'setEnabled'
  | 'setConfig'
  | 'addMarketplace'
  | 'removeMarketplace'
  | 'refreshMarketplaces'
  | 'updateMarketplace'
  | 'setMarketplaceAutoUpdate'
> & { updates: Pick<PluginService['updates'], 'snapshot' | 'subscribe'> }
