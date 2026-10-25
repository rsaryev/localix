import { z } from 'zod'

/**
 * Plugin update shapes: what the marketplaces offer and the updates in flight, which the Store's
 * plugin provider reads (`store-jobs.ts`), and what updating a marketplace answers.
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
