import type { PluginRouteScope } from '@localixai/plugin-sdk/backend'
import type { CollectionStore } from './collection/store'
import type { EnvironmentService } from './environments/service'

export type RestScopeContext = { env?: Partial<PluginRouteScope> }

/** Per-request services resolved by the owning router from the host's current scope. */
export interface RestRouteScope {
  uid: (context: { env: PluginRouteScope }) => string
  sid: (context: RestScopeContext) => string | undefined
  collection: (context: RestScopeContext) => CollectionStore
  envs: (context: RestScopeContext) => EnvironmentService
}
