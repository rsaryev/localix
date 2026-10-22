/** Low-frequency read models shared by every workspace of one user. No payloads or secrets. */
export const REALTIME_RESOURCES = [
  'sessions',
  'projects',
  'providers',
  'profile',
  'view-state',
  'capabilities',
  'vault',
  'storage',
  'system',
  // In-memory status a service signals as it moves (a download, an index build), not a table.
  'local-models',
  'semantic',
] as const

export type RealtimeResource = (typeof REALTIME_RESOURCES)[number]

export type ResourceChangedEvent = {
  type: 'resources.changed'
  resources: RealtimeResource[]
}
