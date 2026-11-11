import { scalarConfig } from '../capabilities/source-repository'
import type { PluginCatalog } from './catalog'
import { storedOptionValues } from './config'
import { issueLine, scopeMcpServers, type LocalixPluginHost, type ScopePlugin } from './kit'
import type { Resolved, ResolvedMcpServer } from '@rsaryev/llx-plugin'
import { pluginLoadBlockReason } from './load-block'
import { pluginIdOf } from './plugin-data-id'

/**
 * Every plugin of a scope's catalog as the kit takes it: its id and folder, whether the scope's
 * agent may use it, a user install (the host's) or the project's own (the session's), and the
 * values saved for it.
 */
export function kitPluginsOf(catalog: Pick<PluginCatalog, 'all'>): ScopePlugin[] {
  return catalog.all.flatMap(({ plugin, state, enabled }) =>
    plugin.kit
      ? [
          {
            id: pluginIdOf(plugin),
            root: plugin.dir,
            plugin: plugin.kit,
            selected: enabled && !pluginLoadBlockReason(plugin),
            scope: plugin.scope === 'project' ? 'project' : 'user',
            values: storedOptionValues(plugin.manifest, scalarConfig(state?.config)),
          } as const,
        ]
      : [],
  )
}

/**
 * The MCP servers of a catalog's plugins as the kit resolves them in a session of the scope; each
 * issue (a server that does not start) is logged.
 */
export async function catalogMcpServers(
  host: LocalixPluginHost,
  catalog: Pick<PluginCatalog, 'all'>,
  scope: {
    readonly cwd: string
    readonly homeDir: string
    readonly logger?: { warn: (msg: string, meta?: unknown) => void }
  },
): Promise<Resolved<ResolvedMcpServer>> {
  const servers = await scopeMcpServers(host, {
    cwd: scope.cwd,
    homeDir: scope.homeDir,
    plugins: kitPluginsOf(catalog),
  })
  for (const issue of servers.issues) scope.logger?.warn(issueLine(issue))
  return servers
}
