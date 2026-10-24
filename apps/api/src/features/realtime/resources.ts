/** Low-frequency read models shared by every workspace of one user. No payloads or secrets. */
export const REALTIME_RESOURCES = [
  'sessions',
  'projects',
  'providers',
  'profile',
  'view-state',
  'capabilities',
  // The installed mini apps: their list, settings and what each contributes.
  'mini-apps',
  'vault',
  'storage',
  'system',
  // In-memory status a service signals as it moves (a download, an index build), not a table.
  'local-models',
  // Claude Code plugin updates: what is offered and the updates in flight
  // (`/rpc/plugins/updates`).
  'plugin-updates',
  // The catalogs the mini app store reads.
  'mini-app-catalogs',
  // The Store's listings across package kinds (`/rpc/store`): a job moved, an install or a
  // source changed.
  'store',
  // Plugin updates available and in flight (`plugins/plugin-updates.ts`), with their progress.
  'plugin-updates',
  'semantic',
  // What loaded mods put on screen: their panes and what is drawn in them.
  'mods',
  // What a plugin's `subagentStatusLine` drew in a conversation's subagent rows, as the server
  // redraws it (`chat/service/subagent-rows-live.ts`).
  'subagent-rows',
] as const

export type RealtimeResource = (typeof REALTIME_RESOURCES)[number]

export type ResourceChangedEvent = {
  type: 'resources.changed'
  resources: RealtimeResource[]
}
