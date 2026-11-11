import { catalogRun } from '../catalog-kit'
import type { PluginCatalogEntry } from '../catalog'
import type { DiscoveredPlugin } from '../discovery'
import { issueLine } from '../kit'
import { diskPluginHost } from '../kit/testing'
import { buildMcpRecords } from '../mcp'

/**
 * The MCP server records one enabled plugin gives a run in `home`, with these saved values: the
 * kit resolves its servers in a session of the scope, as the loader does (`loader.ts`).
 */
export async function pluginMcpRecords(
  plugin: DiscoveredPlugin,
  values: Record<string, unknown>,
  home: string,
  logger?: { warn: (msg: string, meta?: unknown) => void },
) {
  const entry = { plugin, state: { config: values }, enabled: true } as PluginCatalogEntry
  const run = await catalogRun(diskPluginHost(home), { all: [entry] }, { cwd: home, homeDir: home })
  const servers = await run.mcpServers()
  for (const issue of servers.issues) logger?.warn(issueLine(issue))
  return buildMcpRecords(plugin, servers, 'u', 'ts', logger)
}
