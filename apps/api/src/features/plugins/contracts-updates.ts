import { z } from 'zod'

/**
 * Wire contracts for plugin updates, read by the background-activity center:
 * `GET /rpc/plugins/updates` (`?refresh=1` fetches the marketplace listings first) and
 * `POST /rpc/plugins/updates/apply`, whose progress arrives as `plugin-updates` pokes.
 */
export const pluginUpdateAvailableSchema = z.object({
  /** `<name>@<marketplace>`. */
  id: z.string(),
  name: z.string(),
  marketplace: z.string(),
  /** The installed version and the one an update installs, computed as Claude Code computes them. */
  from: z.string(),
  to: z.string(),
})

export const pluginUpdateJobSchema = z.object({
  id: z.string(),
  phase: z.enum(['checking', 'downloading', 'installing', 'done', 'failed']),
  error: z.string().optional(),
})
export type PluginUpdateJob = z.infer<typeof pluginUpdateJobSchema>

export const pluginUpdatesResponseSchema = z.object({
  available: z.array(pluginUpdateAvailableSchema),
  jobs: z.array(pluginUpdateJobSchema),
  /** When availability was last computed; null before the first check. */
  lastCheckedAt: z.string().nullable(),
})
export type PluginUpdatesResponse = z.infer<typeof pluginUpdatesResponseSchema>

/** `ids` omitted: every available update. */
export const applyPluginUpdatesRequestSchema = z.object({ ids: z.array(z.string()).optional() })

export const applyPluginUpdatesResponseSchema = z.object({ queued: z.array(z.string()) })

/** `POST /rpc/plugins/marketplaces/update`: with a name, Claude Code's "Update marketplace". */
export const updateMarketplaceRequestSchema = z.object({ name: z.string().min(1).optional() })

export const updateMarketplaceResponseSchema = z.object({
  /** The marketplaces whose listings were fetched again. */
  refreshed: z.array(z.string()),
  /** The plugins updated from it (only with a name). */
  updated: z.array(z.string()),
  /** Plugins an update leaves for the person to update from their own row. */
  manual: z.array(z.string()),
  warnings: z.array(z.string()),
})
export type UpdateMarketplaceResponse = z.infer<typeof updateMarketplaceResponseSchema>

/** `POST /rpc/plugins/marketplaces/auto-update`: the Marketplaces toggle. */
export const setMarketplaceAutoUpdateRequestSchema = z.object({
  name: z.string().min(1),
  autoUpdate: z.boolean(),
})
