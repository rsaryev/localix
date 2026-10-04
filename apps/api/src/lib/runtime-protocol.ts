/** Increment only when a client cannot safely use an older local API instance. */
// Versioned resource browsing replaced the flat `{nodes}` response. Clients must
// never attach to a runtime that cannot honor hierarchical `partial` navigation.
export const LOCALIX_API_PROTOCOL_VERSION = 4
export const LOCALIX_API_PRODUCT_ID = 'localix-api'
/** Machine-readable stdout frame emitted once a standalone runtime is ready or attached. */
export const LOCALIX_RUNTIME_READY_PREFIX = 'LOCALIX_RUNTIME_READY '

export interface LocalixRuntimeInfo {
  /** `draining` (served as 503) from the moment shutdown begins. */
  status: 'ok' | 'draining'
  productId: typeof LOCALIX_API_PRODUCT_ID
  instanceId: string
  protocolVersion: number
  startedAt: string
  databaseId?: string
}
