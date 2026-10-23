import { client, unwrap, cleanQuery, assertOk } from './internal'
import type { MarketplaceListing, PluginRecord } from './contracts'

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

  async setPluginConfig(
    name: string,
    values: Record<string, string | number | boolean>,
    opts?: { projectId?: string | null },
  ): Promise<PluginRecord> {
    return unwrap(
      await client.rpc.plugins.config.$post({
        json: { name, values, projectId: opts?.projectId ?? null },
      }),
    )
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

  /**
   * Registered plugin marketplaces — built-in `localix` first, then user-added.
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
