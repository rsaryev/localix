import { API_BASE_URL, apiFetch, assertOk } from './internal'
import type { PluginUpdateJob, PluginUpdatesResponse } from '@localixai/api/client'

/**
 * Claude Code plugin updates: what the marketplaces offer over what is installed, and the updates
 * in flight. The server pokes `plugin-updates` as either moves. The contract is the API's
 * (`features/plugins/contracts-updates.ts`); a 404 still reads as "this server has no plugin
 * updates", for a client talking to an older server.
 */
export type { PluginUpdateJob, PluginUpdatesResponse }

/** One update on offer: `name@marketplace` from one version to another. */
export type PluginUpdateOffer = PluginUpdatesResponse['available'][number]

const UPDATES = `${API_BASE_URL}/rpc/plugins/updates`

export const pluginUpdatesApi = {
  /** The offers and jobs, or null where the server has no plugin updates to report. */
  async list(): Promise<PluginUpdatesResponse | null> {
    const response = await apiFetch(UPDATES)
    if (response.status === 404) return null
    await assertOk(response)
    return (await response.json()) as PluginUpdatesResponse
  },

  /** Update the given plugins, or every one with an update; progress arrives as pokes. */
  async apply(ids?: string[]): Promise<void> {
    await assertOk(
      await apiFetch(`${UPDATES}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      }),
    )
  },
}
