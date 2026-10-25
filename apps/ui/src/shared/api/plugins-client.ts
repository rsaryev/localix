import { client, unwrap, cleanQuery } from './internal'
import type { MarketplaceListing } from './contracts'

/**
 * Claude Code plugin reads: output styles and the registered marketplaces. Installs, updates and
 * sources go through the Store (`store-client`). Spread into `backendClient`.
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
}
