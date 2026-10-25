import { client, unwrap, cleanQuery, assertOk } from './internal'
import type {
  MarketplaceListing,
  PluginRecord,
  PluginUpdatesResponse,
  UpdateMarketplaceResponse,
} from './contracts'

/**
 * Claude Code plugin management: output styles, config, install/remove and marketplaces. Mini apps
 * have their own client (`mini-apps-client.ts`). Spread into `backendClient`.
 */
export const pluginsApi = {
  /**
   * Every output style a scope offers — built-in, the person's, the project's and the enabled
   * plugins' — for the default style in Settings.
   */
  async listOutputStyles(opts?: { projectId?: string | null }) {
    const json = await unwrap(
      await client.rpc.plugins['output-styles'].$get({
        query: cleanQuery({ projectId: opts?.projectId }),
      }),
    )
    return json.styles
  },

  async installPlugin(
    source: string,
    opts?: { projectId?: string | null; enable?: boolean },
  ): Promise<PluginRecord> {
    return unwrap(
      await client.rpc.plugins.install.$post({
        json: { source, projectId: opts?.projectId ?? null, enable: opts?.enable ?? true },
      }),
    )
  },

  async removePlugin(name: string, opts?: { projectId?: string | null }): Promise<void> {
    const response = await client.rpc.plugins.remove.$post({
      json: { name, projectId: opts?.projectId ?? null },
    })
    await assertOk(response)
  },

  /** Re-install a plugin from its source (Claude Code's Update now). */
  async updatePlugin(name: string, opts?: { projectId?: string | null }): Promise<PluginRecord> {
    return unwrap(
      await client.rpc.plugins.update.$post({
        json: { name, projectId: opts?.projectId ?? null },
      }),
    )
  },

  /**
   * Updates the marketplaces offer, and the ones in flight. `refresh` fetches the listings first;
   * progress arrives as `plugin-updates` pokes.
   */
  async getPluginUpdates(opts?: { refresh?: boolean }): Promise<PluginUpdatesResponse> {
    return unwrap(
      await client.rpc.plugins.updates.$get({ query: opts?.refresh ? { refresh: '1' } : {} }),
    )
  },

  /** Queue updates (every available one when `ids` is omitted). */
  async applyPluginUpdates(ids?: string[]): Promise<{ queued: string[] }> {
    return unwrap(await client.rpc.plugins.updates.apply.$post({ json: ids ? { ids } : {} }))
  },

  /**
   * With a name, Claude Code's Update marketplace (its listing and its plugins); without one, every
   * listing is refreshed and no plugin changes.
   */
  async updateMarketplace(name?: string): Promise<UpdateMarketplaceResponse> {
    return unwrap(
      await client.rpc.plugins.marketplaces.update.$post({ json: name ? { name } : {} }),
    )
  },

  async setMarketplaceAutoUpdate(name: string, autoUpdate: boolean): Promise<void> {
    await assertOk(
      await client.rpc.plugins.marketplaces['auto-update'].$post({ json: { name, autoUpdate } }),
    )
  },

  /**
   * Registered plugin marketplaces, each with whether it auto-updates.
   *
   * Each row carries its catalog ENTRIES, which is what lets the composer offer
   * `<name>@<marketplace>` for `/plugin install` without a second round trip; the
   * server has always sent them, the client type just stopped at the count.
   */
  async listMarketplaces(): Promise<MarketplaceListing[]> {
    const json = await unwrap(await client.rpc.plugins.marketplaces.$get())
    return json.marketplaces
  },

  async addMarketplace(source: string): Promise<{ name: string; count: number }> {
    return unwrap(await client.rpc.plugins.marketplaces.add.$post({ json: { source } }))
  },

  async removeMarketplace(name: string): Promise<void> {
    await assertOk(await client.rpc.plugins.marketplaces.remove.$post({ json: { name } }))
  },
}
