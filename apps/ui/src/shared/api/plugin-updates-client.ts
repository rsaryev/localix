import { API_BASE_URL, apiFetch, assertOk } from './internal'

/**
 * Claude Code plugin updates: what the marketplaces offer over what is installed, and the updates
 * in flight. The server pokes `plugin-updates` as either moves.
 *
 * MERGE NOTE: the route is built beside this client in `features/plugins`; until it lands, this
 * file declares the contract it answers with and reads a 404 as "this server has no plugin
 * updates" rather than as a failure. Once `PluginUpdatesResponse` is exported from
 * `@localixai/api/client`, import it from there and drop the local declaration.
 */

export interface PluginUpdateOffer {
  /** `name@marketplace`. */
  id: string
  name: string
  marketplace: string
  from: string
  to: string
}

export interface PluginUpdateJob {
  id: string
  phase: 'checking' | 'downloading' | 'installing' | 'done' | 'failed'
  error?: string
}

export interface PluginUpdatesResponse {
  available: PluginUpdateOffer[]
  jobs: PluginUpdateJob[]
  lastCheckedAt: string | null
}

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
