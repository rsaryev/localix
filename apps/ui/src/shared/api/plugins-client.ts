import { client, unwrap, cleanQuery, assertOk } from './internal'
import type { MarketplaceListing, PluginRecord } from './contracts'

/**
 * Plugin management: discovery/listing, declared commands/views,
 * enable + config, and install/remove. Spread into `backendClient`.
 */
export const pluginsApi = {
  /** Slash commands declared by enabled plugins, flattened + namespaced. */

  /**
   * Resolve a plugin command arg's DYNAMIC options on demand (its composer picker).
   * The server runs the plugin's declared options script; failures yield `[]`.
   */
  async fetchPluginArgOptions(input: {
    plugin: string
    command: string
    arg: string
    query?: string
    sessionId?: string
    projectId?: string | null
  }): Promise<{ value: string; label: string; description?: string }[]> {
    const json = await unwrap(
      await client.rpc.plugins['command-args'].options.$post({
        json: {
          plugin: input.plugin,
          command: input.command,
          arg: input.arg,
          ...(input.query ? { query: input.query } : {}),
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.projectId ? { projectId: input.projectId } : {}),
        },
      }),
    )
    return json.options
  },

  /** Palette presets declared by enabled plugins. */

  /** Sandboxed UI views declared by enabled plugins — each opens as a work-item tab. */

  /** One enabled view's sandboxed HTML. */
  async getPluginViewHtml(
    pluginName: string,
    viewId: string,
    opts?: { projectId?: string | null },
  ): Promise<string> {
    const json = await unwrap(
      await client.rpc.plugins.views[':plugin'][':id'].$get({
        param: { plugin: pluginName, id: viewId },
        query: cleanQuery({ projectId: opts?.projectId }),
      }),
    )
    return json.html
  },

  /** Host-brokered call from a sandboxed surface to its owning plugin backend. */
  async invokePluginUiAction(input: {
    pluginName: string
    projectId?: string | null
    viewId: string
    sessionId?: string | null
    action: string
    payload?: unknown
  }): Promise<unknown> {
    const json = await unwrap(
      await client.rpc.plugins['ui-actions'].invoke.$post({
        json: {
          pluginName: input.pluginName,
          viewId: input.viewId,
          action: input.action,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
        },
      }),
    )
    return json.result
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
