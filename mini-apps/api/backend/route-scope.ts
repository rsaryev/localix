import type { MiniAppRouteScope } from '@localixai/mini-app-sdk/backend'
import type { CollectionStore } from './collection/store'
import type { EnvironmentService } from './environments/service'

export type RestScopeContext = { env?: Partial<MiniAppRouteScope> }

/** Per-request services resolved by the owning router from the host's current scope. */
export interface RestRouteScope {
  uid: (context: { env: MiniAppRouteScope }) => string
  sid: (context: RestScopeContext) => string | undefined
  collection: (context: RestScopeContext) => CollectionStore
  envs: (context: RestScopeContext) => EnvironmentService
}
